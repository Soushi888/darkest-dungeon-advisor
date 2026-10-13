// C70: a lean to keep the heirlooms comes with a plan (Soushi, 2026-10-11 05:22: "when you propose to save for later, at least
// give a vision"): what is short, which of this week's roads pay it, how many trips at the rate the recorded roads brought it
// home, and what the other heirlooms can pay for now without delaying the target.
import { describe, expect, test } from "bun:test"
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { savingPlan } from "../src/voice/board.ts"
import { questLabel } from "../src/voice/words.ts"
import { plan } from "../src/caretaker/plan.ts"
import { advise } from "../src/caretaker/advise.ts"
import { supplyPrices } from "../src/sources/game.ts"
import { profileDir, root } from "../src/sources/paths.ts"
import { readSave } from "../src/sources/read.ts"
import { town as readTown } from "../src/world/town.ts"

const up = (label: string, cost: [string, number][], tree = "x.y") => ({ tree, label, code: "a", cost: cost.map(([type, amount]) => ({ type, amount })), affordable: true, blockedBy: "" })
const target = { ...up("Stage Coach: seasoned recruits", [["bust", 9], ["crest", 12]], "stage_coach.upgraded_recruits"), affordable: false }
const quest = (dungeonName: string, rewards: string[]) => ({ dungeonName, length: 1, goal: "Scout", plot: false, rewards }) as any
const town = { wallet: { bust: 2, crest: 63, portrait: 20, deed: 7, gold: 100 }, quests: [quest("Weald", ["2 busts", "3000 gold"]), quest("Cove", ["3 crests"])] } as any

describe("C70: the plan behind keeping the heirlooms", () => {
  test("it names the shortfall, the roads that pay it, the trips it takes, and what the rest can buy without delaying it", () => {
    const a = { heirlooms: [up("Tavern: Bar, improved", [["portrait", 4], ["crest", 10]]), up("Guild: higher teachings", [["portrait", 15], ["crest", 55]])] } as any
    const body = JSON.parse(savingPlan(town, a, target as any, { bust: { trips: 3, got: 4 } }).find((l) => l.startsWith("  body: "))!.slice(8))
    expect(body).toContain("7 busts short.")
    expect(body).toContain("This week this road pays them: the Weald, short (Scout), paying 2 busts.")
    expect(body).toContain("brought home 4 busts, about 1.3 a trip; at that rate, 6 more trips.")
    // 63 crests less the 12 the target needs leaves 51: the Bar fits, the higher teachings (55 crests) would delay it
    expect(body).toContain("Tavern: Bar, improved (4 portraits and 10 crests)")
    expect(body).not.toContain("Guild: higher teachings")
  })

  test("with no road paying it and no trip that brought it home, it says so rather than guessing", () => {
    const body = JSON.parse(savingPlan({ ...town, quests: [] }, { heirlooms: [] } as any, target as any, { bust: { trips: 2, got: 0 } }).find((l) => l.startsWith("  body: "))!.slice(8))
    expect(body).toContain("No road this week pays busts.")
    expect(body).toContain("None of the 2 roads I kept the story of brought busts home, so I cannot say how many trips.")
    expect(body).toContain("Nothing else the heirlooms can buy now leaves the target untouched.")
  })
})

// C111: the board renders one plan. src/caretaker/plan.ts makes every decision the town board and the farewell show and returns
// it as one Plan; src/voice/board.ts words it and reads no habit of its own.
describe("C111: the board renders one plan", () => {
  const board = readFileSync(new URL("../src/voice/board.ts", import.meta.url), "utf8")

  test("board.ts reads no habit and takes no decision from advise.ts", () => {
    expect(board).not.toMatch(/\bRULE\./)
    expect(board).not.toContain("RULE_")
    expect(board).not.toContain("CHRONICLE_RULE")
    // from advise.ts only types and DOCTRINE, the words of my order
    const ALLOWED = new Set(["DOCTRINE"])
    const from = [...board.matchAll(/^(?:import|export)\s+(type\s+)?\{([^}]*)\}\s+from\s+"\.\.\/caretaker\/advise\.ts"/gm)]
    expect(from.length).toBeGreaterThan(0)
    for (const [, allType, names] of from) for (const n of names!.split(",").map((x) => x.trim()).filter(Boolean)) {
      if (allType || n.startsWith("type ")) continue
      expect(ALLOWED.has(n)).toBe(true)
    }
    expect(board).not.toMatch(/import\s+\*\s+as\s+\w+\s+from\s+"\.\.\/caretaker\/advise\.ts"/)
    expect(board).not.toMatch(/import\(\s*"\.\.\/caretaker\/advise\.ts"/)
  })

  let profile = ""
  try { profile = profileDir() } catch {}
  const has = !!profile && existsSync(profile)
  test.skipIf(!has)("on the live save, the leans never spend more than the road leaves free, in the source order, and each relief card is filed where it leans", async () => {
    const copy = join(root, ".dd-runtime", "test-plan-profile")
    rmSync(copy, { recursive: true, force: true }); mkdirSync(copy, { recursive: true })
    for (const f of readdirSync(profile)) if (f.startsWith("persist.") && f !== "persist.raid.json") cpSync(join(profile, f), join(copy, f))
    const t0 = await readTown(await readSave(copy)), prices = await supplyPrices()
    let checked = 0
    for (const gold of [t0.wallet.gold ?? 0, 0, 600, 2500, 12000]) {
      const t = { ...t0, wallet: { ...t0.wallet, gold } }
      const a = await advise(t)
      for (const expedition of [undefined, ...a.parties.map((p) => questLabel(p))]) {
        const p = plan(t, a, { answers: expedition ? { expedition } : {}, prices })
        checked++
        // the reserve comes first and leaves the rest free; every lean after it spends from what is left, never below nothing
        expect(p.spends[0]!.step).toBe("reserve")
        expect(p.free).toBe(Math.max(0, gold - p.reserve))
        const leans = p.spends.slice(1)
        const spent = leans.reduce((x, s) => x + s.gold, 0)
        expect(spent).toBeLessThanOrEqual(p.free)
        for (const s of leans) expect(s.left).toBeGreaterThanOrEqual(0)
        expect(leans.at(-1)?.left ?? p.free).toBe(p.free - spent)
        // the spending order is the source order (relief, the wards, the Guild, the Survivalist), never the board's display order
        const order = ["heal-held", "relief", "ward", "treatment", "heal-back", "train", "survivalist"]
        const at = leans.map((s) => order.indexOf(s.step))
        expect(at).toEqual([...at].sort((x, z) => x - z))
        // a held heal lesson is given back before the Guild's lean, and the four's upkeep spends none of the gold it reads
        expect(leans.filter((s) => s.step === "heal-held").length).toBe(leans.filter((s) => s.step === "heal-back").length)
        if (p.upkeep) expect(p.upkeep.free).toBe(p.free - leans.filter((s) => ["heal-held", "relief", "ward", "treatment"].includes(s.step)).reduce((x, s) => x + s.gold, 0))
        // decision 15: a relief card is filed under the building of the place it leans to, and with the waiting when it leans to none
        for (const c of p.relief) expect(c.filedUnder).toBe(c.relief.options[c.lean]?.activity.buildingName ?? "")
      }
    }
    expect(checked).toBeGreaterThan(5)
  })
})
