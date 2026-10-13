// The dungeon's map as the party knows it (C51): where they stand, and what is known on each room and corridor, read from
// persist.map.json (static_save.areas for the layout, areas for what the party knows) and persist.raid.json (in_area,
// areatile, last_room_id). Only what Soushi has seen is told: a tile's content shows from knowledge 2, never at 1 (C5's boundary).
//
// Codes pinned against the Cove trip of 2026-10-11 (chronicle generated_3_1190485998, 50 pages):
//   knowledge   1 the layout on the map, 2 seen ahead or scouted, 3 walked (set on the step: the fight tile went 2 to 3 as it began)
//   content     0 nothing (or done), 1 a fight (with a mash_index), 3 a trap (with its name), 7 a curio not yet searched
//               (the coral walked past), 8 a hunger check, likely (food 8 to 4 on the step onto one, page 46; not on another, pages 4 to 6),
//               6 unknown. A searched curio reads 0 with its curio_prop kept (the barnacle chest, the first coral).
//   obstacle    the static tile's own field ("shipwreck"): both shovels were spent on exactly those two tiles, which read content 0
//   areatile    steps from the end the party came in by; the room's door to the corridor names that end (tile_to)
//   an area id is its name's four bytes, little-endian ("rooB" is 1114599282), and "none" marks a door that leads nowhere
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { install } from "./paths.ts"
import type { Save } from "./read.ts"

export interface MapTile { x: number; y: number; known: number; what?: string; code?: number }
export interface MapArea { id: string; room: boolean; name: string; ends: string[]; tiles: MapTile[] }
export interface MapView {
  bounds: [number, number, number, number]
  areas: MapArea[]
  // where the party stands: the area, the tile within it, and for a corridor the room they came from and the one ahead
  here?: { area: string; tile: number; from?: string; to?: string; back?: boolean }
}

const idName = (n: unknown) => {
  if (typeof n === "string") return n
  const b = new DataView(new ArrayBuffer(4)); b.setInt32(0, Number(n ?? 0), true)
  return String.fromCharCode(...new Uint8Array(b.buffer))
}
const words = (id: string) => id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
const a_ = (w: string) => `${/^[AEIOU]/i.test(w) ? "an" : "a"} ${w}`
const RANKS: Record<number, string[]> = { 2: ["western", "eastern"], 3: ["western", "middle", "eastern"] }
// x grows to the east and y to the south (Soushi, 2026-10-11 03:54: the room at y 0 is "above on the map" from the crossroads at y 5)
const compass = (dx: number, dy: number) => {
  if (!dx && !dy) return ""
  const a = (Math.atan2(-dy, dx) * 180) / Math.PI, i = Math.round(((a + 360) % 360) / 45) % 8
  return ["east", "north-east", "north", "north-west", "west", "south-west", "south", "south-east"][i]!
}
const ADJ: Record<string, string> = { east: "eastern", west: "western", north: "northern", south: "southern" }
const adj = (d: string) => d.split("-").map((w) => ADJ[w] ?? w).join("-").replace(/^(\w+)ern-(\w+)ern$/, "$1-$2ern")

/** What a tile holds, in words, or undefined when nothing is there or the party has not seen it. */
function content(t: any, d: any): { what?: string; code?: number } {
  const known = Number(d?.knowledge ?? 0), code = Number(d?.content ?? 0), prop = typeof d?.curio_prop === "string" ? d.curio_prop : ""
  const obstacle = typeof t?.obstacle === "string" ? t.obstacle : ""
  if (known < 2) return {}
  if (obstacle) return { what: known >= 3 ? `${a_(words(obstacle))}, cleared` : `${a_(words(obstacle))} in the way` }
  if (code === 1) return { what: "a fight", code }
  if (code === 3) return { what: "a trap", code }
  if (code === 7) return { what: `${a_(words(prop || "curio"))}, not yet searched`, code }
  if (code === 0 && prop) return { what: `${a_(words(prop))}, searched` }
  if (code === 0) return {}
  // a hunger check is never drawn on the game's own map, so it is not told ahead of the party; it stays in the record
  return { code }
}

/** The map the party knows, or undefined outside a dungeon. Takes the decoded map and raid, so a test can hand it a fixture. */
export function readMap(map: any, raid: any): MapView | undefined {
  const m = map?.map ?? map, st = m?.static_dynamic?.static_save?.areas, dy = m?.static_dynamic?.areas
  if (!st || !dy) return undefined
  const entrance = idName(m.entrance_id), final = idName(m.final_room_id)
  const raw = Object.entries<any>(st).map(([id, s]) => {
    const doors = Object.entries<any>(s).filter(([k]) => /^door\d+$/.test(k)).map(([, v]) => ({ to: idName(v.area_to), tile: Number(v.tile_to ?? 0) })).filter((d) => d.to !== "none")
    const tiles: MapTile[] = Object.entries<any>(s.tiles ?? {}).sort(([a], [b]) => Number(a.slice(4)) - Number(b.slice(4))).map(([k, t]) => {
      const d = dy[id]?.tiles?.[k]
      return { x: Number(t.mappos?.[0] ?? 0), y: Number(t.mappos?.[1] ?? 0), known: Number(d?.knowledge ?? 0), ...content(t, d) }
    })
    return { id, room: Number(s.kind) === 0, doors, tiles }
  })
  // a room is named the way the map shows it: the entrance, the final room, a dead end, a passage, a crossroads; two of a kind
  // are told apart by where they lie
  const label = (r: (typeof raw)[number]) => r.id === entrance ? "entrance room" : r.id === final ? "final room"
    : r.doors.length <= 1 ? "dead-end room" : r.doors.length === 2 ? "passage room" : `crossroads where ${["", "", "", "three", "four"][r.doors.length] ?? r.doors.length} ways meet`
  const names = new Map<string, string>()
  const rooms = raw.filter((r) => r.room)
  for (const kind of new Set(rooms.map(label))) {
    const same = rooms.filter((r) => label(r) === kind).sort((a, b) => a.tiles[0]!.x - b.tiles[0]!.x)
    // two of a kind are told apart by where they lie on the map, from its middle; when that does not tell them apart, west to east
    const mid = [(m.bounds?.[0] + m.bounds?.[1]) / 2 || 0, (m.bounds?.[2] + m.bounds?.[3]) / 2 || 0]
    const where = same.map((r) => compass(r.tiles[0]!.x - mid[0]!, r.tiles[0]!.y - mid[1]!))
    const byPlace = where.every((w) => w) && new Set(where).size === where.length
    same.forEach((r, i) => names.set(r.id, `the ${same.length === 1 ? "" : `${byPlace ? adj(where[i]!) : RANKS[same.length]?.[i] ?? `${ordinal(i)} from the west`} `}${kind}`))
  }
  const short = (id: string) => (names.get(id) ?? "").replace(/ where \w+ ways meet/, "")
  const ends = new Map<string, string[]>()
  for (const r of rooms) for (const d of r.doors) ends.set(d.to, [...(ends.get(d.to) ?? []), r.id])
  for (const c of raw.filter((r) => !r.room)) {
    const x = (r: string) => rooms.find((q) => q.id === r)?.tiles[0]?.x ?? 0
    // the corridor is told west end first
    const [a, b] = [...(ends.get(c.id) ?? [])].sort((p, q) => x(p) - x(q)).map(short)
    names.set(c.id, a && b ? `the corridor between ${a} and ${b}` : "a corridor")
  }
  const areas: MapArea[] = raw.map((r) => ({ id: r.id, room: r.room, name: names.get(r.id)!, ends: r.room ? r.doors.map((d) => d.to) : ends.get(r.id) ?? [], tiles: r.tiles }))
  let here: MapView["here"]
  const at = raid?.in_area !== undefined ? idName(raid.in_area) : ""
  const area = raw.find((r) => r.id === at)
  if (area) {
    const step = Number(raid.areatile ?? 0)
    if (area.room) here = { area: at, tile: 0 }
    else {
      const from = idName(raid.last_room_id), door = raw.find((r) => r.id === from)?.doors.find((d) => d.to === at)
      const n = area.tiles.length, fromHigh = !!door && door.tile !== 0
      here = { area: at, tile: fromHigh ? n - 1 - step : step, from, to: (ends.get(at) ?? []).find((x) => x !== from), back: fromHigh }
    }
  }
  const bd = (m.bounds ?? [0, 0, 0, 0]).map(Number) as [number, number, number, number]
  return { bounds: bd, areas, here }
}

export const mapOf = (save: Save) => readMap((save.map as any)?.map ?? save.map, save.raid)

const side = (a: MapArea | undefined, b: MapArea | undefined) => compass((b?.tiles[0]?.x ?? 0) - (a?.tiles[0]?.x ?? 0), (b?.tiles[0]?.y ?? 0) - (a?.tiles[0]?.y ?? 0))

/** Where the party stands and what is known ahead, in the Hamlet's words. */
export function whereLine(v: MapView | undefined): string {
  if (!v?.here) return ""
  const by = new Map(v.areas.map((a) => [a.id, a])), a = by.get(v.here.area)!
  if (a.room) {
    const room = a.tiles[0]?.what ? `${a.name} (${a.tiles[0].what})` : a.name
    const ways = a.ends.map((c) => { const co = by.get(c), other = co?.ends.find((x) => x !== a.id), seen = (co?.tiles ?? []).filter((t) => t.what && !/, (searched|cleared)$/.test(t.what)).map((t) => t.what) // what is still there to meet
      return `${side(a, by.get(other ?? ""))} to ${by.get(other ?? "")?.name ?? "somewhere"}${seen.length ? `: ${seen.join(", ")}` : ""}`.trim() })
    return `in ${room}; ways out: ${ways.join("; ")}`
  }
  const from = by.get(v.here.from ?? ""), to = by.get(v.here.to ?? ""), n = a.tiles.length - 1, i = v.here.tile
  // the steps still to walk, from the party's tile toward the far end (back: they came in at the corridor's last tile)
  const ahead = (v.here.back ? a.tiles.slice(0, i).reverse() : a.tiles.slice(i + 1)).map((t, k) => t.what ? `${t.what} in ${k + 1}` : "").filter(Boolean)
  const here = a.tiles[i]?.what
  const end = to?.tiles[0]?.what ? `${to.name} (${to.tiles[0].what})` : to?.name ?? "the far end"
  return `in the corridor from ${from?.name ?? "a room"} toward ${end}, step ${v.here.back ? n - i : i} of ${n}${here ? `, on ${here}` : ""}; ahead: ${ahead.length ? ahead.join(", ") : "nothing known"}`
}

/** What the party saw for the first time since the last page: tiles that came into knowledge without being walked. */
export function newlySeen(prev: MapView | undefined, now: MapView | undefined): string[] {
  if (!prev || !now) return []
  const was = new Map(prev.areas.map((a) => [a.id, a]))
  return now.areas.flatMap((a) => a.tiles.filter((t, i) => t.what && t.known === 2 && (was.get(a.id)?.tiles[i]?.known ?? 0) < 2).map((t) => `${t.what} in ${a.name}`))
}

// the drawing's colours, one list for the map and its legend
const INK = { walked: "#c9b88a", seen: "#7d7258", layout: "#3a362d", edge: "#e8dcb8", fight: "#b3261e", trap: "#d97706", curio: "#e3b341", obstacle: "#5b7a99", done: "#6b6b6b" }
const mark = (t: MapTile) => !t.what ? "" : /fight/.test(t.what) ? INK.fight : /trap/.test(t.what) ? INK.trap : /, searched$/.test(t.what) ? INK.done : /cleared$/.test(t.what) ? INK.done : /in the way/.test(t.what) ? INK.obstacle : INK.curio

// C83: the game's own map art (panels/icons_map), copied beside the page (A4) so the map reads as the game draws it
const ICONS = ["room_battle", "room_curio", "room_entrance", "room_empty", "room_unknown", "room_boss", "room_treasure", "hall_clear", "hall_dim", "hall_dark",
  "marker_battle", "marker_curio", "marker_trap", "marker_obstacle", "marker_hunger", "marker_room_visited", "indicator"]
/** Copies the map icons beside the page once; the relative paths by name, or none when the install has no map art. */
export function mapIcons(out: string): Record<string, string> {
  const got: Record<string, string> = {}
  for (const n of ICONS) {
    const src = join(install, "panels", "icons_map", `${n}.png`), rel = `img/map/${n}.png`
    if (!existsSync(src)) continue
    if (!existsSync(join(out, rel))) { mkdirSync(join(out, "img", "map"), { recursive: true }); copyFileSync(src, join(out, rel)) }
    got[n] = rel
  }
  return got
}
// a room's icon by what the party knows of it, and a corridor tile's marker by what it holds
const roomIcon = (a: MapArea, t: MapTile) => /entrance/.test(a.name) ? "room_entrance" : t.known < 2 || t.code === 6 ? "room_unknown" : /fight/.test(t.what ?? "") ? "room_battle"
  : /not yet searched/.test(t.what ?? "") ? "room_curio" : "room_empty"
const marker = (t: MapTile) => !t.what ? (t.code === 8 && t.known >= 2 ? "marker_hunger" : "") : /fight/.test(t.what) ? "marker_battle" : /trap/.test(t.what) ? "marker_trap"
  : /in the way/.test(t.what) ? "marker_obstacle" : /, searched$|cleared$/.test(t.what) ? "marker_room_visited" : "marker_curio"

/** The legend under the drawing, in words, each beside its colour or, with the game's art, its icon. */
export function mapLegend(icons: Record<string, string> = {}): string {
  const sw = (c: string, w: string, dot = false) => `<span><i${dot ? ' class="dot"' : ""} style="background:${c}"></i>${w}</span>`
  if (icons.room_empty) {
    const ic = (n: string, w: string) => (icons[n] ? `<span><img class="mi" src="${icons[n]}" alt="">${w}</span>` : "")
    return `<p class="legend">${ic("indicator", "the party")}${ic("room_entrance", "the entrance")}${ic("room_empty", "a room walked or empty")}${ic("room_unknown", "a room not yet seen")}${ic("room_battle", "a fight")}${ic("room_curio", "a curio to search")}${ic("hall_clear", "corridor walked")}${ic("hall_dim", "seen or scouted")}${ic("hall_dark", "only its shape on the map")}${ic("marker_trap", "a trap")}${ic("marker_obstacle", "an obstacle in the way")}${ic("marker_hunger", "hunger")}${ic("marker_room_visited", "searched or cleared")}</p>`
  }
  return `<p class="legend"><span><i class="ring"></i>the party</span>${sw(INK.walked, "walked")}${sw(INK.seen, "seen or scouted, not walked")}${sw(INK.layout, "only its shape on the map")}${sw(INK.fight, "a fight", true)}${sw(INK.curio, "a curio to search", true)}${sw(INK.trap, "a trap", true)}${sw(INK.obstacle, "an obstacle in the way", true)}${sw(INK.done, "searched or cleared", true)}</p>`
}

/** The known map with the party marked. With the game's art (C83): each room by its own icon, each corridor tile by how well it
 *  is known with its marker, on a grid large enough to stay crisp when zoomed; without it, the small coloured drawing (C51). */
export function mapSvg(v: MapView | undefined, icons: Record<string, string> = {}): string {
  if (!v) return ""
  const art = !!icons.room_empty && !!icons.hall_clear
  const [x0, x1, y0, y1] = v.bounds, c = art ? 40 : 14, pad = 1
  const W = (x1 - x0 + 1 + 2 * pad) * c, H = (y1 - y0 + 1 + 2 * pad) * c
  const px = (x: number) => (x - x0 + pad) * c, py = (y: number) => (y - y0 + pad) * c
  const shade = (k: number) => (k >= 3 ? INK.walked : k === 2 ? INK.seen : INK.layout)
  const out: string[] = []
  const img = (n: string, x: number, y: number, s: number) => `<image href="${icons[n]}" x="${x}" y="${y}" width="${s}" height="${s}" preserveAspectRatio="xMidYMid meet"/>`
  // corridors first, rooms over them, as the game lays its rooms over the halls' ends
  for (const a of [...v.areas].sort((p, q) => Number(p.room) - Number(q.room))) for (const t of a.tiles) {
    const s = a.room ? c * (art ? 1.7 : 1.4) : c * (art ? 0.95 : 0.7), x = px(t.x) + (c - s) / 2, y = py(t.y) + (c - s) / 2
    if (art) {
      out.push(img(a.room ? roomIcon(a, t) : t.known >= 3 ? "hall_clear" : t.known === 2 ? "hall_dim" : "hall_dark", x, y, s))
      const m = a.room ? "" : marker(t)
      if (m && icons[m]) out.push(img(m, px(t.x) + c * 0.15, py(t.y) + c * 0.15, c * 0.7))
      continue
    }
    // a tile seen ahead or scouted but not yet walked carries a light edge, so what the scouting showed stands out
    out.push(`<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="2" fill="${shade(t.known)}"${t.known === 2 ? ` stroke="${INK.edge}" stroke-width="1.5"` : ""}/>`)
    const m = mark(t)
    if (m) out.push(`<circle cx="${px(t.x) + c / 2}" cy="${py(t.y) + c / 2}" r="${c * 0.22}" fill="${m}"/>`)
  }
  const a = v.areas.find((x) => x.id === v.here?.area), t = a?.tiles[v.here?.tile ?? 0]
  if (t && art && icons.indicator) out.push(`<circle class="party" cx="${px(t.x) + c / 2}" cy="${py(t.y) + c / 2}" r="${c * 0.75}" fill="none" stroke="#f5f5f4" stroke-width="3"/>`, img("indicator", px(t.x) + c * 0.1, py(t.y) - c * 0.55, c * 0.8))
  else if (t) out.push(`<circle class="party" cx="${px(t.x) + c / 2}" cy="${py(t.y) + c / 2}" r="${c * 0.62}" fill="none" stroke="#f5f5f4" stroke-width="2"/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="the map as the party knows it"><rect width="${W}" height="${H}" fill="#0b0a08"/>${out.join("")}</svg>`
}

/** "first" to "twelfth", then "13th" and on: a dungeon with more passage rooms than six still names each one (the Weald, week 22, said "the undefined from the west"). */
export function ordinal(i: number): string {
  return ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"][i] ?? `${i + 1}th`
}
