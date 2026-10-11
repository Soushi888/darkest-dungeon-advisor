// C64: bun run caretaker comments each CHRON page and answers each ASK by himself through the PAI Inference tool, posting
// through say(); a failed or hung call posts nothing and prints a WARN. Stubs stand in for the tool; nothing reaches a model.
import { describe, expect, spyOn, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { comment, promptFor, SYSTEM, streamFlow } from "../src/caretaker.ts"
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
      // pm#34: from the Hamlet, digits, length by events, no tally opener
      expect(SYSTEM).toMatch(/your four/)
      expect(SYSTEM).toMatch(/never \\"we\\" for the party|never "we" for the party/)
      expect(SYSTEM).toMatch(/every number as digits/)
      expect(SYSTEM).toMatch(/a quiet page.*one or two short paragraphs.*up to four/)
      expect(SYSTEM).toMatch(/never open with a tally/)
      expect(args[3]).toContain("THE PAGE\nPAGE 0000")
      // a page's comment is posted as his recap, the report card (C66), its numbers from the page
      const said = (await feed()).lines.at(-1)!
      expect(said).toMatchObject({ from: "caretaker", page: "0000" })
      expect(said.recap?.advice).toBe("The Shaman is down, press the last Grouper before it heals.")
      expect(said.recap?.four[0]).toMatchObject({ name: "Reynauld", hp: 18, stress: 40 })
    })
    rmSync(out, { recursive: true, force: true })
  })

  test("his ways reach every prompt, a habit he states is kept once, and a tally opener is cut", async () => {
    await fresh()
    await Bun.write(join(out, "ways.md"), "- keeps antivenom and bandages for the walk, heals in battle\n")
    const log = join(out, "args.json")
    await withEnv({ DD_TOWN_OUT: out, DD_INFERENCE: stub("way"), STUB_LOG: log }, async () => {
      const { promptFor, readWays } = await import("../src/caretaker.ts")
      expect(await promptFor("page", "PAGE 0000")).toContain("THE HEIR'S WAYS\n- keeps antivenom and bandages for the walk, heals in battle")
      expect(await comment("ask", "PAGE 0000", "0000", "I keep antivenom and bandages for the walk.")).toBe(true)
      const said = (await feed()).lines.at(-1)!
      expect(said.text).toBe("Keep the antivenom for the walk, then.")
      // the same habit is not written twice
      expect(await readWays()).toEqual(["keeps antivenom and bandages for the walk, heals in battle"])
      await Bun.write(join(out, "ways.md"), "")
      await comment("ask", "PAGE 0000", "0000", "I keep antivenom for the walk.")
      expect(await readWays()).toEqual(["keeps antivenom and bandages for the walk, heals in battle"])
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

// C73: one report per CHRON page, its prompt holding every page told since his last word (pm#36; Soushi, 05:59: "It should see
// all the pages, but only make one report"). From page 0106 of the Weald, where Guernon's loss went unexplained.
describe("C73: he sees every page since his last word, and makes one report", () => {
  const pages = [
    "PAGE 05:56:04 #0101 saved 05:56:04 light 72 | Guernon 15/19hp 41st || changed: light -6; hallway step completed +1",
    "PAGE 05:56:10 #0102 saved 05:56:10 light 72 | Guernon 15/19hp 58st || changed: narrated: trap; Guernon +17st; Guernon gains blight 2 a round for 3 rounds, from a trap",
    "MORE   4. Guernon 15/19 health, 58 stress",
    "PAGE 05:56:12 #0103 saved 05:56:12 light 66 | Guernon 13/19hp 58st || changed: light -6; Guernon -2hp (blight ticking)",
    "CHRON 05:56:30 #0106 saved 05:56:30 light 54 | Guernon 11/19hp 58st || changed: Guernon -2hp (blight ticking); room visited +1",
  ]
  test("three plain pages then one CHRON give exactly one post, whose prompt holds all four pages' events", async () => {
    const posts: { kind: string; text: string; page: string; since: string[] }[] = []
    const flow = streamFlow(async (kind, text, page, _q = "", since = []) => { posts.push({ kind, text, page, since: [...since] }); return true }, async () => undefined)
    for (const l of pages) await flow.line(l)
    await flow.end()
    expect(posts.length).toBe(1)
    expect(posts[0]!.page).toBe("0106")
    expect(posts[0]!.since.map((s) => s.match(/#(\d+)/)?.[1])).toEqual(["0101", "0102", "0103"])
    const prompt = await promptFor("page", posts[0]!.text, "", posts[0]!.since)
    expect(prompt).toMatch(/WHAT HAPPENED SINCE MY LAST WORD\n[\s\S]*#0101[\s\S]*Guernon \+17st; Guernon gains blight 2 a round for 3 rounds, from a trap[\s\S]*Guernon -2hp \(blight ticking\)[\s\S]*THE PAGE\nCHRON[^\n]*#0106/)
    expect(prompt).toContain("Guernon 15/19 health, 58 stress") // a page's MORE lines go with it
    // the kept pages are spent once he has spoken: the next CHRON sees only what came after
    await flow.line("CHRON 05:57:00 #0107 saved 05:57:00 light 48 | Guernon 9/19hp 58st || changed: Guernon -2hp (blight ticking)")
    await flow.end()
    expect(posts.length).toBe(2)
    expect(posts[1]!.since).toEqual([])
  })

  test("a report that failed keeps its page for the next one, and an answer to the Heir sees the kept pages too", async () => {
    const posts: { kind: string; since: string[] }[] = []
    let ok = false
    const flow = streamFlow(async (kind, _t, _p, _q = "", since = []) => { posts.push({ kind, since: [...since] }); return ok }, async () => ({ text: "PAGE 0106", page: "0106" }))
    await flow.line(pages[1]!); await flow.line(pages[4]!); await flow.end() // the CHRON fails
    ok = true
    await flow.line("ASK 05:58:35 page 0106: why did Guernon lose health?")
    expect(posts.map((p) => p.kind)).toEqual(["page", "ask"])
    expect(posts[1]!.since.map((s) => s.match(/#(\d+)/)?.[1])).toEqual(["0102", "0106"])
  })

  test("he is told that every change he names carries its cause, and when he may say it is unknown", () => {
    expect(SYSTEM).toMatch(/Every change you name.*carries its cause.*WHAT HAPPENED SINCE MY LAST WORD.*unknown only when no page there holds one/)
  })
})
