// C69: a trinket the estate holds is never offered to a hero already wearing the same one, and the board never offers one
// hero the same trinket twice (Soushi, 2026-10-11 05:27 and 05:29: the second Stalwart Buckle, offered to Dismas who wore the first).
import { describe, expect, test } from "bun:test"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { advise } from "../src/advise.ts"
import { contradictions } from "../src/coherence.ts"
import { profileDir, root } from "../src/paths.ts"
import { readSave } from "../src/read.ts"
import { town } from "../src/town.ts"

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
    const sticky = '- title: "Stalwart Buckle to Dismas"\n  kind: idea\n  body: "A slot is free."\n'
    expect(contradictions(sticky + sticky)).toContain("the same trinket is offered twice: Stalwart Buckle to Dismas")
    expect(contradictions(sticky)).not.toContain("the same trinket is offered twice: Stalwart Buckle to Dismas")
  })
})
