// C65: the road zone shows the Caretaker at work only for a page he answers (a CHRON page) or a question from the Heir,
// never for a plain PAGE (Soushi, 2026-10-11 04:59: "it looks like you are always writing").
import { describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, utimesSync } from "node:fs"
import { join } from "node:path"
import { isNotable } from "../src/road/notable.ts"
import { root } from "../src/sources/paths.ts"
import { feed, roadPanel, say } from "../src/road.ts"

const page = (torch: number, tally: Record<string, number> = {}) => ({ at: "", dungeon: "warrens", difficulty: 1, length: 1, quest: "explore", key: "k", torch, inBattle: false, supplies: {}, tally, heroes: [{ guid: 1, name: "Azor", cls: "vestal", hp: 20, maxHp: 24, stress: 10 }] })

describe("C65: the Caretaker is shown at work only on what he answers", () => {
  test("a plain PAGE after his line leaves the busy line off; a CHRON page turns it on", async () => {
    const was = process.env.DD_TOWN_OUT, out = join(root, ".dd-runtime", "test-busy"), trip = join(out, "chronicle", "generated_1_t")
    process.env.DD_TOWN_OUT = out
    rmSync(out, { recursive: true, force: true }); mkdirSync(trip, { recursive: true })
    const write = async (n: number, p: object, t: number) => { const f = join(trip, `${String(n).padStart(4, "0")}.json`); await Bun.write(f, JSON.stringify(p)); utimesSync(f, t, t) }
    const now = Date.now() / 1000
    await write(0, page(80), now - 60)
    say("They set out.")
    await write(1, page(78), now + 5) // a plain step: the light a little lower
    const plain = (await feed()).state, line = (await feed()).lines.at(-1)!
    expect(plain.page).toBe("0001")
    expect(plain.notablePage).toBe("0000")
    expect(plain.notableAt < line.at).toBe(true) // older than his last word: not busy
    await write(2, page(78, { BATTLE_COMPLETED: 1 }), now + 10)
    const chron = (await feed()).state
    expect(chron.notablePage).toBe("0002")
    expect(chron.notableAt > line.at).toBe(true) // newer than his last word: busy
    process.env.DD_TOWN_OUT = was
    rmSync(out, { recursive: true, force: true })
  })

  test("the live stream and the road zone share one test of what is notable", async () => {
    expect(isNotable(page(80), page(78))).toBe(false)
    expect(isNotable(page(80), page(78, { BATTLE_COMPLETED: 1 }))).toBe(true)
    expect(isNotable(page(55), page(45))).toBe(true)
    expect(roadPanel).toContain("fresh(s.notableAt)")
    expect(roadPanel).not.toContain("fresh(s.pageAt)")
    expect(await Bun.file(join(root, "src", "live.ts")).text()).toContain("isNotable(prev, p)")
  })
})
