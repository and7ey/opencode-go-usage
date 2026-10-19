import { Plugin } from "@opencode/plugin/tui"
import { jsx } from "@opentui/solid/jsx-runtime"
import { createSignal, Show } from "solid-js"
import {
  fetchUsage,
  formatPercent,
  goKeyFromCredentials,
  isGoProvider,
  LEVEL_INDICATOR,
  readGoKey,
  usageSegments,
  worstLevel,
} from "./usage.mjs"

const REFRESH_MS = 60_000
const TICK_MS = 60_000

/** Feedback colours from the active theme; falls back to the base text colour. */
function levelColor(theme, level) {
  const feedback = theme?.text?.feedback
  if (level === "red") return feedback?.error?.base ?? theme?.text?.base
  if (level === "yellow") return feedback?.warning?.base ?? theme?.text?.base
  return feedback?.success?.base ?? theme?.text?.base
}

/**
 * The banner as sibling `<text>` nodes: labels and values take the line colour,
 * while the small diamond after each value takes its own window's colour. A red
 * window gets its compact reset hint (`↻4h53m`) in the same colour.
 *
 * The nodes are built here, inside the slot renderer. Renderables created next
 * to the model live under the plugin root, and inserting those into the banner
 * fails with an orphan-text error.
 */
function renderLine(model) {
  const nodes = [
    jsx("text", {
      get fg() {
        return model.lineColor()
      },
      children: "Go ",
    }),
  ]
  const segments = model.segments() ?? []
  segments.forEach((segment, index) => {
    nodes.push(
      jsx("text", {
        get fg() {
          return model.lineColor()
        },
        get children() {
          return `${index > 0 ? " · " : ""}${segment.label} ${formatPercent(segment.percent)} `
        },
      }),
      jsx("text", {
        get fg() {
          return model.levelColor(segment.level)
        },
        children: LEVEL_INDICATOR,
      }),
    )
    if (segment.reset) {
      nodes.push(
        jsx("text", {
          get fg() {
            return model.levelColor(segment.level)
          },
          get children() {
            return ` ↻${segment.reset}`
          },
        }),
      )
    }
  })
  return nodes
}

/**
 * Resolve the OpenCode Go API key.
 *
 * OpenCode 2 no longer writes `auth.json`: `/connect` stores the key in
 * OpenCode's credential store, exposed to plugins as
 * `client.credential.list()`. The legacy file remains the fallback for older
 * versions, or if the credential API is unavailable. Resolved on every refresh
 * so a re-`/connect` or a key rotation is picked up without restarting the TUI.
 */
async function resolveGoKey(context) {
  try {
    const entries = await context.client?.credential?.list?.()
    const key = goKeyFromCredentials(entries)
    if (key) return key
  } catch {
    // Credential API unavailable: fall back to the local file.
  }
  return readGoKey()
}

/**
 * OpenCode Go subscription usage banner (5h / week / month).
 *
 * Rendered in the `prompt.footer.status` slot, but only while the selected
 * provider is OpenCode Go. The provider comes from the prompt's selected model
 * (`context.ui.model.current()`), which is reactive, so switching providers or
 * sessions shows or hides the banner. Everything stays hidden when the key is
 * missing/expired, the network is down, or the request is rate limited.
 */
async function setup(context) {
  const [usage, setUsage] = createSignal(null)
  const [now, setNow] = createSignal(Date.now())

  /**
   * Created once in `setup`, outside the slot renderer: the renderer is
   * re-invoked whenever the signals change, so no effects or fetches may live
   * inside it.
   */
  const model = {
    segments() {
      const parsed = usage()
      if (!isGoProvider(context.ui.model.current()?.providerID) || !parsed) return null
      return usageSegments(parsed, { now: now() })
    },
    visible() {
      return model.segments() !== null
    },
    lineColor() {
      return levelColor(context.theme, worstLevel(usage(), { now: now() }) ?? "green")
    },
    levelColor(level) {
      return levelColor(context.theme, level)
    },
  }

  let stopped = false

  async function refresh() {
    if (stopped) return
    try {
      const key = await resolveGoKey(context)
      if (!key) return
      const parsed = await fetchUsage(key)
      if (!stopped) setUsage(parsed)
    } catch {
      // Missing/expired keys, network errors and rate limits keep the banner hidden.
    }
  }

  void refresh()
  const refreshTimer = setInterval(() => void refresh(), REFRESH_MS)
  // Advance the clock so the reset hint counts down between fetches.
  const clock = setInterval(() => setNow(Date.now()), TICK_MS)
  let stopEvent
  try {
    stopEvent = context.data.on("session.idle", () => void refresh())
  } catch {
    // Event bus unavailable: the timer still refreshes.
  }

  context.ui.slot({
    append: "prompt.footer.status",
    render: () =>
      jsx(Show, {
        get when() {
          return model.visible()
        },
        get children() {
          return jsx("box", {
            flexDirection: "row",
            paddingLeft: 1,
            get children() {
              return renderLine(model)
            },
          })
        },
      }),
  })

  return () => {
    stopped = true
    clearInterval(refreshTimer)
    clearInterval(clock)
    stopEvent?.()
  }
}

export default Plugin.define({ id: "opencode-go-usage", setup })
export { setup }
