// C71: in a fight the road report is the fight, and the Caretaker speaks of the fight alone (Soushi, 2026-10-11 05:42:
// "When we are in the battle, I would like the report to be more focused on it and clear").
import { describe, expect, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { FIGHT, promptFor } from "../src/caretaker.ts"
import { root } from "../src/paths.ts"
import { feed, roadPanel } from "../src/road.ts"

const hero = (name: string, guid: number) => ({ guid, name, cls: "crusader", hp: 20, maxHp: 33, stress: 30, affliction: "", virtue: "", deathsDoor: false, lastBlow: "", effects: ["speed_rating 1 (2)"] })
const page = { at: "", dungeon: "weald", difficulty: 1, length: 1, quest: "explore", key: "k", torch: 70, inBattle: true, supplies: {}, tally: {}, heroes: [hero("Reynauld", 1), hero("Dismas", 2)],
  battle: { round: 2, foes: [{ name: "Brigand Cutthroat", hp: 9, hitBy: "", guid: 21, cls: "cutthroat_A", stunned: true, effects: ["bleed 1 (2) from houndmaster"] }, { name: "Corpse", hp: 7, hitBy: "", guid: 22, cls: "corpse_A" }] } }
const raw = { raid: { battle: { initiative: { heroes: { 0: { roster_guid: 1, initiative: 0 } }, monsters: { 0: { battle_guid: 21, initiative: 0 } } } } } }

describe("C71: the fight first", () => {
  test("the feed tells, for each foe and hero, whether it has acted, and its effects in words", async () => {
    const out = join(root, ".dd-runtime", "test-fight"), trip = join(out, "chronicle", "generated_1_t")
    rmSync(out, { recursive: true, force: true }); mkdirSync(trip, { recursive: true })
    await Bun.write(join(trip, "0007.json"), JSON.stringify(page)); await Bun.write(join(trip, "0007.raw.json"), JSON.stringify(raw))
    const was = process.env.DD_TOWN_OUT
    process.env.DD_TOWN_OUT = out
    const s = (await feed()).state
    process.env.DD_TOWN_OUT = was
    rmSync(out, { recursive: true, force: true })
    expect(s.foes[0]).toMatchObject({ name: "Brigand Cutthroat", stunned: true, acted: true, effects: ["bleed 1 a round for 2 rounds, from the Houndmaster"] })
    expect(s.foes[1]).toMatchObject({ dead: true, acted: false })
    expect(s.heroes.map((h: any) => [h.name, h.acted])).toEqual([["Reynauld", true], ["Dismas", false]])
    expect(s.heroes[0].effects).toEqual(["speed +1 for 2 rounds"])
  })

  test("the report puts the foes first and folds the packs and the map; out of a fight it is as before", () => {
    expect(roadPanel).toContain("fight?battle(s,latest):")
    expect(roadPanel).toContain("The packs and the map, until the fight ends")
    expect(roadPanel).toContain("fight?'':foes(s)")
  })

  test("a page in a fight asks him for the fight alone; any other page as before", async () => {
    expect(await promptFor("page", "PAGE 0007, saved 05:40:00, round 2\nHEROES front to back:\n  1. Reynauld\nFOES front to back:\n  slot 1. Brigand Cutthroat")).toContain(FIGHT)
    expect(FIGHT).toMatch(/fight alone.*which foe threatens whom.*strike first and why.*who needs healing.*Nothing about the packs, the map or the road/)
    const quiet = await promptFor("page", "PAGE 0008, saved 05:41:00, out of a fight\nHEROES front to back:")
    expect(quiet).toContain("Comment this page.")
    expect(quiet).not.toContain(FIGHT)
  })
})
