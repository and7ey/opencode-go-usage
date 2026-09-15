import assert from "node:assert/strict"
import { test } from "node:test"
import {
  authFilePath,
  fetchUsage,
  formatUsage,
  isGoProvider,
  maxPercent,
  modelFilePath,
  parseUsage,
  readGoKey,
  readRecentProvider,
} from "./usage.mjs"

const SAMPLE = {
  usage: {
    rolling: { status: "ok", percent: 4, resetsAt: "2026-09-15T12:15:06.200Z" },
    weekly: { status: "ok", percent: 1.5, resetsAt: "2026-09-21T00:00:00.200Z" },
    monthly: { status: "ok", percent: 0, resetsAt: "2026-10-15T07:12:53.200Z" },
  },
}

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

test("formatUsage renders all windows", () => {
  assert.equal(formatUsage(parseUsage(SAMPLE)), "Go 5h 4.0% · week 1.5% · month 0.0%")
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
