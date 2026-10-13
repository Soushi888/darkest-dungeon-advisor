// C87 and C88 (Soushi, 2026-10-13, back from the Warrens with no healer and a board that changed its mind about Addinell):
// a four without a true healer keeps to the shortest road, a hero who joined this week is never let go for another recruit,
// and a recruit of a class the roster already holds is never taken.
import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { advise } from "../src/advise.ts"
import { source } from "../src/board.ts"
import { profileDir } from "../src/paths.ts"
import { readSave } from "../src/read.ts"
import { town } from "../src/town.ts"

let profile = ""
try { profile = profileDir() } catch {}
const has = !!profile && existsSync(profile)

describe.skipIf(!has)("C87, C88: a roster and a road that hold together", () => {
  test("C87: a four without a true healer is leaned to the shortest road on offer", async () => {
    const t = await town(await readSave())
    const a = await advise(t)
    const best = a.parties[0]
    expect(best).toBeDefined()
    if (!best!.healer) expect(best!.quest.length).toBe(Math.min(...a.parties.map((p) => p.quest.length)))
    for (const p of a.parties) if (!p.healer && p.quest.length > 1) expect(p.notes).toContain("no true healer can go, so I keep to the shortest roads")
  })

  test("C88: a newcomer is never named for dismissal, and a recruit of a class already held is never leaned Recruit", async () => {
    const t = await town(await readSave())
    const a = await advise(t)
    // every hero on the roster counts as having joined this week: none may be let go for a recruit
    const md = source(t, a, { foresight: false, answers: {}, newcomers: new Set(t.heroes.map((h) => h.guid)) }).board
    const cards = md.split(/\n- q: /)
    for (const c of cards.filter((c) => c.startsWith('"Dismiss '))) expect(c).not.toContain("at the coach")
    const healerRecruit = new Set(a.recruits.filter((r) => r.heal).map((r) => r.hero.guid))
    for (const r of t.recruits.filter((r) => !healerRecruit.has(r.guid) && t.heroes.some((h) => h.cls === r.cls))) {
      const card = cards.find((c) => c.startsWith(`"Recruit ${r.name},`))
      expect(card).toBeDefined()
      expect(card).toMatch(/\n  lean: 1\n/)
      expect(card).toContain("the roster already has")
    }
  })
})

describe("C89, C90: a disease that bites only at camp, and a plan that holds while it is applied", () => {
  test("C89: Bulimic counts as biting only at camp, from the game's own buffs", async () => {
    const { quirks } = await import("../src/game.ts")
    expect((await quirks()).get("bulimic")?.campOnly).toBe(true)
  })

  test("C90: a hero placed in a building since the week began is free to the plan, and their seat open", async () => {
    const { planView } = await import("../src/board.ts")
    const t = await town(await readSave())
    const h = t.heroes[0]!, act = t.activities[0]!
    const placed = { ...t, heroes: t.heroes.map((x) => (x.guid === h.guid ? { ...x, busy: act.name } : x)), activities: t.activities.map((x) => (x === act ? { ...x, used: x.used + 1 } : x)) }
    const start = { week: t.week, heroes: t.heroes.map((x) => ({ guid: x.guid, name: x.name, busy: x.guid === h.guid ? "" : x.busy })), bought: [], gold: 0 }
    const plan = planView(placed, start)
    expect(plan.heroes.find((x) => x.guid === h.guid)!.busy).toBe("")
    expect(plan.activities.find((x) => x.name === act.name)!.used).toBe(placed.activities.find((x) => x.name === act.name)!.used - 1)
    // a hero already placed when the week began stays placed
    expect(planView(placed, { ...start, heroes: start.heroes.map((x) => (x.guid === h.guid ? { ...x, busy: act.name } : x)) }).heroes.find((x) => x.guid === h.guid)!.busy).toBe(act.name)
  })
})

describe("C91, C92: an order of priorities, and a roster that remembers who joined", () => {
  test("C91: a lower rung never outweighs a higher one", async () => {
    const { byDoctrine, DOCTRINE } = await import("../src/advise.ts")
    const road = (healer: boolean, left: number, length: number, score: number) => ({ healer, left, score, quest: { length } as any })
    // a healer beats any score without one
    expect([road(false, 5000, 1, 999), road(true, 100, 2, 1)].sort(byDoctrine)[0]!.healer).toBe(true)
    // among healers, a road the coffers pay beats a better-scored one they cannot
    expect([road(true, -10, 1, 999), road(true, 10, 1, 1)].sort(byDoctrine)[0]!.left).toBe(10)
    // without a healer, the shortest road whatever the score
    expect([road(false, 10, 2, 999), road(false, 10, 1, 1)].sort(byDoctrine)[0]!.quest.length).toBe(1)
    // with a healer, length is left to the weighing
    expect([road(true, 10, 1, 1), road(true, 10, 2, 9)].sort(byDoctrine)[0]!.score).toBe(9)
    expect(DOCTRINE[0]).toContain("true healer")
  })

  test("C92: a hero who joined within the settling weeks is kept from every dismissal", async () => {
    const { rosterLedger, settling } = await import("../src/board.ts")
    const t = await town(await readSave())
    const [a, b] = t.heroes
    const start = { week: t.week, heroes: t.heroes.filter((h) => h.guid !== b!.guid).map((h) => ({ guid: h.guid, name: h.name })), bought: [], gold: 0 }
    const l = rosterLedger(undefined, t, start)
    expect(l.joined[String(a!.guid)]).toBe(0)
    expect(l.joined[String(b!.guid)]).toBe(t.week)
    expect(settling(l, t.week + 2, 3).has(b!.guid)).toBe(true)
    expect(settling(l, t.week + 3, 3).has(b!.guid)).toBe(false)
    // kept across weeks: a later build does not reset the week they joined
    expect(rosterLedger(l, { ...t, week: t.week + 1 }, undefined).joined[String(b!.guid)]).toBe(t.week)
    // the advice never names a settling hero for dismissal or as the one of a pair to let go
    const settle = new Set(t.heroes.map((h) => h.guid))
    const adv = await advise({ ...t, settling: settle })
    expect(adv.dismiss).toEqual([])
    for (const p of adv.alike) expect(settle.has(p.drop.guid)).toBe(false)
  })
})
