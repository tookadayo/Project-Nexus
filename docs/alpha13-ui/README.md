# alpha.13 UI evidence

Captured 2026-10-09 on Mac Chromium, synthetic data only. No live Discord or OAuth.

- [Home at 320px](home-ja-320.png): compact blue N, one-column summary, long synthetic server name.
- [Home at 1440px](home-ja-1440.png): original wordmark, four primary entries and grouped secondary navigation.
- [History at 390px](view-3-ja-390.png): distinction between saved response results and Discord detailed-analysis history; empty fixture.
- [Settings at 390px](view-4-ja-390.png): existing settings retained; empty fixture, full-page image.
- [Built public page at 390px](public-390.png): actual Next production build, original wordmark and loaded local font.

The dashboard shots come from `tests/ui/alpha13-smoke.ts` using actual UI components and mocked responses. The public page comes from `tests/ui/alpha13-public.ts` with an environment whitelist and no credentials. Browser requests outside loopback were blocked. Additional widths and JA/EN captures remain in `.local/alpha13-ui/`.

These are lightweight visual evidence, not real-server acceptance, populated-data coverage, pixel-perfect certification or screenreader evidence. See [implementation and verification record](../alpha13-ux.md).

## Follow-up verification

The current captures include the draft/filter/server-scope follow-up. [Explore](explore-followup-1440.png) and [Operations](operations-followup-1440.png) show the corrected white surfaces and shared typography/buttons with synthetic authorized responses. Their read/write services are mocked; these are not live-server screenshots. The follow-up script also checks draft cancellation, native beforeunload, save success/failure, edits during a pending save and filter history restoration. See [current acceptance matrix](../alpha13-acceptance.md).
