import { z } from "zod";
import {
  AnalysisService,
  fingerprint,
  analysisTypes,
} from "../../../packages/analysis/src/index";
import {
  analysisMenuPanel,
  analysisPreviewPanel,
  analysisHistoryPanel,
  analysisResultPanel,
  analysisComparisonPanel,
  analysisAttentionListPanel,
  analysisAttentionItemPanel,
  analysisAttentionConfirmationPanel,
} from "../../../packages/discord-panels/src/views/analysis";
import { analysisCopy } from "../../../packages/discord-panels/src/i18n/analysis";
import type { UiLocale } from "../../../packages/discord-panels/src/i18n";
import type { Issue } from "../../../packages/discord-panels/src/types";
import type { Database } from "../../../packages/db/src/index";
import type { Scope } from "../../../packages/shared/src/index";
import type { Actor } from "../../../packages/settings/src/index";
import { sql, tenant } from "../../../packages/db/src/index";
const days = (value: unknown): 7 | 30 | 90 =>
  z
    .union([z.literal(7), z.literal(30), z.literal(90)])
    .parse(Number(value ?? 30));
export async function analysisInteraction(
  db: Database,
  s: Scope,
  actor: Actor,
  issue: Issue,
  locale: UiLocale,
  intent: Record<string, unknown>,
  values: string[] | undefined,
  customId: string,
) {
  const service = new AnalysisService(db),
    action = String(intent.action);
  if (action === "analysisAttentionList") {
    const offset = z
      .number()
      .int()
      .min(0)
      .max(1000)
      .parse(intent.offset ?? 0);
    return analysisAttentionListPanel(
      issue,
      await service.attentionList(s, actor, offset),
      offset,
      locale,
    );
  }
  if (
    action === "analysisAttentionItem" ||
    action === "analysisAttentionUpdate"
  ) {
    const key = z.string().max(100).parse(intent.key);
    if (action === "analysisAttentionUpdate")
      await service.attentionUpdate(
        s,
        actor,
        key,
        z.number().int().nonnegative().parse(intent.version),
        z.enum(["ACKNOWLEDGED", "RESOLVED"]).parse(intent.status),
      );
    return analysisAttentionItemPanel(
      issue,
      await service.attentionItem(s, actor, key),
      locale,
    );
  }
  if (action === "analysisMenu")
    return analysisMenuPanel(
      issue,
      await service.menu(s, actor, days(values?.[0] ?? intent.days)),
      locale,
    );
  if (action === "analysisPreview")
    return analysisPreviewPanel(
      issue,
      await service.preview(s, actor, {
        type: z.enum(analysisTypes).parse(values?.[0] ?? intent.type),
        days: days(intent.days),
        periodStart: intent.periodStart ? z.iso.datetime().parse(intent.periodStart) : undefined,
        periodEnd: intent.periodEnd ? z.iso.datetime().parse(intent.periodEnd) : undefined,
        correctionOf: intent.correctionOf ? z.uuid().parse(intent.correctionOf) : undefined,
      }),
      locale,
    );
  if (action === "analysisStart" || action === "analysisRerun") {
    const accepted = await service.request(
      s,
      actor,
      {
        type: z.enum(analysisTypes).parse(intent.type),
        days: days(intent.days),
        periodStart: z.iso.datetime().parse(intent.periodStart),
        periodEnd: z.iso.datetime().parse(intent.periodEnd),
        correctionOf: intent.correctionOf ? z.uuid().parse(intent.correctionOf) : undefined,
      },
      fingerprint([customId]),
      {
        revision: z.number().int().nonnegative().parse(intent.revision),
        fingerprint: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .parse(intent.fingerprint),
      },
      action === "analysisRerun",
    );
    return analysisResultPanel(
      issue,
      await service.result(s, actor, accepted.run.id),
      locale,
    );
  }
  if (action === "analysisHistory") {
    const filter = {
      type: intent.field === "type" ? values?.[0] === "all" ? undefined : z.enum(analysisTypes).parse(values?.[0]) : intent.type ? z.enum(analysisTypes).parse(intent.type) : undefined,
      status: intent.status ? z.enum(["QUEUED","PREPARING","RUNNING","FINALIZING","COMPLETED","FAILED","CANCELED"]).parse(intent.status) : undefined,
    };
    return analysisHistoryPanel(
      issue,
      await service.historyPage(s, actor, {
        ...filter,
        cursor: intent.cursor ? z.string().max(100).parse(intent.cursor) : undefined,
        direction: intent.direction ? z.enum(["next", "previous"]).parse(intent.direction) : undefined,
        limit: 5,
      }),
      locale,
      filter,
    );
  }
  const id = z.uuid().parse(intent.runId);
  if (action === "analysisCompare")
    return analysisComparisonPanel(
      issue,
      id,
      await service.compare(s, actor, id),
      locale,
    );
  let notice: string | undefined;
  if (action === "analysisCancel") {
    const canceled = await service.cancel(s, actor, id);
    notice = analysisCopy(locale, canceled.canceled ? "canceled" : "cancelStarted");
  }
  if (action === "analysisAttention") {
    const data = await service.result(s, actor, id);
    const concernKey = z.string().max(64).parse(intent.concernKey);
    const duplicate = (await sql<{ exists: boolean }>`SELECT EXISTS(SELECT 1 FROM attention_items WHERE ${tenant(s)} AND message_id=${"analysis:" + id + ":" + concernKey}) AS exists`.execute(db)).rows[0]!.exists;
    return analysisAttentionConfirmationPanel(issue, data, concernKey, duplicate, locale);
  }
  if (action === "analysisAttentionConfirm") {
    await service.attention(
      s,
      actor,
      id,
      z.string().max(64).parse(intent.concernKey),
    );
    notice = analysisCopy(locale, "added");
  }
  return analysisResultPanel(
    issue,
    await service.result(s, actor, id),
    locale,
    notice,
    action === "analysisEvidence",
    z.number().int().nonnegative().max(1000).parse(intent.detailPage ?? 0),
  );
}
