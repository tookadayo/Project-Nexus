# Public website presentation

The public site uses a shared white-and-blue presentation in Japanese and
English. Existing product capabilities, five-plan definitions, public route
boundaries and authorization remain unchanged by this presentation layer.

## Navigation and content

- The primary entries are Product, Getting started, Pricing, Updates and Support.
  Page links and disclosure buttons have separate purposes.
- Desktop panels support fine-pointer hover, explicit activation, focus retention,
  Escape and outside dismissal. Mobile uses a modal dialog with focus and scroll
  restoration. Native server-rendered navigation remains reachable without JS.
- Home connects the product introduction, real UI example, interactive synthetic
  demo, workflows, setup/data explanation, Beta/standard plans, updates and FAQ.
- The hero contains static screenshots of the real Attention component using
  synthetic data. They are identified as still images. The separate chart demo
  supports its existing range, view, evidence and reset controls.
- Public legal pages show availability status; private review documents and
  settings are not public content. Support does not imply a successful send when
  intake is disabled. Failed announcement retrieval is not an empty list.

## Layout and meaning

Pricing cards share rows for plan name, purpose, price/tax state, action,
conditions, feature highlights and the full-comparison link. Responsive layouts
keep all five plans in order. Do not truncate conditions or alter plan values to
obtain alignment.

Missing data, partial coverage and measured zero remain different. Descriptions
must not promise access to post bodies, automatic problem resolution, sentiment
inference or causal improvement unless those capabilities are established.
Keep synthetic-data and static/interactive distinctions visible.

## Focused verification

After a web build, run:

```sh
node --import tsx tests/ui/official-site-r3.ts
```

Check representative JA/EN desktop/mobile pages, narrow widths and breakpoint
neighbors, menu input/focus behavior, skip links, language switching, table
scrolling, demo controls, reduced motion and JS-disabled content. Inspect actual
screenshots as well as geometry assertions. State whether zoom checks use a
desktop approximation rather than physical-device or native text zoom.

Record current results separately. No full-suite, performance, accessibility or
deployment pass is implied here. The
[known historical failures](alpha14-existing-test-failures.md) and
[publication conditions](alpha14-publication-gates.md) remain applicable.
