// C81: in camp mode the road page shows him at work only for the Heir's message and while a council is written (Soushi,
// 2026-10-11 06:59: "'The caretaker is...' is still messing even when you are not active. It should now be only when I talk to
// him from the board").
import { describe, expect, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { comment } from "../src/caretaker.ts"
import { root } from "../src/paths.ts"
import { feed, roadPanel, setCaretaker } from "../src/road.ts"

const withEnv = async (env: Record<string, string>, f: () => Promise<void>) => {
  const was = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]))
  Object.assign(process.env, env)
  try { await f() } finally { for (const [k, v] of Object.entries(was)) v === undefined ? delete process.env[k] : (process.env[k] = v) }
}

describe("C81: he is shown at work only when he is", () => {
  test("the feed serves his mode, camp when he has said nothing, and a council only while it is written", async () => {
    const out = join(root, ".dd-runtime", "test-camp-busy"), log = join(out, "peek.txt")
    rmSync(out, { recursive: true, force: true }); mkdirSync(join(out, "chronicle", "generated_1_t"), { recursive: true })
    await Bun.write(join(out, "chronicle", "generated_1_t", "0040.json"), JSON.stringify({ at: "", dungeon: "weald", difficulty: 1, length: 2, quest: "explore", key: "k", torch: 60, inBattle: false, supplies: { food: 4 }, tally: {}, heroes: [] }))
    await withEnv({ DD_TOWN_OUT: out, DD_INFERENCE: join(root, "test", "stubs", "inference-peek.ts"), STUB_LOG: log }, async () => {
      expect((await feed()).caretaker).toEqual({ mode: "camp" })
      setCaretaker({ mode: "live" })
      expect((await feed()).caretaker).toEqual({ mode: "live" })
      setCaretaker({ mode: "camp" })
      expect(await comment("camp", "PAGE 0040 AT THE FIRE", "0040")).toBe(true)
      // while the council was written, the page read it; once said, it is gone
      expect(JSON.parse(await Bun.file(log).text())).toMatchObject({ mode: "camp", council: { page: "0040" } })
      expect((await feed()).caretaker).toEqual({ mode: "camp" })
    })
    rmSync(out, { recursive: true, force: true })
  })

  test("the busy line: his message always, the fire while a council is written, a notable page only in live mode", () => {
    expect(roadPanel).toContain(`ct.mode==="live"&&s&&s.notableAt&&fresh(s.notableAt)`)
    expect(roadPanel).toMatch(/asked&&fresh\(asked\.at\)\?say\([^)]*\):fire\?say\(/)
  })
})
