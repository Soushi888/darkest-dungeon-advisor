// C56: the agent reads the page before it speaks. Synthetic pages, written under a test folder, never the live thread.
import { describe, expect, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { root } from "../src/sources/paths.ts"
import { nowText } from "../src/now.ts"
import { feed, say } from "../src/road.ts"
const out = join(root, ".dd-runtime", "test-now")

const hero = (name: string, cls: string, guid: number, more: object = {}) => ({ guid, name, cls, hp: 15.6, maxHp: 26, stress: 60, affliction: "", virtue: "", deathsDoor: false, lastBlow: "", effects: [] as string[], ...more })
const page = {
  at: "", dungeon: "cove", difficulty: 1, length: 1, quest: "cleanse", key: "k", torch: 94, inBattle: true, supplies: { food: 1, torch: 3, holy_water: 1 }, tally: {},
  heroes: [hero("Wissant", "abomination", 70, { effects: ["speed_rating 1 (2)"] }), hero("Fossard", "houndmaster", 61), hero("Emory", "grave_robber", 76, { stunned: true }), hero("Guernon", "occultist", 19)],
  battle: { round: 3, foes: [{ name: "Pelagic Guardian", hp: 14, hitBy: "", guid: 123, cls: "octotank_A", effects: ["bleed 1 (2) from houndmaster"] }, { name: "Corpse", hp: 7, hitBy: "", guid: 126, cls: "corpse_A" }] },
} as any
const raw = { heroes: { 70: { actor: { current_mode_id: "beast" } } }, raid: { battle: { round: 3,
  initiative: { heroes: { 0: { roster_guid: 61, initiative: 0 }, 1: { roster_guid: 70, initiative: 1094721733 } }, monsters: { 0: { battle_guid: 123, initiative: 0 } } },
  enemies: { 1: { is_hero: false, data: { battle_guid: 126, monster_class: "corpse_A", actor: { current_hp: 7 } } }, 0: { is_hero: false, data: { battle_guid: 123, monster_class: "octotank_A", actor: { current_hp: 14 } } } } } } }

describe("C56: the page, read whole, before a word is said", () => {
  test("the snapshot says the page and its save time, the four and the foes front to back, and who has acted", async () => {
    const t = await nowText(page, raw, "0150", new Date(2026, 9, 11, 4, 27, 22).getTime())
    const lines = t.split("\n")
    expect(lines[0]).toBe("PAGE 0150, saved 04:27:22, round 3")
    expect(lines[2]).toBe("  1. Wissant 16/26 health, 60 stress, as the beast, has not acted; speed +1 for 2 rounds")
    expect(lines[3]).toContain("2. Fossard 16/26 health, 60 stress, has acted")
    expect(lines[4]).toContain("3. Emory 16/26 health, 60 stress, stunned, has not acted")
    // the foes by their slot, front first, whatever order the record lists them in; a slain one is a corpse
    const foes = lines.slice(lines.indexOf("FOES front to back:") + 1)
    expect(foes[0]).toMatch(/^  slot 1\. Pelagic Guardian 14\/\d+ health, has acted; bleed 1 a round for 2 rounds, from the Houndmaster$/)
    expect(foes[1]).toMatch(/^  slot 2\. Corpse 7.* health, a corpse, has not acted/)
    expect(t).toContain("SUPPLIES food 1, torch 3, holy water 1; light 94")
    expect(t).not.toMatch(/_|\bstat \d/)
  })

  test("a line tied to a page the game has left is marked late, a line on the current page is not", async () => {
    // the thread is written under a test folder for this test only, then the folder every other test uses is put back
    const was = process.env.DD_TOWN_OUT
    process.env.DD_TOWN_OUT = out
    rmSync(out, { recursive: true, force: true })
    const trip = join(out, "chronicle", "trip")
    mkdirSync(trip, { recursive: true })
    for (const n of ["0142", "0145"]) await Bun.write(join(trip, `${n}.json`), JSON.stringify({ ...page, inBattle: false }))
    say("the Guardian is the one to bleed", "142")
    say("now the corpse")
    const lines = (await feed()).lines
    expect(lines[0]).toMatchObject({ page: "0142", gameAt: "0145" })
    expect(lines[1]).toMatchObject({ page: "0145" })
    expect(lines[1]!.gameAt).toBeUndefined()
    rmSync(out, { recursive: true, force: true })
    process.env.DD_TOWN_OUT = was
  })
})
