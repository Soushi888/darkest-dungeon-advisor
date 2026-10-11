// C51: the map as the party knows it. A synthetic dungeon shaped like the Cove trip of 2026-10-11, so the claim is probed
// whether or not Soushi is out: an entrance to the east, a crossroads, a dead end to the west and another past a corridor at the crossroads' own longitude.
import { describe, expect, test } from "bun:test"
import { mapSvg, newlySeen, readMap, whereLine } from "../src/map.ts"

const id = (s: string) => new DataView(new TextEncoder().encode(s).buffer).getInt32(0, true)
const door = (to: string, tile = 0) => ({ area_to: id(to), tile_to: tile, implied: true, type: 0 })
const room = (x: number, ...doors: ReturnType<typeof door>[]) => ({ kind: 0, ...Object.fromEntries([...doors, ...Array(8 - doors.length).fill(door("none"))].map((d, i) => [`door${i}`, d])), tiles: { tile0: { type: 3, obstacle: 0, mappos: [x, 0] } } })
const hall = (xs: number[], obstacle: Record<number, string> = {}) => ({ kind: 1, tiles: Object.fromEntries(xs.map((x, i) => [`tile${i}`, { type: i === 0 || i === xs.length - 1 ? 2 : 1, obstacle: obstacle[i] ?? 0, mappos: [x, 0] }])) })
const know = (k: number, content = 0, more: Record<string, unknown> = {}) => ({ knowledge: k, content, curio_prop: 0, trap: 0, mash_index: -1, ...more })

function fixture(over: Record<string, Record<string, ReturnType<typeof know>>> = {}) {
  const st = {
    rooO: room(12, door("coNO", 0)),
    coNO: hall([11, 10, 9, 8, 7], { 2: "shipwreck" }),
    rooN: room(6, door("coNO", 4), door("coMN", 4), door("coIN", 0)),
    coMN: hall([1, 2, 3, 4, 5]),
    rooM: room(0, door("coMN", 0)),
    coIN: hall([6, 6, 6, 6, 6]),
    rooI: room(6, door("coIN", 4)),
  }
  const dy: Record<string, any> = {
    rooO: { tile0: know(3) },
    coNO: { tile0: know(3), tile1: know(3, 0, { curio_prop: "eerie_coral" }), tile2: know(3), tile3: know(3, 8), tile4: know(3) },
    rooN: { tile0: know(3) },
    coMN: { tile0: know(1), tile1: know(1, 3, { trap: "lurker" }), tile2: know(1, 1, { mash_index: 4 }), tile3: know(1), tile4: know(1) },
    rooM: { tile0: know(1, 7, { curio_prop: "eldritch_altar" }) },
    coIN: { tile0: know(3), tile1: know(3, 7, { curio_prop: "eerie_coral" }), tile2: know(2, 1, { mash_index: 10 }), tile3: know(2, 8), tile4: know(2) },
    rooI: { tile0: know(2) },
    ...over,
  }
  return {
    map: { bounds: [0, 12, 0, 0], entrance_id: id("rooO"), final_room_id: id("none"), static_dynamic: {
      static_save: { areas: st },
      areas: Object.fromEntries(Object.entries(dy).map(([k, tiles]) => [k, { knowledge: 1, reversed: false, tiles }])),
    } },
  }
}

describe("C51: the map as the party knows it", () => {
  test("nothing is told on a tile the party has only on the map", () => {
    const v = readMap(fixture(), { in_area: id("rooN"), areatile: 0, last_room_id: id("coNO") })!
    for (const a of v.areas) for (const t of a.tiles) if (t.known < 2) { expect(t.what).toBeUndefined(); expect(t.code).toBeUndefined() }
    // the trap, the fight and the altar toward the dead end stay unsaid until seen
    const line = whereLine(v)
    expect(line).not.toMatch(/trap|altar/i)
    expect(line).toContain("a fight")
  })

  test("each code reads as the trip showed it, and an unpinned one is never told", () => {
    const v = readMap(fixture(), { in_area: id("rooN"), areatile: 0, last_room_id: id("coNO") })!
    const by = (a: string) => v.areas.find((x) => x.id === a)!.tiles
    expect(by("coNO")[1]!.what).toBe("an Eerie Coral, searched")
    expect(by("coNO")[2]!.what).toBe("a Shipwreck, cleared")
    expect(by("coIN")[1]!.what).toBe("an Eerie Coral, not yet searched")
    expect(by("coIN")[2]!.what).toBe("a fight")
    // a hunger check (8, likely) is kept as a code and never said
    expect(by("coIN")[3]!.what).toBeUndefined()
    expect(by("coIN")[3]!.code).toBe(8)
    const seen = readMap(fixture({ coMN: { tile0: know(2), tile1: know(2, 3, { trap: "lurker" }), tile2: know(2, 6), tile3: know(2), tile4: know(2) } }), {})!
    expect(seen.areas.find((x) => x.id === "coMN")!.tiles[1]!.what).toBe("a trap")
    expect(seen.areas.find((x) => x.id === "coMN")!.tiles[2]!.what).toBeUndefined()
  })

  test("the party stands where its steps put it, from whichever end it came in", () => {
    // from the crossroads into the corridor toward the eastern dead end: the door is at its first tile, so step 2 is tile 2
    const v = readMap(fixture(), { in_area: id("coIN"), areatile: 2, last_room_id: id("rooN") })!
    expect(v.here).toMatchObject({ area: "coIN", tile: 2, from: "rooN", to: "rooI", back: false })
    expect(whereLine(v)).toBe("in the corridor from the crossroads where three ways meet toward the eastern dead-end room, step 2 of 4, on a fight; ahead: nothing known")
    // from the crossroads toward the dead end: the door is at the corridor's last tile, so the steps count down
    const w = readMap(fixture(), { in_area: id("coMN"), areatile: 1, last_room_id: id("rooN") })!
    expect(w.here).toMatchObject({ tile: 3, back: true })
    expect(whereLine(w)).toContain("step 1 of 4")
  })

  test("areas are named as the player sees them, never by their save ids", () => {
    const v = readMap(fixture(), { in_area: id("rooN"), areatile: 0, last_room_id: id("coNO") })!
    const name = (a: string) => v.areas.find((x) => x.id === a)!.name
    expect(name("rooO")).toBe("the entrance room")
    expect(name("rooN")).toBe("the crossroads where three ways meet")
    expect(name("rooM")).toBe("the western dead-end room")
    expect(name("rooI")).toBe("the eastern dead-end room")
    expect(name("coMN")).toBe("the corridor between the western dead-end room and the crossroads")
    const line = whereLine(v)
    expect(line).toMatch(/^in the crossroads where three ways meet; ways out: east to the entrance room; west to the western dead-end room; to the eastern dead-end room: an Eerie Coral, not yet searched, a fight$/)
    expect(line).not.toMatch(/\b(roo|co)[A-Z]{1,2}\b|north|south/)
  })

  test("north is up: smaller y lies north, and rooms of a kind are told apart by where they lie", () => {
    const f = fixture()
    // the dead end past the long corridor sits north of the crossroads, as the room at y 0 sat above the one at y 5 on the Cove map
    ;(f.map.static_dynamic.static_save.areas as any).rooI.tiles.tile0.mappos = [6, -4]
    f.map.bounds = [0, 12, -4, 0]
    const v = readMap(f, { in_area: id("rooN"), areatile: 0, last_room_id: id("coNO") })!
    const name = (a: string) => v.areas.find((x) => x.id === a)!.name
    expect(name("rooI")).toBe("the northern dead-end room")
    expect(name("rooM")).toBe("the western dead-end room")
    expect(whereLine(v)).toContain("north to the northern dead-end room")
    expect(whereLine(v)).toContain("west to the western dead-end room")
  })

  test("a sight new since the last page is told once, and only what came into sight", () => {
    const before = readMap(fixture({ coIN: { tile0: know(3), tile1: know(3, 7, { curio_prop: "eerie_coral" }), tile2: know(1, 1, { mash_index: 10 }), tile3: know(1), tile4: know(1) } }), {})
    const after = readMap(fixture(), {})
    expect(newlySeen(before, after)).toEqual(["a fight in the corridor between the crossroads and the eastern dead-end room"])
    expect(newlySeen(after, after)).toEqual([])
  })

  test("the drawing marks the party and carries no letters", () => {
    const svg = mapSvg(readMap(fixture(), { in_area: id("coIN"), areatile: 2, last_room_id: id("rooN") }))
    expect(svg).toContain('class="party"')
    expect(svg).not.toContain("<text")
    expect(svg).not.toMatch(/roo[A-Z]|co[A-Z]{2}/)
  })
})

describe("C54: the road zone keys its map and takes the board's pins", () => {
  test("every colour on the drawing is in the legend, and a tile seen but not walked stands out", async () => {
    const { mapLegend } = await import("../src/map.ts")
    const svg = mapSvg(readMap(fixture(), { in_area: id("rooN"), areatile: 0, last_room_id: id("coNO") }))
    const legend = mapLegend()
    for (const c of new Set([...svg.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]!).filter((c) => c !== "#0b0a08"))) expect(legend).toContain(c)
    // the passage room past the fight corridor is seen, not walked
    expect(svg).toMatch(/stroke="#e8dcb8"/)
    expect(legend).toMatch(/^<p class="legend">/)
  })

  test("the zone is markdown to the comment tool, and its blocks become paragraphs", async () => {
    const { roadPanel } = await import("../src/road.ts")
    expect(roadPanel).toContain("z.className='zone wide md'")
    // the report and the conversation are written as paragraphs from the start (C66): seats, messages, captions
    for (const el of ['<p class="seat', '<p class="msg ', '<p class="meta">', '<p class="said">']) expect(roadPanel).toContain(el)
    expect(roadPanel).not.toContain('<div class="msg')
  })
})
