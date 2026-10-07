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

const WINDOW_MS = {
  rolling: 5 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
}

/** Small diamond marker. The glyph carries no colour of its own: the renderer tints it by level. */
export const LEVEL_INDICATOR = "◆"

const LEVEL_RANK = { green: 0, yellow: 1, red: 2 }

const CAUTION_PERCENT = 50
const WARN_PERCENT = 80
const LIMIT_PERCENT = 100

/**
 * Below this share of the window a projection is pure noise, so only the current
 * percentage is judged. 10% of a 5h window is 30min, of a month about three days.
 */
const MIN_PROGRESS = 0.1

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

/** Shifts an instant by whole months in UTC, clamping the day to the target month's length. */
function shiftMonths(time, months) {
  const date = new Date(time)
  const day = date.getUTCDate()
  const shifted = new Date(time)
  shifted.setUTCDate(1)
  shifted.setUTCMonth(shifted.getUTCMonth() + months)
  const daysInTarget = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate()
  shifted.setUTCDate(Math.min(day, daysInTarget))
  return shifted.getTime()
}

/**
 * How far into a window we are. Each window ends at `resetsAt`; its length is
 * nominal (5h / 7d) except the monthly one, which is a calendar month.
 * Returns `null` when `resetsAt` is missing or unusable.
 */
export function windowProgress(key, { resetsAt, now = Date.now() } = {}) {
  const end = typeof resetsAt === "string" ? Date.parse(resetsAt) : NaN
  if (!Number.isFinite(end)) return null
  const start = key === "monthly" ? shiftMonths(end, -1) : end - WINDOW_MS[key]
  if (!Number.isFinite(start)) return null
  const total = end - start
  if (!(total > 0)) return null
  const progress = Math.min(1, Math.max(0, (now - start) / total))
  return { start, end, total, progress, remainingMs: Math.max(0, end - now) }
}

/**
 * The red/yellow/green verdict for one window.
 *
 * The current percentage alone decides at 50% (yellow) and 100% (red). On top of
 * that, once at least `MIN_PROGRESS` of the window has elapsed, the pace so far is
 * extrapolated to `resetsAt`: landing on 80%+ is yellow, on 100%+ is red. A window
 * that is too young to extrapolate is judged on its current percentage only.
 * `projected` stays `null` when no projection was possible.
 */
export function forecastLevel(item, key, now = Date.now()) {
  const percent = Number(item?.percent)
  if (!Number.isFinite(percent)) return null
  const elapsed = windowProgress(key, { resetsAt: item?.resetsAt, now })
  let level = "green"
  if (percent >= CAUTION_PERCENT) level = "yellow"
  if (percent >= LIMIT_PERCENT) level = "red"
  let projected = null
  if (elapsed && elapsed.progress >= MIN_PROGRESS) {
    projected = percent / elapsed.progress
    if (projected >= LIMIT_PERCENT) level = "red"
    else if (projected >= WARN_PERCENT && level === "green") level = "yellow"
  }
  return {
    level,
    projected,
    progress: elapsed?.progress ?? null,
    remainingMs: elapsed?.remainingMs ?? null,
  }
}

/** `13`, `1.5` — one decimal only when the API actually reports one. */
export function formatPercent(percent) {
  const rounded = Math.round(percent * 10) / 10
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`
}

/**
 * Compact time until a window resets: `4h53m`, `2d3h`, `53m`, `<1m`.
 *
 * Whole units only (the seconds are dropped) and the trailing zero unit is
 * omitted, so the hint stays short next to the value. Returns `null` for an
 * unknown or already-elapsed remaining time.
 */
export function formatRemaining(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null
  const totalMinutes = Math.floor(ms / 60_000)
  if (totalMinutes < 1) return "<1m"
  const minutes = totalMinutes % 60
  const totalHours = Math.floor(totalMinutes / 60)
  const hours = totalHours % 24
  const days = Math.floor(totalHours / 24)
  if (days > 0) return hours > 0 ? `${days}d${hours}h` : `${days}d`
  if (totalHours > 0) return minutes > 0 ? `${totalHours}h${minutes}m` : `${totalHours}h`
  return `${minutes}m`
}

/**
 * The line split into per-window pieces, each carrying its own verdict, so a
 * renderer can colour them individually. `null` when there is nothing to show.
 *
 * A red window additionally carries `reset`, the compact time until `resetsAt`
 * (see `formatRemaining`), so the reader knows when the overshoot clears. Pass
 * `resets: false` to suppress it; `resets` is `null` when unknown.
 */
export function usageSegments(parsed, { now = Date.now(), indicators = true, resets = true } = {}) {
  if (!parsed) return null
  const segments = WINDOWS.map(([key, label]) => {
    const item = parsed[key]
    if (!item) return null
    const verdict = forecastLevel(item, key, now)
    const level = verdict?.level ?? "green"
    const reset = resets && level === "red" ? formatRemaining(verdict?.remainingMs) : null
    return {
      key,
      label,
      percent: item.percent,
      level,
      projected: verdict?.projected ?? null,
      remainingMs: verdict?.remainingMs ?? null,
      reset,
      text: `${label} ${formatPercent(item.percent)}${indicators ? ` ${LEVEL_INDICATOR}` : ""}${reset ? ` ↻${reset}` : ""}`,
    }
  }).filter(Boolean)
  return segments.length > 0 ? segments : null
}

/** The most severe verdict across the windows, used to tint the whole line. */
export function worstLevel(parsed, { now = Date.now() } = {}) {
  const segments = usageSegments(parsed, { now, indicators: false })
  if (!segments) return null
  return segments.reduce((worst, { level }) => (LEVEL_RANK[level] > LEVEL_RANK[worst] ? level : worst), "green")
}

/**
 * Render the windows as one line, e.g. `Go 5h 4% ◆ · week 9% ◆ · month 2% ◆`.
 *
 * The marker is one glyph for every level, because it is meant to be tinted by the
 * segment's own `level` — read those from `usageSegments`, or use `worstLevel` for
 * the whole line. The plain string keeps no colour of its own.
 */
export function formatUsage(
  parsed,
  { prefix = "Go", separator = " · ", now = Date.now(), indicators = true, resets = true } = {},
) {
  const segments = usageSegments(parsed, { now, indicators, resets })
  if (!segments) return null
  return `${prefix} ${segments.map((segment) => segment.text).join(separator)}`
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
