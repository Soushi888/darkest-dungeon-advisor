// C83: the map as a figure (Soushi, 2026-10-11 06:57: "I would like an improved map of the dungeon, a prettier one I could zoom in").
import { describe, expect, test } from "bun:test"
import { rmSync } from "node:fs"
import { join } from "node:path"
import { mapIcons, mapLegend, mapSvg, type MapView } from "../src/road/map.ts"
import { root } from "../src/sources/paths.ts"
import { roadPanel } from "../src/road.ts"

const view: MapView = { bounds: [0, 4, 0, 0], here: { area: "c1", tile: 1 }, areas: [
  { id: "r1", room: true, name: "the entrance room", ends: [], tiles: [{ x: 0, y: 0, known: 3 }] },
  { id: "c1", room: false, name: "a corridor", ends: [], tiles: [{ x: 1, y: 0, known: 3 }, { x: 2, y: 0, known: 2, what: "a trap", code: 3 }, { x: 3, y: 0, known: 1 }] },
  { id: "r2", room: true, name: "a dead-end room", ends: [], tiles: [{ x: 4, y: 0, known: 2, what: "a fight", code: 1 }] },
] }

describe("C83: the map in the game's own art, to zoom into", () => {
  test("rooms by their icon, corridors by how well they are known, markers on them, the party marked", () => {
    const out = join(root, ".dd-runtime", "test-mapfigure")
    rmSync(out, { recursive: true, force: true })
    const ic = mapIcons(out)
    expect(ic.room_entrance).toBe("img/map/room_entrance.png")
    const svg = mapSvg(view, ic)
    for (const n of ["room_entrance", "room_battle", "hall_clear", "hall_dim", "hall_dark", "marker_trap", "indicator"]) expect(svg).toContain(`href="img/map/${n}.png"`)
    expect(svg).toContain('class="party"')
    expect(mapLegend(ic)).toContain('<img class="mi" src="img/map/marker_trap.png" alt="">a trap')
    rmSync(out, { recursive: true, force: true })
  })

  test("without the art, the small coloured drawing as before (C51)", () => {
    const svg = mapSvg(view)
    expect(svg).not.toContain("<image")
    expect(svg).toContain("<rect")
  })

  test("the report zooms by wheel and pinch, pans by drag, and fits or fills the screen", () => {
    for (const s of ["addEventListener('wheel'", "pointermove", "requestFullscreen", "'fit'", "zoomable();"]) expect(roadPanel).toContain(s)
  })
})
