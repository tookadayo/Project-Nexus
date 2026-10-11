# Optional Discord application emoji

Emoji decorate existing controls. Text labels, action identifiers, disabled
states and authorization remain the source of meaning. Configuration does not
register emoji, contact Discord, or add permissions.

## Configuration

- `NEXUS_EMOJI_MODE=custom` uses valid, explicitly confirmed entries; missing or
  invalid entries fall back to Unicode.
- `NEXUS_EMOJI_MODE=unicode` forces Unicode.
- `NEXUS_EMOJI_MODE=text` omits decoration and preserves the text label.
- `NEXUS_APPLICATION_EMOJIS` accepts a JSON object with `applicationId` and
  `emojis`. The application must match the existing `DISCORD_APPLICATION_ID`.

[application-emojis.example.json](application-emojis.example.json) is deliberately
**unconfigured**: its application ID is blank and it contains no registrations.
It does not enable custom emoji. Configure actual registrations through the
deployment's existing private configuration mechanism; do not commit them or
credentials to this example.

Recognized keys are `overview`, `analysis`, `attention`, `history`, `settings`,
`help`, `done` and `news`. Each configured entry uses a valid Discord ID, optional
fixed name `nx_<key>`, and `status: "confirmed"`. Confirm the registration belongs
to that application before using this status. It is an operator declaration,
not proof of an API ownership check. Unverified, deleted, malformed and
foreign-application entries fall back safely. Invalid optional configuration
must not prevent startup.

## Display and delivery

Buttons and String Select options use Discord's dedicated emoji field. Existing
body headings use Unicode or text. Premium buttons and Discord-generated
selection options are not decorated by this feature.

A structured rejection attributable only to eligible configured emoji fields
can trigger one display retry with Unicode. It must preserve the original
destination, authorization and operation identity. It does not rerun a business
action. Timeouts, ambiguous failures and unrelated validation errors must not be
treated as an emoji rejection.

## Checks and limitations

```sh
corepack pnpm exec vitest run tests/unit/application-emoji.test.ts tests/unit/application-emoji-panels.test.ts tests/unit/application-emoji-transport.test.ts
node --import tsx tests/ui/application-emojis.ts
```

The browser harness uses synthetic inputs and approximates Discord layout; it
does not establish actual Discord rendering, registration ownership or mobile
client behavior. Report those checks separately when performed. See
[known historical failures](alpha14-existing-test-failures.md) before interpreting
any broader test result.
