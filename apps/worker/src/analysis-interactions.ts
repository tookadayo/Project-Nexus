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
} from "../../../packages/discord-panels/src/views/analysis";
import { analysisCopy } from "../../../packages/discord-panels/src/i18n/analysis";
import type { UiLocale } from "../../../packages/discord-panels/src/i18n";
import type { Issue } from "../../../packages/discord-panels/src/types";
import type { Database } from "../../../packages/db/src/index";
import type { Scope } from "../../../packages/shared/src/index";
import type { Actor } from "../../../packages/settings/src/index";
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
  if (action === "analysisHistory")
    return analysisHistoryPanel(
      issue,
      await service.history(s, actor, 5),
      locale,
    );
  const id = z.uuid().parse(intent.runId);
  if (action === "analysisCompare")
    return analysisComparisonPanel(
      issue,
      id,
      await service.compare(s, actor, id),
      locale,
    );
  let notice: string | undefined;
  if (action === "analysisAttention") {
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
  );
}
