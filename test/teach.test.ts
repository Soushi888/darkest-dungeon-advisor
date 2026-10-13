// C102: what a road teaches about the foes and the four (Soushi, 2026-10-13: "Those learning are such superficials... I was more
// expecting learning about foes and synergie between the heroes").
import { describe, expect, test } from "bun:test"
import { teachings } from "../src/road/teach.ts"

const base = { dungeon: "weald", difficulty: 1, length: 1, week: 22, trip: "Weald, week 22" }
const foe = (name: string, hp: number, bleed: number, victims: Record<string, number>, crits = 0) => ({ name, blows: 3, hp, crits, attacks: {}, victims, blight: 0, bleed })

describe("C102: a road teaches about its foes and the four", () => {
  test("the foe that hurt most, with its answer; the healer the foes went for; what the heals cost", () => {
    const db = { foes: [foe("Rabid Gnasher", 25, 21, { Guernon: 30, Papon: 6 }, 2), foe("Fungal Scratcher", 20, 0, { Guernon: 14, Holland: 6 })], beats: [], loot: {}, costs: [{ by: "Guernon", to: "Holland", hp: 6, kind: "bleed" }, { by: "Guernon", to: "Papon", hp: 3, kind: "bleed" }] }
    const shuffles = [1, 2].map((i) => ({ i, kind: "shuffle" as const, text: "Guernon took rank 2 and Burci rank 3", bad: false }))
    const t = teachings([], shuffles as any, db as any, base, ["Guernon"])
    expect(t.lines[0]).toBe("The Rabid Gnashers hurt them most: 46 health, 21 by bleeding, 2 criticals. Strike them first, and bring bandages.")
    expect(t.lines.some((l) => l.startsWith("The foes went for Guernon: 44 of the 56 health they took was the healer's."))).toBe(true)
    expect(t.lines.some((l) => l.includes("shuffled Guernon, the healer, forward 2 times"))).toBe(true)
    expect(t.lines.some((l) => l.startsWith("Guernon's heals left 9 health of bleeding on Holland, Papon"))).toBe(true)
    expect(t.lessons.map((l) => l.kind)).toEqual(["foe", "line", "line", "cost"])
    for (const l of t.lessons) expect(l.trip).toBe("Weald, week 22")
  })

  test("nothing to teach from an empty road", () => {
    expect(teachings([], [], undefined, base, [])).toEqual({ lines: [], lessons: [] })
  })
})
