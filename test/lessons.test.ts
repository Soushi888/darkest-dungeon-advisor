// C96: a lesson says what happened (Soushi, 2026-10-13, on "What I will remember": "Ensure you make real learning."). Every good
// trip had been kept as "this preparation brought them home with the work done", and week 19, with Furnival at 4 of 22 and no
// true healer, counted as one that worked.
import { describe, expect, test } from "bun:test"
import { beats, judge, type Snap } from "../src/chronicle.ts"

const hero = (name: string, hp: number, maxHp: number) => ({ guid: name.length, name, cls: "x", hp, maxHp, stress: 10, affliction: "", virtue: "", deathsDoor: false, lastBlow: "" })
const snap = (torch: number, food: number, heroes: ReturnType<typeof hero>[]): Snap => ({ at: "", dungeon: "warrens", difficulty: 1, length: 1, quest: "", key: "", torch: 90, inBattle: false, supplies: { torch, food }, tally: {}, heroes })
const trip = (healer: boolean) => ({ dungeon: "warrens", dungeonName: "Warrens", difficulty: 1, length: 1, week: 19, success: true, healer })

describe("C96: a lesson says what happened", () => {
  test("a hero brought to the brink without a true healer is a healing lesson, named, though nobody stood at Death's Door", () => {
    const snaps = [snap(8, 8, [hero("Furnival", 22, 22)]), snap(6, 6, [hero("Furnival", 4, 22)]), snap(5, 5, [hero("Furnival", 10, 22)])]
    const j = judge(snaps, beats(snaps), trip(false))
    const heal = j.lessons.find((l) => l.kind === "healing")
    expect(heal?.text).toBe("never go without a true healer (Furnival at 4 of 22)")
    expect(j.lessons.some((l) => l.kind === "worked")).toBe(false)
  })

  test("running short on the way home is a lesson, with the count", () => {
    const snaps = [snap(8, 8, [hero("Herbert", 33, 33)]), snap(2, 4, [hero("Herbert", 30, 33)])]
    const j = judge(snaps, beats(snaps), trip(true))
    expect(j.lessons.find((l) => l.kind === "light")?.text).toBe("carry more torches (2 of 8 left on the way home)")
  })

  test("a trip that worked names what held, the heal that brought someone back among it", () => {
    const snaps = [snap(8, 8, [hero("Herbert", 33, 33)]), snap(6, 6, [hero("Herbert", 2, 33)]), snap(5, 5, [hero("Herbert", 21, 33)])]
    const j = judge(snaps, beats(snaps), trip(true))
    const worked = j.lessons.find((l) => l.kind === "worked")!
    expect(worked.text).toContain("a true healer, who brought Herbert back from the brink")
    expect(worked.text).toContain("3 of 8 torches burnt")
    expect(worked.text).not.toContain("this preparation brought them home")
  })

  test("C99: half the food or less brought home is a food lesson, and the road packs food in full slots", async () => {
    const snaps = [snap(8, 8, [hero("Herbert", 33, 33)]), snap(6, 4, [hero("Herbert", 30, 33)])]
    const j = judge(snaps, beats(snaps), trip(true))
    expect(j.lessons.find((l) => l.kind === "food")?.text).toBe("carry more food (4 of 8 left on the way home)")
    const { RULE_PROVISION } = await import("../src/advise.ts")
    const { packRules } = await import("../src/pack.ts")
    const slot = (await packRules()).stack.get("food")!
    for (const n of RULE_PROVISION.slice(1)) expect(n % slot).toBe(0)
  })

  test("C100: a close call with a healer aboard is a healing lesson too", () => {
    const snaps = [snap(8, 12, [hero("Addinell", 19, 19)]), snap(6, 10, [hero("Addinell", 2, 19)]), snap(5, 8, [hero("Addinell", 8, 19)])]
    const j = judge(snaps, beats(snaps), { ...trip(true), success: false })
    expect(j.lessons.find((l) => l.kind === "healing")?.text).toBe("send a stronger heal, or a second one (Addinell at 2 of 19)")
  })
})
