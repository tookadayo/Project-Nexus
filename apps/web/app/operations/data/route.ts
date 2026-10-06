import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { operationsContext } from "../context";
import { sameOrigin } from "../../auth/origin";
import { billingBody, billingFailure } from "../../billing/request";
import { assert } from "../../../../../packages/shared/src/index";
import {
  EntitlementService,
  features,
} from "../../../../../packages/settings/src/billing/entitlements";
import {
  operationsAccess,
  nexusRole,
  actorPermissions,
} from "../../../../../packages/operations/src/policy";
import {
  AttentionInbox,
  inboxRows,
} from "../../../../../packages/operations/src/inbox";
import { Destinations } from "../../../../../packages/operations/src/destinations";
import {
  Playbooks,
  workflowTemplates,
} from "../../../../../packages/operations/src/playbooks";
import { Reports } from "../../../../../packages/operations/src/reports";
import { OperationsIntake } from "../../../../../packages/operations/src/intake";
import { InterventionReview } from "../../../../../packages/operations/src/intervention-review";
import { EventOperations } from "../../../../../packages/operations/src/events";
import { ApiCredentials } from "../../../../../packages/operations/src/credentials";
import { Webhooks } from "../../../../../packages/operations/src/webhooks";
import {
  OperationsOrganization,
  auditExport,
} from "../../../../../packages/operations/src/organization";
import { ExploreService } from "../../../../../packages/analytics/src/explore";
import { enforceOperationsPlan } from "../../../../../packages/operations/src/plan-policy";
export const runtime = "nodejs";
const viewSchema = z.enum([
  "attention",
  "reports",
  "playbooks",
  "improvements",
  "intake",
  "events",
  "organization",
  "integrations",
]);
function failure(error: unknown) {
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return NextResponse.json(
      { error: "INVALID_OPERATIONS_REQUEST" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  return billingFailure(error);
}
const json = (value: unknown) =>
  NextResponse.json(value, { headers: { "Cache-Control": "no-store" } });
function domains(c: Awaited<ReturnType<typeof operationsContext>>) {
  const { db, vault, discord, tokens, authority } = c.services;
  return {
    attention: new AttentionInbox(db),
    destinations: new Destinations(db, discord),
    playbooks: new Playbooks(db),
    reports: new Reports(db),
    intake: new OperationsIntake(db, vault, discord, tokens),
    improvements: new InterventionReview(db),
    events: new EventOperations(db),
    credentials: new ApiCredentials(db, vault),
    webhooks: new Webhooks(db, vault),
    organization: new OperationsOrganization(db, vault, discord, authority),
  };
}
export async function GET(request: NextRequest) {
  try {
    const c = await operationsContext(),
      { scope: s, actor: a } = c,
      d = domains(c),
      params = request.nextUrl.searchParams,
      view = viewSchema.parse(params.get("view") ?? "attention");
    const format = params.get("format");
    if (format === "ics")
      return new Response(
        await d.events.calendar(s, a, z.uuid().parse(params.get("id"))),
        {
          headers: {
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": 'attachment; filename="nexus-event.ics"',
            "Cache-Control": "no-store",
          },
        },
      );
    if (format === "audit-csv" || format === "audit-json")
      return new Response(
        await auditExport(
          c.services.db,
          s,
          a,
          format === "audit-csv" ? "CSV" : "JSON",
        ),
        {
          headers: {
            "Content-Type":
              format === "audit-csv"
                ? "text/csv; charset=utf-8"
                : "application/json",
            "Content-Disposition": `attachment; filename="nexus-audit.${format === "audit-csv" ? "csv" : "json"}"`,
            "Cache-Control": "no-store",
          },
        },
      );
    // Materialize pause states without deleting saved configuration. Every mutation
    // and worker also checks effective capability at the point of use.
    await enforceOperationsPlan(c.services.db, s);
    const access = await c.services.db.transaction().execute(async (tx) => {
      const state = await operationsAccess(tx, s, a, "READ"),
        role = await nexusRole(tx, s, a.key),
        ent = new EntitlementService(tx),
        decisions = Object.fromEntries(
          await Promise.all(
            features.map(async (feature) => [
              feature,
              (await ent.check(s, feature)).allowed,
            ]),
          ),
        );
      return {
        plan: state.plan,
        permissions: await actorPermissions(tx, s, a),
        role,
        features: decisions,
        limits: state.limits,
      };
    });
    const destinations = await d.destinations.list(s, a),
      organization = await d.organization.detail(s, a),
      base = {
        view,
        guildId: s.guildId,
        access,
        destinations,
        teams: organization.teams,
      };
    switch (view) {
      case "attention":
        return json({
          ...base,
          items: await c.services.db.transaction().execute(async (tx) => {
            await operationsAccess(tx, s, a, "READ", "basic_attention");
            return inboxRows(tx, s);
          }),
          intake: await d.intake.list(s, a),
        });
      case "playbooks":
        return json({
          ...base,
          books: await d.playbooks.list(s, a),
          templates: workflowTemplates,
        });
      case "reports":
        return json({
          ...base,
          reports: await d.reports.list(s, a),
          views: access.features.saved_views
            ? await new ExploreService(c.services.db).list(s)
            : [],
        });
      case "improvements":
        return json({ ...base, improvements: await d.improvements.list(s, a) });
      case "intake":
        return json({ ...base, intake: await d.intake.list(s, a) });
      case "events":
        return json({ ...base, events: await d.events.list(s, a) });
      case "organization":
        return json({
          ...base,
          ...organization,
          communities:
            access.features.multi_guild && organization.organization
              ? await d.organization.commandCenter(s, a)
              : [],
        });
      case "integrations":
        return json({
          ...base,
          credentials: access.permissions.includes("CONFIGURE")
            ? await d.credentials.list(s, a)
            : [],
          webhooks: access.permissions.includes("CONFIGURE")
            ? await d.webhooks.list(s, a)
            : { endpoints: [], deliveries: [] },
        });
    }
  } catch (error) {
    return failure(error);
  }
}
const actions = [
  "attention",
  "destination",
  "destinationDisable",
  "destinationResume",
  "playbook",
  "playbookTransition",
  "dryRun",
  "reportTemplate",
  "reportSchedule",
  "reportEnabled",
  "intervention",
  "intake",
  "intakePublish",
  "intakeDisable",
  "intakeRead",
  "event",
  "credential",
  "credentialRevoke",
  "credentialResume",
  "webhook",
  "webhookRotate",
  "webhookEnabled",
  "organization",
  "linkGuild",
  "member",
  "revokeMember",
  "team",
] as const;
export async function POST(request: NextRequest) {
  try {
    assert(sameOrigin(request), "ORIGIN_REJECTED", 403);
    const { action, input } = z
        .object({ action: z.enum(actions), input: z.unknown() })
        .strict()
        .parse(JSON.parse(await billingBody(request, 180000))),
      c = await operationsContext(),
      { scope: s, actor: a } = c,
      d = domains(c);
    const id = () => z.object({ id: z.uuid() }).strict().parse(input).id;
    let result: unknown;
    switch (action) {
      case "attention":
        result = await d.attention.action(s, a, input);
        break;
      case "destination":
        result = await d.destinations.create(s, a, input);
        break;
      case "destinationDisable":
        result = await d.destinations.disable(s, a, id());
        break;
      case "destinationResume":
        result = await d.destinations.resume(s, a, id());
        break;
      case "playbook":
        result = await d.playbooks.save(s, a, input);
        break;
      case "playbookTransition":
        result = await d.playbooks.transition(s, a, input);
        break;
      case "dryRun": {
        const data = z
          .object({ id: z.uuid(), days: z.number().int().min(1).max(30) })
          .strict()
          .parse(input);
        result = await d.playbooks.dryRun(s, a, data.id, data.days);
        break;
      }
      case "reportTemplate":
        result = await d.reports.template(s, a, input);
        break;
      case "reportSchedule":
        result = await d.reports.schedule(s, a, input);
        break;
      case "reportEnabled": {
        const data = z
          .object({ id: z.uuid(), enabled: z.boolean() })
          .strict()
          .parse(input);
        result = await d.reports.setEnabled(s, a, data.id, data.enabled);
        break;
      }
      case "intervention":
        result = await d.improvements.create(s, a, input);
        break;
      case "intake":
        result = await d.intake.save(s, a, input);
        break;
      case "intakePublish": {
        const data = z
          .object({
            id: z.uuid(),
            version: z.number().int().positive(),
            channelId: z.string(),
          })
          .strict()
          .parse(input);
        result = await d.intake.publish(
          s,
          a,
          data.id,
          data.version,
          data.channelId,
        );
        break;
      }
      case "intakeRead":
        result = await d.intake.read(s, a, id());
        break;
      case "intakeDisable": {
        const data = z
          .object({ id: z.uuid(), version: z.number().int().positive() })
          .strict()
          .parse(input);
        result = await d.intake.disable(s, a, data.id, data.version);
        break;
      }
      case "event":
        result = await d.events.save(s, a, input);
        break;
      case "credential":
        result = await d.credentials.create(s, a, input);
        break;
      case "credentialRevoke":
        result = await d.credentials.revoke(s, a, id());
        break;
      case "credentialResume":
        result = await d.credentials.resume(s, a, id());
        break;
      case "webhook":
        result = await d.webhooks.create(s, a, input);
        break;
      case "webhookRotate":
        result = await d.webhooks.rotate(s, a, id());
        break;
      case "webhookEnabled": {
        const data = z
          .object({ id: z.uuid(), enabled: z.boolean() })
          .strict()
          .parse(input);
        result = await d.webhooks.setEnabled(s, a, data.id, data.enabled);
        break;
      }
      case "organization": {
        const data = z.object({ name: z.string() }).strict().parse(input);
        result = await d.organization.create(s, a, c.userId, data.name);
        break;
      }
      case "linkGuild": {
        const data = z
          .object({ guildId: z.string(), review: z.boolean().default(false) })
          .strict()
          .parse(input);
        result = await d.organization.link(
          s,
          a,
          c.userId,
          data.guildId,
          data.review,
        );
        break;
      }
      case "member":
        result = await d.organization.member(s, a, input);
        break;
      case "revokeMember":
        result = await d.organization.revokeMember(s, a, id());
        break;
      case "team":
        result = await d.organization.team(s, a, input);
        break;
    }
    return json(result ?? { saved: true });
  } catch (error) {
    return failure(error);
  }
}
