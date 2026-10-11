// C64: bun run caretaker comments each CHRON page and answers each ASK by himself through the PAI Inference tool, posting
// through say(); a failed or hung call posts nothing and prints a WARN. Stubs stand in for the tool; nothing reaches a model.
import { describe, expect, spyOn, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { comment, SYSTEM } from "../src/caretaker.ts"
import { feed } from "../src/road.ts"
import { root } from "../src/paths.ts"

const out = join(root, ".dd-runtime", "test-caretaker"), stub = (n: string) => join(root, "test", "stubs", `inference-${n}.ts`)
const page = { at: "", dungeon: "cove", difficulty: 1, length: 1, quest: "cleanse", key: "k", torch: 70, inBattle: false, supplies: { food: 4 }, tally: {}, heroes: [{ guid: 1, name: "Reynauld", cls: "crusader", hp: 18, maxHp: 26, stress: 40, affliction: "", virtue: "", deathsDoor: false, lastBlow: "" }] }
async function fresh() {
  rmSync(out, { recursive: true, force: true })
  mkdirSync(join(out, "chronicle", "generated_1_t"), { recursive: true })
  await Bun.write(join(out, "chronicle", "generated_1_t", "0000.json"), JSON.stringify(page))
}
const withEnv = async (env: Record<string, string>, f: () => Promise<void>) => {
  const was = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]))
  Object.assign(process.env, env)
  try { await f() } finally { for (const [k, v] of Object.entries(was)) v === undefined ? delete process.env[k] : (process.env[k] = v) }
}

describe("C64: the Caretaker comments by himself", () => {
  test("a page is sent with the rules and the thread at the standard level, and the answer is posted on its page, without an em dash", async () => {
    await fresh()
    const log = join(out, "args.json")
    await withEnv({ DD_TOWN_OUT: out, DD_INFERENCE: stub("ok"), STUB_LOG: log }, async () => {
      expect(await comment("page", "PAGE 0000, saved 04:00:00, out of a fight\nHEROES front to back:\n  1. Reynauld 18/26 health, 40 stress", "0000")).toBe(true)
      const args = (await Bun.file(log).json()) as string[]
      expect(args.slice(0, 2)).toEqual(["--level", "standard"])
      expect(args[2]).toBe(SYSTEM)
      expect(SYSTEM).toMatch(/Never name a foe, a trap, a curio or what lies ahead unless the page names it/)
      expect(SYSTEM).toMatch(/Never use an em dash/)
      expect(SYSTEM).toMatch(/two to four short paragraphs, one subject each.*what just happened.*how the four are holding.*what the packs allow.*what you would do next, and why/)
      expect(SYSTEM).toMatch(/no headings/)
      expect(args[3]).toContain("THE PAGE\nPAGE 0000")
      // a page's comment is posted as his recap, the report card (C66), its numbers from the page
      const said = (await feed()).lines.at(-1)!
      expect(said).toMatchObject({ from: "caretaker", page: "0000" })
      expect(said.recap?.advice).toBe("The Shaman is down, press the last Grouper before it heals.")
      expect(said.recap?.four[0]).toMatchObject({ name: "Reynauld", hp: 18, stress: 40 })
    })
    rmSync(out, { recursive: true, force: true })
  })

  test("a failed call and a hung call post nothing and print a WARN", async () => {
    await fresh()
    const log = spyOn(console, "log")
    await withEnv({ DD_TOWN_OUT: out, DD_INFERENCE: stub("fail") }, async () => {
      expect(await comment("ask", "PAGE 0000", "0000", "where now?")).toBe(false)
    })
    await withEnv({ DD_TOWN_OUT: out, DD_INFERENCE: stub("hang"), DD_CARETAKER_TIMEOUT: "500" }, async () => {
      expect(await comment("page", "PAGE 0000", "0000")).toBe(false)
      expect((await feed()).lines).toEqual([])
    })
    const warns = log.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("WARN "))
    log.mockRestore()
    expect(warns.length).toBe(2)
    expect(warns[0]).toContain("rate limited")
    expect(warns[1]).toContain("timed out")
    rmSync(out, { recursive: true, force: true })
  })

  test("run as bun run caretaker, it comments a CHRON page by itself", async () => {
    await fresh()
    await Bun.write(join(out, "chronicle", "generated_1_t", "0001.json"), JSON.stringify({ ...page, tally: { BATTLE_COMPLETED: 1 } }))
    const p = Bun.spawn(["bun", "src/caretaker.ts"], { cwd: root, env: { ...process.env, DD_TOWN_OUT: out, DD_INFERENCE: stub("ok"), DD_LIVE_REPLAY: "1" }, stdout: "pipe" })
    let lines: { page?: string }[] = []
    for (let i = 0; i < 30 && !lines.length; i++) { await Bun.sleep(300); lines = (await Bun.file(join(out, "road", "comments.jsonl")).text().catch(() => "")).split("\n").filter(Boolean).map((l) => JSON.parse(l)) }
    p.kill("SIGTERM")
    await p.exited
    await Bun.sleep(300)
    // stopping the Caretaker leaves no stream of his behind
    const { readdirSync, readFileSync } = await import("node:fs")
    const left = readdirSync("/proc").filter((d) => /^\d+$/.test(d)).filter((d) => { try { return readFileSync(`/proc/${d}/environ`, "utf8").includes(`DD_TOWN_OUT=${out}\0`) } catch { return false } }).join(",")
    rmSync(out, { recursive: true, force: true })
    expect(lines.map((l) => l.page)).toEqual(["0001"])
    expect(left).toBe("")
  }, 20_000)
})
