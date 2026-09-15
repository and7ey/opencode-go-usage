import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * OpenCode Go subscription usage.
 *
 * Data comes from the same JSON endpoint the OpenCode console uses; it requires
 * the OpenCode Go API key that OpenCode already stores locally in `auth.json`.
 * No scraping, no cookies, no database.
 */

export const USAGE_URL = "https://opencode.ai/zen/go/v1/usage"
export const GO_PROVIDER_ID = "opencode-go"

function baseDir(xdg, fallback, home) {
  return xdg && xdg.length > 0 ? xdg : join(home, fallback)
}

/** `$XDG_DATA_HOME/opencode/auth.json`, or `~/.local/share/opencode/auth.json`. */
export function authFilePath(env = process.env, home = homedir()) {
  return join(baseDir(env.XDG_DATA_HOME, join(".local", "share"), home), "opencode", "auth.json")
}

/** `$XDG_STATE_HOME/opencode/model.json`, or `~/.local/state/opencode/model.json` (recent/favorite models). */
export function modelFilePath(env = process.env, home = homedir()) {
  return join(baseDir(env.XDG_STATE_HOME, join(".local", "state"), home), "opencode", "model.json")
}

function defaultReadFile(path) {
  return readFileSync(path, "utf8")
}

/** Read the OpenCode Go API key from the local OpenCode credentials file. */
export function readGoKey({ env = process.env, home = homedir(), readFile = defaultReadFile } = {}) {
  try {
    const raw = readFile(authFilePath(env, home))
    const auth = JSON.parse(raw)
    const key = auth?.[GO_PROVIDER_ID]?.key
    if (typeof key === "string" && key.trim().length > 0) return key.trim()
    return null
  } catch {
    return null
  }
}

/**
 * Provider of the most recently used model, from the TUI's `model.json`.
 * Mirrors the TUI's own fallback so the banner shows on the home screen too.
 */
export function readRecentProvider({ env = process.env, home = homedir(), readFile = defaultReadFile } = {}) {
  try {
    const data = JSON.parse(readFile(modelFilePath(env, home)))
    const first = Array.isArray(data?.recent) ? data.recent[0] : undefined
    const id = first?.providerID
    return typeof id === "string" && id.length > 0 ? id : null
  } catch {
    return null
  }
}

const WINDOWS = [
  ["rolling", "5h"],
  ["weekly", "week"],
  ["monthly", "month"],
]

/** Normalize the API payload into `{ rolling, weekly, monthly }` cards. */
export function parseUsage(payload) {
  const usage = payload?.usage
  if (!usage || typeof usage !== "object") return null
  const out = {}
  for (const [key, label] of WINDOWS) {
    const item = usage[key]
    if (!item || typeof item !== "object") continue
    const percent = Number(item.percent)
    if (!Number.isFinite(percent)) continue
    out[key] = {
      label,
      percent,
      status: typeof item.status === "string" ? item.status : undefined,
      resetsAt: typeof item.resetsAt === "string" ? item.resetsAt : undefined,
    }
  }
  return Object.keys(out).length > 0 ? out : null
}

/** Render `{ rolling, weekly, monthly }` as a single line, e.g. `Go 5h 4.0% · week 1.0% · month 0.0%`. */
export function formatUsage(parsed, { prefix = "Go", separator = " · " } = {}) {
  if (!parsed) return null
  const parts = WINDOWS.map(([key]) => {
    const item = parsed[key]
    if (!item) return null
    return `${item.label} ${item.percent.toFixed(1)}%`
  }).filter(Boolean)
  if (parts.length === 0) return null
  return `${prefix} ${parts.join(separator)}`
}

/** Highest window percentage, used to pick a colour. */
export function maxPercent(parsed) {
  if (!parsed) return 0
  return WINDOWS.reduce((max, [key]) => (parsed[key] ? Math.max(max, parsed[key].percent) : max), 0)
}

/** True when a provider id (or a `provider/model` reference) is OpenCode Go. */
export function isGoProvider(reference) {
  if (typeof reference !== "string") return false
  const slash = reference.indexOf("/")
  const id = slash === -1 ? reference : reference.slice(0, slash)
  return id === GO_PROVIDER_ID
}

/** Fetch and normalize the usage payload. Throws on a missing key, network error or bad response. */
export async function fetchUsage(key, { fetchImpl = globalThis.fetch, signal, url = USAGE_URL, timeoutMs = 10_000 } = {}) {
  if (typeof key !== "string" || key.length === 0) throw new Error("missing OpenCode Go API key")
  const controller = signal ? null : new AbortController()
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: signal ?? controller.signal,
    })
    if (!response.ok) throw new Error(`usage request failed with status ${response.status}`)
    const parsed = parseUsage(await response.json())
    if (!parsed) throw new Error("unexpected usage response")
    return parsed
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Read the local key and fetch usage in one step. Returns `null` when no key is configured. */
export async function loadUsage(options = {}) {
  const key = readGoKey(options)
  if (!key) return null
  return fetchUsage(key, options)
}
