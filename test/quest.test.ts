// C68: the quest's goal and progress, read from the save, on the road and in the page's snapshot; and a curio that laid an
// effect on a hero is never told as giving nothing (pm#29), with the effect named after the curio that laid it.
import { describe, expect, test } from "bun:test"
import { carried, freshEffect, type Snap } from "../src/chronicle.ts"
import { nowText } from "../src/now.ts"
import { questLine, questStatus } from "../src/quest.ts"
import { checkTale } from "../src/talecheck.ts"
import { feed, roadPanel } from "../src/road.ts"
import { root } from "../src/paths.ts"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

const ri = (goal: string, progress: object, type = "explore", dungeon = "warrens") => ({ raid: { raid_instance: { type, dungeon, length: 1, goal_ids: [goal], [goal]: progress } } })

describe("C68: the quest, read from the save", () => {
  test("each kind of goal reads as the quest card asks it, with how far along it is", async () => {
    expect(questLine((await questStatus(ri("explore_all_rooms", { explored_room_count: 1, target_room_count: 8 })))!)).toBe("Scout: explore 90% of the rooms, 1 of 8")
    expect(questLine((await questStatus(ri("battle_all_rooms", { current_battle_count: 2, target_battle_count: 2 }, "cleanse", "cove")))!)).toBe("Skirmish: win the battle in every room, 2 of 2, done")
    const gather = (await questStatus(ri("gather_holy_relic", { current_item_count: 1, target_item_count: 3 }, "gather", "crypts")))!
    expect(gather.asks).toBe("gather 3 holy relic")
    expect([gather.done, gather.of, gather.complete]).toEqual([1, 3, false])
    expect(await questStatus({ raid: {} })).toBeUndefined()
  })

  test("the page's snapshot, and so the CHRON line and the Caretaker's prompt, carries the quest", async () => {
    const page = { at: "", dungeon: "warrens", difficulty: 1, length: 1, quest: "explore", key: "k", torch: 70, inBattle: false, supplies: {}, tally: {}, heroes: [] } as any
    expect(await nowText(page, ri("explore_all_rooms", { explored_room_count: 8, target_room_count: 8 }), "0171", Date.now())).toContain("\nQUEST Scout: explore 90% of the rooms, 8 of 8, done")
  })
})

describe("C68: the quest on the road report", () => {
  test("the feed carries the quest as the page stands, and the report shows it", async () => {
    const out = join(root, ".dd-runtime", "test-quest"), trip = join(out, "chronicle", "generated_1_t")
    rmSync(out, { recursive: true, force: true }); mkdirSync(trip, { recursive: true })
    await Bun.write(join(trip, "0004.json"), JSON.stringify({ at: "", dungeon: "warrens", difficulty: 1, length: 1, quest: "explore", key: "k", torch: 70, inBattle: false, supplies: {}, tally: {}, heroes: [] }))
    await Bun.write(join(trip, "0004.raw.json"), JSON.stringify(ri("explore_all_rooms", { explored_room_count: 1, target_room_count: 8 })))
    const was = process.env.DD_TOWN_OUT
    process.env.DD_TOWN_OUT = out
    const q = (await feed()).state.quest
    process.env.DD_TOWN_OUT = was
    rmSync(out, { recursive: true, force: true })
    expect(q).toMatchObject({ name: "Scout", done: 1, of: 8, complete: false, line: "Scout: explore 90% of the rooms, 1 of 8" })
    expect(roadPanel).toContain("'<p class=\"quest'")
  })
})

describe("C68: what a curio laid is what came of it", () => {
  const hero = (effects: string[], hp = 20, stress = 10) => ({ guid: 1, name: "Azor", cls: "vestal", hp, maxHp: 24, stress, affliction: "", virtue: "", deathsDoor: false, lastBlow: "", effects })
  const page = (effects: string[], tally: Record<string, number>, more: object = {}) => ({ at: "", dungeon: "warrens", difficulty: 1, length: 1, quest: "explore", key: "k", torch: 70, inBattle: false, supplies: {}, tally, heroes: [hero(effects)], ...more }) as Snap

  test("a curio beat that says nothing came of it, when a new effect landed, is dropped and reported", () => {
    const snaps = [page([], {}), page(["bleed 2 (3) from the Rack of Blades"], { CURIO_INVESTIGATED: 1 })]
    const r = checkTale(snaps, [{ i: 1, kind: "curio", text: "they searched a Rack of Blades, and nothing came of it", bad: false }])
    expect(r.beats).toEqual([])
    expect(r.issues.join()).toContain("nothing came of a curio on page 1")
    expect(r.issues.join()).not.toContain("curios searched") // the count still holds
    // a countdown on an old effect is not new
    const tick = [page(["bleed 2 (3) from the Rack of Blades"], {}), page(["bleed 2 (2) from the Rack of Blades"], { CURIO_INVESTIGATED: 1 })]
    expect(checkTale(tick, [{ i: 1, kind: "curio", text: "they searched a crate, and nothing came of it", bad: false }]).beats.length).toBe(1)
  })

  test("an effect carried on keeps the source it landed with; one laid again is new", () => {
    expect(carried("blight 2 (1) from the Pile of Bones", ["blight 2 (3) from the Unlocked Strongbox"])).toBe("blight 2 (1) from the Unlocked Strongbox")
    expect(carried("blight 2 (3) from the Pile of Bones", ["blight 2 (1) from the Unlocked Strongbox"])).toBe("blight 2 (3) from the Pile of Bones")
    expect(freshEffect("blight 2 (1) from the Pile of Bones", ["blight 2 (3) from the Unlocked Strongbox"])).toBe(false)
    expect(freshEffect("blight 2 (3) from the Pile of Bones", ["blight 2 (1) from the Unlocked Strongbox"])).toBe(true)
  })
})

// U39: a gather quest keeps no count of its own; its progress is what the party carries (Weald, page 0089, 2026-10-11: the board
// read "gather 3 medicines, 0 of 0" with one in the pack, and offered the medicines to the floor at 0 gold)
describe("C68, U39: a gather quest counts what they carry, and its items are never left behind", () => {
  const raw = (n: number) => ({ raid: { raid_instance: { type: "gather", dungeon: "weald", length: 2, goal_ids: ["gather_medicines"], gather_medicines: {} },
    party: { inventory: { items: { 0: { type: "supply", id: "torch", amount: 8 }, ...(n ? { 1: { type: "quest_item", id: "medicines", amount: n } } : {}) } } } } })
  test("the target from the goal's item, the count from the pack", async () => {
    expect(await questStatus(raw(1))).toMatchObject({ asks: "gather 3 medicines", done: 1, of: 3, complete: false })
    expect(await questStatus(raw(0))).toMatchObject({ done: 0, of: 3 })
    expect((await questStatus(raw(3)))!.complete).toBe(true)
  })
  test("a quest item is never on the list of what to leave behind", async () => {
    const { dropFirst, packRules } = await import("../src/pack.ts")
    expect(dropFirst({ medicines: 1, jade: 1, gold: 1300 }, await packRules()).map((d) => d.key)).toEqual(["jade", "gold"])
  })
})
