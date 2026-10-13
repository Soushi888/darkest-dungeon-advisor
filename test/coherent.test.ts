// C87 and C88 (Soushi, 2026-10-13, back from the Warrens with no healer and a board that changed its mind about Addinell):
// a four without a true healer keeps to the shortest road, a hero who joined this week is never let go for another recruit,
// and a recruit of a class the roster already holds is never taken.
import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { advise } from "../src/advise.ts"
import { source } from "../src/board.ts"
import { profileDir } from "../src/paths.ts"
import { readSave } from "../src/read.ts"
import { town } from "../src/town.ts"

let profile = ""
try { profile = profileDir() } catch {}
const has = !!profile && existsSync(profile)

describe.skipIf(!has)("C87, C88: a roster and a road that hold together", () => {
  test("C87: a four without a true healer is leaned to the shortest road on offer", async () => {
    const t = await town(await readSave())
    const a = await advise(t)
    const best = a.parties[0]
    expect(best).toBeDefined()
    if (!best!.healer) expect(best!.quest.length).toBe(Math.min(...a.parties.map((p) => p.quest.length)))
    for (const p of a.parties) if (!p.healer && p.quest.length > 1) expect(p.notes).toContain("no true healer can go, so I keep to the shortest roads")
  })

  test("C88: a newcomer is never named for dismissal, and a recruit of a class already held is never leaned Recruit", async () => {
    const t = await town(await readSave())
    const a = await advise(t)
    // every hero on the roster counts as having joined this week: none may be let go for a recruit
    const md = source(t, a, { foresight: false, answers: {}, newcomers: new Set(t.heroes.map((h) => h.guid)) }).board
    const cards = md.split(/\n- q: /)
    for (const c of cards.filter((c) => c.startsWith('"Dismiss '))) expect(c).not.toContain("at the coach")
    for (const r of t.recruits.filter((r) => t.heroes.some((h) => h.cls === r.cls))) {
      const card = cards.find((c) => c.startsWith(`"Recruit ${r.name},`))
      expect(card).toBeDefined()
      expect(card).toMatch(/\n  lean: 1\n/)
      expect(card).toContain("the roster already has")
    }
  })
})
