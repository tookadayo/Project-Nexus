import { z } from "zod";
import { sql, tenant, type Database } from "../../db/src/index";
import { assert, type Scope } from "../../shared/src/index";
import type { Actor } from "../../settings/src/index";
import { operationsAccess, operationsAudit, operationsLock } from "./policy";
import { timezoneSchema, wallTime, wallUtc, wallTimeInstant } from "./schedule";
export const eventTemplateInput = z
  .object({
    id: z.uuid().optional(),
    revision: z.number().int().positive().optional(),
    title: z.string().trim().min(1).max(100),
    timezone: timezoneSchema,
    localStart: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    durationMinutes: z.number().int().min(1).max(1440),
    recurrence: z.enum(["ONCE", "WEEKLY", "MONTHLY"]).default("ONCE"),
    location: z.string().max(200).default(""),
  })
  .strict();
export type EventTemplate = {
  id: string;
  title: string;
  timezone: string;
  starts_at: Date;
  duration_minutes: number;
  recurrence: "ONCE" | "WEEKLY" | "MONTHLY";
  location: string;
  calendar_sequence: number;
  created_at: Date;
  state: string;
  revision: number;
};
export class EventOperations {
  constructor(private readonly db: Database) {}
  async save(s: Scope, actor: Actor, input: unknown) {
    const data = eventTemplateInput.parse(input),
      [date, time] = data.localStart.split("T"),
      [year, month, day] = date!.split("-").map(Number),
      [hour, minute] = time!.split(":").map(Number),
      starts = wallTimeInstant(
        { year: year!, month: month!, day: day!, hour: hour!, minute: minute! },
        data.timezone,
      );
    assert(
      starts.getUTCFullYear() >= 2000 && starts.getUTCFullYear() <= 2100,
      "INVALID_EVENT_DATE",
    );
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "CONFIGURE", "event_operations");
      await operationsLock(tx, s);
      const row = data.id
        ? (
            await sql<{
              id: string;
              revision: number;
            }>`UPDATE event_operation_templates SET title=${data.title},timezone=${data.timezone},starts_at=${starts},duration_minutes=${data.durationMinutes},recurrence=${data.recurrence},location=${data.location},calendar_sequence=calendar_sequence+1,revision=revision+1,state='ENABLED',actor_hash=${actor.key} WHERE ${tenant(s)} AND id=${data.id}::uuid AND revision=${data.revision ?? 0} RETURNING id,revision`.execute(
              tx,
            )
          ).rows[0]
        : (
            await sql<{
              id: string;
              revision: number;
            }>`INSERT INTO event_operation_templates(organization_id,guild_id,title,timezone,starts_at,duration_minutes,recurrence,location,actor_hash) VALUES(${s.organizationId}::uuid,${s.guildId},${data.title},${data.timezone},${starts},${data.durationMinutes},${data.recurrence},${data.location},${actor.key}) RETURNING id,revision`.execute(
              tx,
            )
          ).rows[0];
      assert(row, "REVISION_CONFLICT", 409);
      await operationsAudit(
        tx,
        s,
        actor.key,
        "EVENT_TEMPLATE_SAVED",
        row.id,
        row.revision,
      );
      return row;
    });
  }
  async list(s: Scope, actor: Actor) {
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "READ");
      return (
        await sql<EventTemplate>`SELECT * FROM event_operation_templates WHERE ${tenant(s)} ORDER BY starts_at,id LIMIT 100`.execute(
          tx,
        )
      ).rows;
    });
  }
  async calendar(s: Scope, actor: Actor, id: string) {
    z.uuid().parse(id);
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "READ", "event_operations");
      const row = (
        await sql<EventTemplate>`SELECT * FROM event_operation_templates WHERE ${tenant(s)} AND id=${id}::uuid AND state='ENABLED'`.execute(
          tx,
        )
      ).rows[0];
      assert(row, "EVENT_TEMPLATE_NOT_FOUND", 404);
      return calendarIcs(row);
    });
  }
}
const escapeIcs = (value: string) =>
  value
    .replaceAll("\\", "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
const stamp = (at: Date) => at.toISOString().replace(/[-:]/g, "").slice(0, 15);
const offsetString = (offset: number) => {
  const minutes = Math.abs(Math.round(offset / 60000));
  return (
    (offset < 0 ? "-" : "+") +
    String(Math.floor(minutes / 60)).padStart(2, "0") +
    String(minutes % 60).padStart(2, "0")
  );
};
const zoneOffset = (at: Date, zone: string) =>
  wallUtc(wallTime(at, zone)) - Math.floor(at.getTime() / 60000) * 60000;
function timezoneLines(zone: string, start: Date) {
  const beginning = Date.UTC(start.getUTCFullYear() - 1, 0, 1),
    end = Date.UTC(start.getUTCFullYear() + 4, 0, 1),
    initial = zoneOffset(new Date(beginning), zone),
    lines = [
      "BEGIN:VTIMEZONE",
      "TZID:" + zone,
      "BEGIN:STANDARD",
      "DTSTART:" + stamp(new Date(beginning + initial)),
      "TZOFFSETFROM:" + offsetString(initial),
      "TZOFFSETTO:" + offsetString(initial),
      "END:STANDARD",
    ];
  let previous = initial;
  for (let at = beginning + 86400000; at <= end; at += 86400000) {
    const offset = zoneOffset(new Date(at), zone);
    if (offset === previous) continue;
    let low = at - 86400000,
      high = at;
    while (high - low > 60000) {
      const mid = Math.floor((low + high) / 120000) * 60000;
      if (zoneOffset(new Date(mid), zone) === previous) low = mid;
      else high = mid;
    }
    const transition = Math.ceil(high / 60000) * 60000,
      kind = offset > previous ? "DAYLIGHT" : "STANDARD";
    lines.push(
      "BEGIN:" + kind,
      "DTSTART:" + stamp(new Date(transition + previous)),
      "TZOFFSETFROM:" + offsetString(previous),
      "TZOFFSETTO:" + offsetString(offset),
      "END:" + kind,
    );
    previous = offset;
  }
  lines.push("END:VTIMEZONE");
  return lines;
}
/** RFC 5545: explicit TZID/VTIMEZONE, stable UID/SEQUENCE, finite recurrence,
 * escaped text and UTF-8-safe 75-octet folding. RSVP never becomes attendance. */
export function calendarIcs(event: EventTemplate) {
  timezoneSchema.parse(event.timezone);
  const timezone = new Intl.DateTimeFormat("en", {
    timeZone: event.timezone,
  }).resolvedOptions().timeZone;
  assert(/^[A-Za-z0-9_+\-/]+$/.test(timezone), "INVALID_TIMEZONE");
  const local = new Date(wallUtc(wallTime(event.starts_at, timezone))),
    lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//NEXUS//Community Operations//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      ...timezoneLines(timezone, event.starts_at),
      "BEGIN:VEVENT",
      "UID:" + event.id + "@nexus.invalid",
      "DTSTAMP:" + stamp(event.created_at) + "Z",
      "SEQUENCE:" + event.calendar_sequence,
      "DTSTART;TZID=" + timezone + ":" + stamp(local),
      "DURATION:PT" + event.duration_minutes + "M",
      "SUMMARY:" + escapeIcs(event.title),
      "LOCATION:" + escapeIcs(event.location),
      "DESCRIPTION:Community operations event. Signup is not attendance.",
      ...(event.recurrence === "ONCE"
        ? []
        : [
            "RRULE:FREQ=" +
              event.recurrence +
              ";COUNT=" +
              (event.recurrence === "WEEKLY" ? 52 : 12),
          ]),
      "END:VEVENT",
      "END:VCALENDAR",
    ];
  return (
    lines
      .map((line) => {
        let part = "",
          out = "",
          size = 0;
        for (const character of line) {
          const bytes = Buffer.byteLength(character);
          if (size + bytes > 74) {
            out += part + "\r\n ";
            part = "";
            size = 1;
          }
          part += character;
          size += bytes;
        }
        return out + part;
      })
      .join("\r\n") + "\r\n"
  );
}
