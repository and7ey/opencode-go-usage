# opencode-go-usage

An [OpenCode](https://opencode.ai) TUI plugin that shows your **OpenCode Go** subscription usage
in the bottom bar — the rolling **5h**, **week** and **month** windows.

```text
Go 5h 14% ◆ · week 28% ◆ · month 14% ◆
```

The diamond after each value is tinted red, yellow or green by that window's own forecast (see
[Colours](#colours)); it needs a colour-capable terminal to be read.

The banner appears **only while the active provider is OpenCode Go**; switch to another provider
and it disappears.

## How it works

OpenCode already stores your OpenCode Go API key locally in
`~/.local/share/opencode/auth.json` (under `opencode-go`). The plugin reads that key and calls the
same JSON endpoint the console uses:

```text
GET https://opencode.ai/zen/go/v1/usage
Authorization: Bearer <opencode-go key>
```

```json
{"usage":{
  "rolling":{"status":"ok","percent":7,"resetsAt":"..."},
  "weekly":{"status":"ok","percent":3,"resetsAt":"..."},
  "monthly":{"status":"ok","percent":1,"resetsAt":"..."}}}
```

No browser cookies, no page scraping, no database. Nothing is sent anywhere except to
`opencode.ai`, and the key never leaves your machine.

The active provider is taken from the current session's latest assistant message, falling back to
the configured default model and finally to the most recently used model. If it does not resolve to
OpenCode Go — or the key is missing/expired, the network is down, or the request is rate limited —
the banner simply stays hidden.

## Requirements

- OpenCode **1.18.x** with a TUI (the plugin uses the `app_bottom` slot).
- OpenCode Go connected in OpenCode (`/connect` → OpenCode Go). No extra configuration: the plugin
  reuses the stored key.

## Install

### From npm

Add the plugin to your **TUI** config (`~/.config/opencode/tui.json`), not `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["@and7ey/opencode-go-usage"]
}
```

OpenCode installs npm plugins with Bun on startup.

### From a local checkout

```bash
git clone https://github.com/and7ey/opencode-go-usage.git
cd opencode-go-usage
npm install
```

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/absolute/path/to/opencode-go-usage/opencode-go-usage-tui.mjs"]
}
```

Restart OpenCode after changing `tui.json`.

## Colours

Every window gets its own small diamond (`◆`) right after its value, tinted by that window alone;
the rest of the line is tinted by the most severe of the three.

| Diamond | Meaning |
| --- | --- |
| green | on pace — the current pace fits inside the limit |
| yellow | close — already 50%+, or on pace to land on 80%+ before the window resets |
| red | over — already at 100%, or on pace to overshoot it |

The forecast extrapolates the usage so far to the window's `resetsAt`. Until at least 10% of a
window has elapsed (30 minutes of the 5h window, about three days of the month) the pace is too
noisy to project, so only the current percentage is judged. The current percentage is never
extrapolated on a missing or unparsable `resetsAt`.

Note that the API reports whole percentages (`percent: 14`, not `14.3`), so decimals appear only if
the endpoint ever sends them.

## Development

```bash
npm test
```

The pure logic in `usage.mjs` (auth path, key lookup, payload parsing, window forecasting,
formatting, provider gating, HTTP handling) is covered by `usage.test.mjs` using `node --test`.

## License

[MIT](./LICENSE)
