// C69: a trinket the estate holds is never offered to a hero already wearing the same one, and the board never offers one
// hero the same trinket twice (Soushi, 2026-10-11 05:27 and 05:29: the second Stalwart Buckle, offered to Dismas who wore the first).
import { describe, expect, test } from "bun:test"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { advise } from "../src/caretaker/advise.ts"
import { contradictions } from "../src/voice/coherence.ts"
import { profileDir, root } from "../src/sources/paths.ts"
import { readSave } from "../src/sources/read.ts"
import { town } from "../src/world/town.ts"

let profile = ""
try { profile = profileDir() } catch {}
const has = !!profile && existsSync(profile)

describe("C69: one of a trinket per hero", () => {
  test.skipIf(!has)("a trinket the hero already wears waits for another of the class; one nobody wears goes to them", async () => {
    const dir = join(root, ".dd-runtime", "test-trinkets")
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
    for (const f of readdirSync(profile)) if (f.startsWith("persist.") && f !== "persist.raid.json") cpSync(join(profile, f), join(dir, f))
    const p = join(dir, "persist.game.json"), buf = readFileSync(p), at = buf.indexOf("inraid\0")
    if (at >= 0 && buf[at + 7]) { buf[at + 7] = 0; writeFileSync(p, buf) }
    const t = await town(await readSave(dir))
    rmSync(dir, { recursive: true, force: true })
    for (const h of t.heroes) h.stress = 0
    const first = await advise(t)
    if (!first.best) return
    const h = first.best.seats[0]!.hero
    // the hero wears one Test Buckle and has a free slot; the estate holds a second
    t.worn = { ...t.worn, [h.guid]: [{ id: "test_buckle", name: "Test Buckle", rank: 5 }] }
    t.estateTrinkets = [{ id: "test_buckle", name: "Test Buckle", classes: [h.cls], rank: 5 }]
    const a = await advise(t)
    const tr = a.trinkets.filter((x) => x.trinket === "Test Buckle")
    expect(tr.some((x) => x.to === h.name)).toBe(false)
    const others = a.best!.seats.filter((s) => s.hero.cls === h.cls && s.hero.guid !== h.guid)
    if (!others.length) {
      expect(tr).toHaveLength(1)
      expect(tr[0]!.to).toBe("")
      expect(tr[0]!.why).toBe(`${h.name} already wears one, and I do not know that a hero may wear two of the same; it waits for another ${h.clsName}`)
    }
    // nobody wearing it: it goes to a hero of the class
    t.worn = { ...t.worn, [h.guid]: [] }
    expect((await advise(t)).trinkets.some((x) => x.trinket === "Test Buckle" && x.to)).toBe(true)
  })

  test("the board warns when one hero is offered the same trinket twice", () => {
    const zone = "\n## Heirlooms and trinkets {wide}\n\n", sticky = '- title: "Stalwart Buckle to Dismas"\n  kind: idea\n  body: "A slot is free."\n'
    expect(contradictions(zone + sticky + sticky)).toContain("the same trinket is offered twice: Stalwart Buckle to Dismas")
    expect(contradictions(zone + sticky)).not.toContain("the same trinket is offered twice: Stalwart Buckle to Dismas")
    // C109: a road lesson that says "to its side" is no trinket (week 26: the Collector "called ... to its side" set off a false warning)
    const lesson = '\n## The coach is back {wide}\n\n- title: "The Collector, a wanderer: It called Collected Vestal to its side. Guernon was brought low."\n  kind: idea\n'
    const four = '\n## The next expedition {wide}\n\n```board-decisions\n- q: "Take this party?"\n  context: "Front to back: 1. Herbert (Crusader, 0 stress)"\n  options:\n    - pick: "Yes"\n      effect: "x"\n    - pick: "No"\n      effect: "y"\n  lean: 0\n  lean_why: "z"\n```\n'
    expect(contradictions(lesson + four).filter((c) => /not in the four|offered twice/.test(c))).toEqual([])
    // and the check still bites inside the zone
    expect(contradictions(four + zone + '- title: "Bleed Stone to Nobody"\n  kind: idea\n')).toContain("Bleed Stone goes to Nobody, who is not in the four")
  })
})
