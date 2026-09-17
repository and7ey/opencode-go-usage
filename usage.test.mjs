import assert from "node:assert/strict"
import { test } from "node:test"
import {
  authFilePath,
  fetchUsage,
  forecastLevel,
  formatPercent,
  formatUsage,
  isGoProvider,
  maxPercent,
  modelFilePath,
  parseUsage,
  readGoKey,
  readRecentProvider,
  usageSegments,
  windowProgress,
  worstLevel,
} from "./usage.mjs"

const SAMPLE = {
  usage: {
    rolling: { status: "ok", percent: 4, resetsAt: "2026-09-15T12:15:06.200Z" },
    weekly: { status: "ok", percent: 1.5, resetsAt: "2026-09-21T00:00:00.200Z" },
    monthly: { status: "ok", percent: 0, resetsAt: "2026-10-15T07:12:53.200Z" },
  },
}

const NOW = Date.parse("2026-09-17T12:00:00.000Z")
const AFTER = Date.parse("2030-01-01T00:00:00.000Z")

/** rolling window ending at 14:00Z, i.e. 3 of its 5 hours elapsed at NOW. */
const rolling = (percent) => ({ percent, resetsAt: "2026-09-17T14:00:00.000Z" })

test("authFilePath honours XDG_DATA_HOME", () => {
  assert.equal(authFilePath({ XDG_DATA_HOME: "/data" }, "/home/me"), "/data/opencode/auth.json")
})

test("authFilePath falls back to ~/.local/share", () => {
  assert.equal(authFilePath({}, "/home/me"), "/home/me/.local/share/opencode/auth.json")
})

test("readGoKey returns the stored key", () => {
  const readFile = () => JSON.stringify({ "opencode-go": { type: "api", key: "  secret  " } })
  assert.equal(readGoKey({ readFile }), "secret")
})

test("readGoKey returns null for missing provider, empty key and bad json", () => {
  assert.equal(readGoKey({ readFile: () => JSON.stringify({ openrouter: { key: "x" } }) }), null)
  assert.equal(readGoKey({ readFile: () => JSON.stringify({ "opencode-go": { key: "" } }) }), null)
  assert.equal(readGoKey({ readFile: () => "not json" }), null)
  assert.equal(
    readGoKey({
      readFile: () => {
        throw new Error("ENOENT")
      },
    }),
    null,
  )
})

test("modelFilePath honours XDG_STATE_HOME", () => {
  assert.equal(modelFilePath({ XDG_STATE_HOME: "/state" }, "/home/me"), "/state/opencode/model.json")
  assert.equal(modelFilePath({}, "/home/me"), "/home/me/.local/state/opencode/model.json")
})

test("readRecentProvider reads the most recently used provider", () => {
  const readFile = () =>
    JSON.stringify({ recent: [{ providerID: "opencode-go", modelID: "deepseek-v4.1-flash" }] })
  assert.equal(readRecentProvider({ readFile }), "opencode-go")
})

test("readRecentProvider returns null for empty, malformed and missing files", () => {
  assert.equal(readRecentProvider({ readFile: () => JSON.stringify({ recent: [] }) }), null)
  assert.equal(readRecentProvider({ readFile: () => "nope" }), null)
  assert.equal(
    readRecentProvider({
      readFile: () => {
        throw new Error("ENOENT")
      },
    }),
    null,
  )
})

test("formatPercent drops the decimal the API does not report", () => {
  assert.equal(formatPercent(13), "13%")
  assert.equal(formatPercent(0), "0%")
  assert.equal(formatPercent(1.5), "1.5%")
  assert.equal(formatPercent(13.000000001), "13%")
  assert.equal(formatPercent(12.34), "12.3%")
})

test("windowProgress reports the elapsed share of a window", () => {
  const rollingHalf = windowProgress("rolling", { resetsAt: "2026-09-17T14:00:00.000Z", now: NOW })
  assert.equal(rollingHalf.progress, 0.6)
  assert.equal(rollingHalf.remainingMs, 2 * 60 * 60 * 1000)

  const weekly = windowProgress("weekly", { resetsAt: "2026-09-21T00:00:00.000Z", now: NOW })
  assert.equal(weekly.progress, 0.5)
  assert.equal(weekly.total, 7 * 24 * 60 * 60 * 1000)
})

test("windowProgress treats the month as a calendar month", () => {
  const february = windowProgress("monthly", { resetsAt: "2026-03-15T00:00:00.000Z", now: NOW })
  assert.equal(february.start, Date.parse("2026-02-15T00:00:00.000Z"))
  assert.equal(february.total, 28 * 24 * 60 * 60 * 1000)

  const clamped = windowProgress("monthly", { resetsAt: "2026-03-31T00:00:00.000Z", now: NOW })
  assert.equal(clamped.start, Date.parse("2026-02-28T00:00:00.000Z"))
})

test("windowProgress gives up on unusable input", () => {
  assert.equal(windowProgress("rolling", { now: NOW }), null)
  assert.equal(windowProgress("rolling", { resetsAt: "nonsense", now: NOW }), null)
  assert.equal(windowProgress("nope", { resetsAt: "2026-09-17T14:00:00.000Z", now: NOW }), null)
})

test("forecastLevel is green while the pace fits the window", () => {
  const verdict = forecastLevel(rolling(30), "rolling", NOW)
  assert.equal(verdict.level, "green")
  assert.equal(verdict.projected, 50)
  assert.equal(verdict.progress, 0.6)
})

test("forecastLevel turns yellow when the pace lands on 80%+", () => {
  const verdict = forecastLevel(rolling(48), "rolling", NOW)
  assert.equal(verdict.projected, 80)
  assert.equal(verdict.level, "yellow")
})

test("forecastLevel turns red when the pace overshoots the limit", () => {
  const verdict = forecastLevel(rolling(70), "rolling", NOW)
  assert.equal(verdict.level, "red")
  assert.equal(Math.round(verdict.projected), 117)
})

test("forecastLevel trusts the current percentage alone early in a window", () => {
  const early = forecastLevel({ percent: 14, resetsAt: "2026-10-15T07:12:53.508Z" }, "monthly", NOW)
  assert.ok(early.progress < 0.1)
  assert.equal(early.projected, null)
  assert.equal(early.level, "green")
})

test("forecastLevel judges the current percentage when there is no reset time", () => {
  assert.deepEqual(forecastLevel({ percent: 10 }, "rolling", NOW), {
    level: "green",
    projected: null,
    progress: null,
    remainingMs: null,
  })
  assert.equal(forecastLevel({ percent: 60 }, "rolling", NOW).level, "yellow")
  assert.equal(forecastLevel({ percent: 85 }, "rolling", NOW).level, "yellow")
  assert.equal(forecastLevel({ percent: 100 }, "rolling", NOW).level, "red")
  assert.equal(forecastLevel({ percent: "nope" }, "rolling", NOW), null)
})

test("usageSegments tags every window with its own verdict", () => {
  const parsed = parseUsage({
    usage: {
      rolling: { percent: 70, resetsAt: "2026-09-17T14:00:00.000Z" },
      weekly: { percent: 28, resetsAt: "2026-09-21T00:00:00.000Z" },
      monthly: { percent: 14, resetsAt: "2026-10-15T07:12:53.508Z" },
    },
  })
  const segments = usageSegments(parsed, { now: NOW })
  assert.deepEqual(
    segments.map((segment) => [segment.label, segment.level, segment.text]),
    [
      ["5h", "red", "5h 70% ◆"],
      ["week", "green", "week 28% ◆"],
      ["month", "green", "month 14% ◆"],
    ],
  )
  assert.equal(usageSegments(null), null)
})

test("worstLevel picks the most severe window", () => {
  const parsed = parseUsage({
    usage: {
      rolling: { percent: 70, resetsAt: "2026-09-17T14:00:00.000Z" },
      weekly: { percent: 60, resetsAt: "2026-09-21T00:00:00.000Z" },
    },
  })
  assert.equal(worstLevel(parsed, { now: NOW }), "red")
  assert.equal(worstLevel(parseUsage(SAMPLE), { now: AFTER }), "green")
  assert.equal(worstLevel(null), null)
})

test("parseUsage normalizes the payload", () => {
  const parsed = parseUsage(SAMPLE)
  assert.deepEqual(parsed.rolling, {
    label: "5h",
    percent: 4,
    status: "ok",
    resetsAt: "2026-09-15T12:15:06.200Z",
  })
  assert.equal(parsed.weekly.percent, 1.5)
  assert.equal(parsed.monthly.label, "month")
})

test("parseUsage tolerates missing windows and bad payloads", () => {
  assert.equal(parseUsage(null), null)
  assert.equal(parseUsage({}), null)
  assert.equal(parseUsage({ usage: { rolling: { percent: "nope" } } }), null)
  const partial = parseUsage({ usage: { rolling: { percent: 10 } } })
  assert.deepEqual(Object.keys(partial), ["rolling"])
})

test("formatUsage renders all windows with their verdicts", () => {
  assert.equal(formatUsage(parseUsage(SAMPLE), { now: AFTER }), "Go 5h 4% ◆ · week 1.5% ◆ · month 0% ◆")
  assert.equal(formatUsage(parseUsage(SAMPLE), { now: AFTER, indicators: false }), "Go 5h 4% · week 1.5% · month 0%")
  assert.equal(formatUsage(parseUsage(SAMPLE), { now: AFTER, prefix: "Go!", separator: "  " }), "Go! 5h 4% ◆  week 1.5% ◆  month 0% ◆")
  assert.equal(formatUsage(null), null)
})

test("maxPercent picks the highest window", () => {
  assert.equal(maxPercent(parseUsage(SAMPLE)), 4)
  assert.equal(maxPercent(null), 0)
})

test("isGoProvider matches only the Go provider", () => {
  assert.equal(isGoProvider("opencode-go"), true)
  assert.equal(isGoProvider("opencode-go/deepseek-v4.1-flash"), true)
  assert.equal(isGoProvider("opencode"), false)
  assert.equal(isGoProvider("openrouter/stealth/ox-alpha"), false)
  assert.equal(isGoProvider(undefined), false)
})

test("fetchUsage sends the bearer token and parses the response", async () => {
  let seenAuth
  const fetchImpl = async (_url, init) => {
    seenAuth = init.headers.Authorization
    return { ok: true, status: 200, json: async () => SAMPLE }
  }
  const parsed = await fetchUsage("secret", { fetchImpl })
  assert.equal(seenAuth, "Bearer secret")
  assert.equal(parsed.rolling.percent, 4)
})

test("fetchUsage throws on a bad status, bad body and missing key", async () => {
  const unauthorized = async () => ({ ok: false, status: 401, json: async () => ({}) })
  await assert.rejects(() => fetchUsage("secret", { fetchImpl: unauthorized }), /401/)

  const nonsense = async () => ({ ok: true, status: 200, json: async () => ({ hello: "world" }) })
  await assert.rejects(() => fetchUsage("secret", { fetchImpl: nonsense }), /unexpected usage response/)

  await assert.rejects(() => fetchUsage("", { fetchImpl: async () => ({}) }), /missing OpenCode Go API key/)
})
