import { jsx } from "@opentui/solid/jsx-runtime"
import { createMemo, createRoot, createSignal, Show } from "solid-js"
import {
  formatPercent,
  isGoProvider,
  LEVEL_INDICATOR,
  readGoKey,
  readRecentProvider,
  fetchUsage,
  usageSegments,
  worstLevel,
} from "./usage.mjs"

const REFRESH_MS = 60_000

/**
 * The banner as sibling `<text>` nodes: labels and values take the line colour, while
 * the small diamond after each value takes its own window's colour.
 *
 * The nodes are built here, inside the slot. Renderables created next to the model live
 * under the plugin root, and inserting those into the banner fails with an orphan-text
 * error.
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
  })
  return nodes
}

/**
 * OpenCode Go subscription usage banner (5h / week / month).
 *
 * Rendered in the `app_bottom` slot, but only while the active provider is
 * OpenCode Go. The active provider is read from the current session's last
 * assistant message, falling back to the configured default model and finally
 * to the most recently used model. Everything is hidden unless it resolves to Go.
 */
async function tui(api) {
  const apiKey = readGoKey()

  // Created once, outside the slot renderer: the renderer is re-invoked whenever
  // the signals change, so no effects or fetches may live inside it.
  const model = createRoot((dispose) => {
    const [usage, setUsage] = createSignal(null)
    const [recentProvider, setRecentProvider] = createSignal(readRecentProvider())

    const activeProvider = createMemo(() => {
      try {
        const route = api.route?.current
        const sessionID = route?.name === "session" ? route.params?.sessionID : undefined
        if (sessionID) {
          const messages = api.state.session.messages(sessionID) ?? []
          for (let i = messages.length - 1; i >= 0; i--) {
            const message = messages[i]
            if (message?.role === "assistant" && typeof message.providerID === "string") {
              return message.providerID
            }
          }
        }
        const configured = api.state?.config?.model
        if (typeof configured === "string") return configured
      } catch {
        // Fall through to the persisted recent model.
      }
      return recentProvider()
    })

    const visible = createMemo(() => isGoProvider(activeProvider()) && usage() !== null)

    const segments = createMemo(() => usageSegments(usage()))

    const lineColor = createMemo(() => levelColor(worstLevel(usage())))

    function levelColor(level) {
      const theme = api.theme?.current
      if (level === "red") return theme?.error ?? theme?.text
      if (level === "yellow") return theme?.warning ?? theme?.text
      return theme?.success ?? theme?.text
    }

    let stopped = false

    async function refresh() {
      if (!apiKey || stopped) return
      setRecentProvider(readRecentProvider())
      try {
        const parsed = await fetchUsage(apiKey)
        if (!stopped) setUsage(parsed)
      } catch {
        // Missing/expired keys, network errors and rate limits keep the banner hidden.
      }
    }

    if (apiKey) {
      refresh()
      const timer = setInterval(refresh, REFRESH_MS)
      try {
        api.event.on("session.idle", () => {
          refresh()
        })
      } catch {
        // Event bus unavailable: the timer still refreshes.
      }
      api.lifecycle?.onDispose?.(() => {
        stopped = true
        clearInterval(timer)
        dispose()
      })
    }

    return { visible, segments, lineColor, levelColor }
  })

  api.slots.register({
    order: 150,
    slots: {
      app_bottom() {
        return jsx(Show, {
          get when() {
            return model.visible()
          },
          get children() {
            return jsx("box", {
              flexDirection: "row",
              paddingLeft: 1,
              paddingRight: 1,
              get children() {
                return renderLine(model)
              },
            })
          },
        })
      },
    },
  })
}

export { tui }
export default { id: "opencode-go-usage", tui }
