// C106: the special foes a road met are kept, so the next road is advised by them (Soushi, 2026-10-13, after the Collector:
// "We need to take note when we encounter special foes like that to improve our strategy").
import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { meetingLine, meetings } from "../src/foes.ts"
import { dungeonMonsters, specialFoes } from "../src/game.ts"
import { install } from "../src/paths.ts"
import { teachings } from "../src/teach.ts"
import type { Snap } from "../src/chronicle.ts"

const hero = (name: string, hp: number, deathsDoor = false) => ({ guid: name.length, name, cls: "vestal", hp, maxHp: 20, stress: 0, affliction: "", virtue: "", deathsDoor, lastBlow: "" })
const page = (round: number | undefined, foes: { name: string; cls: string; hp: number }[], heroes = [hero("Guernon", 10)], narrated: string[] = [], won = 0): Snap =>
  ({ at: "", dungeon: "warrens", difficulty: 1, length: 2, quest: "", key: "", torch: 80, inBattle: round !== undefined, supplies: {}, narrated, tally: { BATTLE_COMPLETED: won }, heroes,
    ...(round !== undefined ? { battle: { round, foes: foes.map((f) => ({ ...f, hitBy: "" })) } } : {}) }) as Snap

const special = new Map<string, "wanderer" | "boss">([["collector_A", "wanderer"], ["swine_prince_A", "boss"]])
const usual = new Set(["maggot_A", "spider_webber_A"])
const collector = { name: "The Collector", cls: "collector_A", hp: 70 }, head = { name: "Collected Vestal", cls: "collector_shaman_A", hp: 16 }

describe("C106: special foes are noted", () => {
  test("a fight with a wanderer is kept: how it ended, what it called, who reached Death's Door", () => {
    const snaps = [page(undefined, []), page(1, [collector], [hero("Guernon", 10)], ["combat_start"]), page(2, [collector, head], [hero("Guernon", 0, true)], ["combat_start"]), page(undefined, [], [hero("Guernon", 0, true)], ["combat_start", "battle_retreat"])]
    const [m] = meetings(snaps, special, usual)
    expect(m).toMatchObject({ cls: "collector_A", kind: "wanderer", outcome: "fled", rounds: 2, brought: ["Collected Vestal"], brink: ["Guernon"] })
    expect(meetingLine(m!, "the Warrens")).toBe("The Collector, a wanderer of the Warrens: they retreated after 2 rounds. It called Collected Vestal to its side. Guernon was brought to Death's Door.")
    // a fight of the usual halls is no meeting
    expect(meetings([page(1, [{ name: "Maggot", cls: "maggot_A", hp: 5 }]), page(undefined, [], undefined, ["victory"], 1)], special, usual)).toEqual([])
  })

  test("a boss beaten is a win", () => {
    const snaps = [page(1, [{ name: "Swine Prince", cls: "swine_prince_A", hp: 50 }], undefined, ["combat_start"]), page(undefined, [], undefined, ["combat_start", "victory"], 1)]
    expect(meetings(snaps, special, usual)[0]).toMatchObject({ kind: "boss", outcome: "won", rounds: 1 })
  })

  test("the meeting is the road's first lesson, kept with the foe it names", () => {
    const snaps = [page(1, [collector]), page(undefined, [], undefined, ["battle_retreat"])]
    const base = { dungeon: "warrens", difficulty: 1, length: 2, week: 25, trip: "the Warrens, week 25" }
    const { lines, lessons } = teachings(snaps, [], undefined, base, [], meetings(snaps, special, usual), "the Warrens")
    expect(lines[0]).toStartWith("The Collector, a wanderer of the Warrens: they retreated")
    expect(lessons[0]).toMatchObject({ kind: "special", foe: "collector_A", dungeon: "warrens" })
  })

  test.skipIf(!existsSync(install))("the game's own files tell a wanderer and a boss from the usual halls", async () => {
    const s = await specialFoes("warrens", 1), halls = await dungeonMonsters("warrens", 1, ["hall", "room"])
    expect(s.get("collector_A")).toBe("wanderer")
    expect(s.get("swine_prince_A")).toBe("boss")
    expect(halls.some((h) => s.has(h))).toBe(false)
  })
})
