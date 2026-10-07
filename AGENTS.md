# AGENTS.md

OpenCode **2 CLI (TUI) plugin** — not a CLI app and not a server plugin. It renders OpenCode Go
subscription usage (5h / week / month) in the `prompt.footer.status` slot. Published to npm as
`@and7ey/opencode-go-usage`. Node >= 18.

## Layout

- `usage.mjs` — pure logic: auth/model file paths, key lookup, payload parsing, forecast levels,
  reset-hint formatting, line formatting, provider gating, HTTP. **The tested module and the public
  `./usage` export.**
- `opencode-go-usage-tui.mjs` — the V2 CLI plugin (the `./tui` export) built with
  `Plugin.define({ id, setup })` from `@opencode/plugin/tui`. Imports `@opentui/solid/jsx-runtime`
  and `solid-js`; only runs inside OpenCode's TUI.
- `opencode-go-usage.mjs` — the server `main` export. Intentionally a no-op so the package is safe
  to reference from `opencode.json(c)` too.
- `usage.test.mjs` — `node:test` + `node:assert/strict` coverage of `usage.mjs` only.
- `cli.example.json` — example `~/.config/opencode/cli.json`. V2 TUI config lives in `cli.json`'s
  `plugins` array — **not** `opencode.json` and not the removed V1 `tui.json`.

## Commands

- `npm test` — runs `node --test usage.test.mjs` (no build/lint/typecheck step exists).
- Single test: `node --test --test-name-pattern="forecastLevel" usage.test.mjs`.
- Tests need no `npm install`; they import only Node builtins and `usage.mjs`.

## Conventions / gotchas

- **All behavior changes belong in `usage.mjs` with a test in `usage.test.mjs`.** The tests are the
  de-facto spec; the TUI file has no test harness and cannot be invoked standalone.
- This is the V2 plugin API. V1's `export default { id, tui }` / `api.slots.register({ slots:
  { app_bottom } })` does **not** work in V2 — do not reintroduce it.
- The reset hint (`↻4h53m`, via `formatRemaining`) is emitted **only for red windows**; segments
  carry a `reset` field, and `usageSegments(..., { resets: false })` suppresses it. Green/yellow
  windows never show one.
- The plugin is deliberately **fail-silent**: missing key, non-Go provider, network error, rate
  limit, or a bad response all just keep the banner hidden. Don't introduce throwing/logging there.
- In the TUI file, signals (`createSignal`) and timers are created once in `setup`, **outside** the
  slot renderer; the render function only reads signals (`usage()`, `now()`) and
  `context.ui.model.current()`, all reactive. Renderables must be built inside the slot renderer
  (`renderLine`) or OpenTUI throws an orphan-text error.
- Colours use semantic theme tokens: `context.theme.text.feedback.{error,warning,success}.base`
  (`context.theme.text.base` as fallback). The V1 `theme.error/warning/success` tokens are gone.
- The forecast assumes whole-percent API values and skips projection below 10% elapsed
  (`MIN_PROGRESS`); the monthly window is a calendar month (`shiftMonths`), the others nominal
  (5h / 7d).
- Package wiring: `./tui` is the CLI plugin and `main`/`.` the no-op server entry; `@opencode/plugin`
  is a dependency, `@opentui/solid` + `solid-js` are peers (the host provides them). Publishing is
  the `files` allowlist in `package.json` (tests are not published); no CI — bump `version` and
  publish manually.
