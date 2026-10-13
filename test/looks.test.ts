// U30 (C76): each hero in their own look, and a face on every seat (Soushi, 2026-10-11 06:30: "Show heroes portrait for the
// seatings. Also, I would like you to display the specific outfit asset of each heroes of the board if possible").
import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { P } from "../src/sources/game.ts"
import { install } from "../src/sources/paths.ts"
import { seatFaces } from "../src/voice/board.ts"

describe("C76: their own look, and a face on every seat", () => {
  test("colour_variation 0 to 3 picks the class's art folder A to D, and each folder has its own portrait", () => {
    expect([0, 1, 2, 3].map((v) => P.portrait("vestal", v).split("/")[2])).toEqual(["vestal_A", "vestal_B", "vestal_C", "vestal_D"])
    for (const v of [0, 1, 2, 3]) expect(existsSync(join(install, P.portrait("leper", v)))).toBe(true)
    expect(P.portrait("vestal")).toBe(P.portrait("vestal", 0))
  })

  test("a seat sticky gets its hero's portrait; any other sticky is left alone", () => {
    const html = `<head></head><div class="sticky k-works" data-k="s1"><b class="t">Rank 4: Patremol</b></div><div class="sticky k-works" data-k="s2"><b class="t">Rank 1: Poussin (mind the quirk)</b></div><div class="sticky k-risk"><b class="t">Mind this</b></div>`
    const out = seatFaces(html, new Map([["Patremol", "img/houndmaster_A.png"], ["Poussin", "img/leper_C.png"]]))
    expect(out).toContain(`<div class="sticky k-works" data-k="s1"><img class="seat-face" src="img/houndmaster_A.png" alt=""><b class="t">Rank 4: Patremol`)
    expect(out).toContain(`<img class="seat-face" src="img/leper_C.png" alt=""><b class="t">Rank 1: Poussin (mind the quirk)`)
    expect(out.match(/seat-face" src/g)!.length).toBe(2)
  })
})
