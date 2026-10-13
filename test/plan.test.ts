// C70: a lean to keep the heirlooms comes with a plan (Soushi, 2026-10-11 05:22: "when you propose to save for later, at least
// give a vision"): what is short, which of this week's roads pay it, how many trips at the rate the recorded roads brought it
// home, and what the other heirlooms can pay for now without delaying the target.
import { describe, expect, test } from "bun:test"
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { savingPlan } from "../src/voice/board.ts"
import { questLabel } from "../src/world/town.ts"
import { ownParty, plan } from "../src/caretaker/plan.ts"
import { advise } from "../src/caretaker/advise.ts"
import { campingSkills, supplyPrices } from "../src/sources/game.ts"
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

  // every value board.ts may take from caretaker/: the plan and its entry points, wording, and loaders. A decision (fills, upkeep,
  // readiness, road, campWorth...) taken from caretaker/ directly fails here; types are always allowed
  const ALLOWED: Record<string, string[]> = {
    "advise.ts": ["DOCTRINE"], // the words of my order
    "plan.ts": ["plan", "farewellPlan", "prepare", "saving", "theWeek", "taleHealers"],
    "camp.ts": ["campTell"], // a camping skill in words
    "roles.ts": ["ROLE_WORDS"],
    "upkeep.ts": ["upkeepWords"],
    "pack.ts": ["packRules"], // the pack's rules, loaded from the game's files
    "rules.ts": ["habitGroups", "ROAD_HABIT_FROM"],
  }
  const violations = (src: string) => {
    const bad: string[] = []
    for (const [, allType, names, mod] of src.matchAll(/^(?:import|export)\s+(type\s+)?\{([^}]*)\}\s+from\s+"\.\.\/caretaker\/([\w.]+)"/gm)) {
      for (const n of names!.split(",").map((x) => x.trim()).filter(Boolean)) if (!allType && !n.startsWith("type ") && !(ALLOWED[mod!] ?? []).includes(n)) bad.push(`${mod}: ${n}`)
    }
    for (const [m] of src.matchAll(/import\s+(?:\*\s+as\s+\w+|\w+)\s*,?[^;\n]*from\s+"\.\.\/caretaker\/[\w.]+"|import\(\s*"\.\.\/caretaker\/[\w.]+"/g)) bad.push(m)
    return bad
  }

  test("board.ts reads no habit and takes from caretaker/ only the plan, wording and loaders", () => {
    expect(board).not.toMatch(/\bRULE\./)
    expect(board).not.toContain("RULE_")
    expect(board).not.toContain("CHRONICLE_RULE")
    expect(board).toMatch(/from "\.\.\/caretaker\/plan\.ts"/)
    expect(violations(board)).toEqual([])
    // the guard bites: a decision taken straight from caretaker/ is named
    expect(violations(`import { fills, type Party } from "../caretaker/advise.ts"`)).toEqual(["advise.ts: fills"])
    expect(violations(`import { upkeep } from "../caretaker/upkeep.ts"`)).toEqual(["upkeep.ts: upkeep"])
    expect(violations(`import * as A from "../caretaker/advise.ts"`).length).toBe(1)
  })

  let profile = ""
  try { profile = profileDir() } catch {}
  const has = !!profile && existsSync(profile)
  test.skipIf(!has)("on the live save, the leans never spend more than the road leaves free, in the source order, and each relief card is filed where it leans", async () => {
    const copy = join(root, ".dd-runtime", "test-plan-profile")
    rmSync(copy, { recursive: true, force: true }); mkdirSync(copy, { recursive: true })
    for (const f of readdirSync(profile)) if (f.startsWith("persist.") && f !== "persist.raid.json") cpSync(join(profile, f), join(copy, f))
    const t0 = await readTown(await readSave(copy)), prices = await supplyPrices(), camp = await campingSkills()
    let checked = 0, owned = 0, camped = 0
    for (const gold of [t0.wallet.gold ?? 0, 0, 600, 2500, 12000]) {
      const t = { ...t0, wallet: { ...t0.wallet, gold } }
      const a = await advise(t)
      // a hero already placed this week (C90): the first relief card a dismissal does not claim, at its first place
      const r0 = a.relief.find((r) => r.options.length && !a.dismiss.some((d) => d.hero.guid === r.hero.guid))
      const placed = r0 ? new Map([[r0.hero.guid, r0.options[0]!.activity.name]]) : undefined
      // the reader's own four: the first four heroes on the roster, named in a note
      const names = t.heroes.slice(0, 4).map((h) => h.name)
      const newcomers = new Set(t.heroes.slice(-1).map((h) => h.guid))
      const runs: { expedition?: string; own: boolean }[] = [{ own: false }, { own: true }, ...a.parties.map((p) => ({ expedition: questLabel(p), own: false }))]
      for (const { expedition, own: mine } of runs) {
        const answers = { ...(expedition ? { expedition } : {}), ...(mine ? { partyNames: names } : {}) }
        const own = mine ? await ownParty(t, a, answers) : undefined
        if (mine && !own) continue
        const p = plan(t, a, { answers, prices, camp, ...(own ? { own, placed, newcomers } : {}) })
        checked++
        if (own) { owned++; expect(p.chosen).toBe(own) }
        if (own && r0) { const c = p.relief.find((x) => x.relief.hero.guid === r0.hero.guid)!; expect(c.why.kind).toBe("paid"); expect(p.spends.some((s) => s.step === "relief" && s.who === r0.hero.name)).toBe(false) }
        // the reserve comes first and leaves the rest free; every lean after it spends from what is left, never below nothing
        expect(p.spends[0]!.step).toBe("reserve")
        expect(p.free).toBe(Math.max(0, gold - p.reserve))
        const leans = p.spends.slice(1)
        const spent = leans.reduce((x, s) => x + s.gold, 0)
        expect(spent).toBeLessThanOrEqual(p.free)
        for (const s of leans) expect(s.left).toBeGreaterThanOrEqual(0)
        expect(leans.at(-1)?.left ?? p.free).toBe(p.free - spent)
        // the spending order is the source order (relief, the wards, the four's upkeep, the Guild, the Survivalist), never the
        // board's display order
        const order = ["heal-held", "relief", "ward", "treatment", "upkeep", "heal-back", "train", "survivalist"]
        const at = leans.map((s) => order.indexOf(s.step))
        expect(at).toEqual([...at].sort((x, z) => x - z))
        // a held heal lesson is given back before the Guild's lean; the four's upkeep reads the gold left after the wards, with
        // the heal lesson still held, and spends what it buys from it
        expect(leans.filter((s) => s.step === "heal-held").length).toBe(leans.filter((s) => s.step === "heal-back").length)
        if (p.upkeep) expect(p.upkeep.free).toBe(p.free - leans.filter((s) => ["heal-held", "relief", "ward", "treatment"].includes(s.step)).reduce((x, s) => x + s.gold, 0))
        expect(leans.filter((s) => s.step === "upkeep").reduce((x, s) => x + s.gold, 0)).toBe(p.upkeep?.spent ?? 0)
        // B2: everything the board promises to buy, counted from its leans and not from the spends, fits in the free gold. An
        // upgrade the upkeep buys and the Guild also leans to is paid once
        const upBuys = new Set((p.upkeep?.lines ?? []).filter((l) => l.status === "buy").map((l) => `${l.item.hero}|${l.item.what}`))
        const goldOf = (u: { cost: { type: string; amount: number }[] }) => u.cost.find((c) => c.type === "gold")?.amount ?? 0
        const tu = p.train && p.train.lean < p.train.shown.length ? p.train.shown[p.train.lean]! : undefined
        const cb = p.camp?.why === "worth" ? p.camp.best[p.camp.lean]! : undefined
        const promised = p.relief.filter((c) => c.why.kind === "cheapest").reduce((x, c) => x + c.relief.options[c.lean]!.activity.cost, 0)
          + (p.ward?.cards ?? []).filter((c) => c.lean === 0 && c.why === "worth").length * (p.ward?.ward.cost ?? 0)
          + (p.treatment?.cards ?? []).filter((c) => c.lean === 0 && c.why === "worth").reduce((x, c) => x + c.treat.cost, 0)
          + (p.upkeep?.spent ?? 0)
          + (tu && !upBuys.has(`${tu.hero}|${tu.label} to level ${tu.toLevel}`) ? goldOf(tu) : 0)
          + (cb && !upBuys.has(`${cb.hero.name}|${cb.k.name} at the Survivalist`) ? cb.price : 0)
        expect(promised).toBeLessThanOrEqual(p.free)
        expect(promised).toBe(spent)
        // decision 15: a relief card is filed under the building of the place it leans to, and with the waiting when it leans to none
        for (const c of p.relief) expect(c.filedUnder).toBe(c.relief.options[c.lean]?.activity.buildingName ?? "")
        // the Survivalist spends exactly when its lean names a lesson, and last
        if (p.chosen) expect(p.camp).toBeDefined()
        expect(leans.some((s) => s.step === "survivalist")).toBe(p.camp?.why === "worth")
        if (p.camp?.why === "worth") { expect(leans.at(-1)!.step).toBe("survivalist"); camped++ }
      }
    }
    expect(checked).toBeGreaterThan(5)
    expect(owned).toBeGreaterThan(0)
    // at 12,000 gold some road camps and the Survivalist teaches on it, or no road camps this week
    if (t0.quests.some((q) => q.length >= 2 && !q.plot)) expect(camped).toBeGreaterThan(0)
  })
})
