import type { UiLocale } from "../../../packages/discord-panels/src/i18n";
export function promotionModal(customId: string, locale: UiLocale) {
  return {
    title: locale === "ja" ? "プロモーションコード" : "Promotion code",
    custom_id: customId,
    components: [
      {
        type: 1 as const,
        components: [
          {
            type: 4 as const,
            style: 1 as const,
            custom_id: "promotionCode",
            label: locale === "ja" ? "コード" : "Code",
            required: true,
            max_length: 128,
          },
        ],
      },
    ],
  };
}
