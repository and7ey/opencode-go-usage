import { Plugin } from "@opencode/plugin"

/**
 * Server-side entrypoint. This package is a CLI-only plugin: the banner lives
 * in `opencode-go-usage-tui.mjs` and is loaded from the package's `./tui`
 * export. The server plugin is intentionally a no-op so the package is safe to
 * reference from `opencode.json(c)` as well.
 */
export default Plugin.define({ id: "opencode-go-usage", setup() {} })
