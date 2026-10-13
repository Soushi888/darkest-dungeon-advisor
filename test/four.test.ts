// C112: one four drives the whole plan. The four the reader named, else the road he picked, else my lean: every decision that
// depends on who goes (who may be let go, who is too alike, what the Guild and the smith are offered, the trinkets, who is in the
// party at the Treatment Ward, the upkeep, the Medical Ward) is made for that one four, never for my own best four beside it.
import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { advise } from "../src/caretaker/advise.ts"
import { plan, prepare } from "../src/caretaker/plan.ts"
import { campingSkills, supplyPrices } from "../src/sources/game.ts"
import { profileDir } from "../src/sources/paths.ts"
import { readSave } from "../src/sources/read.ts"
import { questLabel, town } from "../src/world/town.ts"

let profile = ""
try { profile = profileDir() } catch {}
const has = !!profile && existsSync(profile)

describe.skipIf(!has)("C112: one four drives the whole plan", () => {
  test("whatever the reader picks or names, every decision is made for the four the board sends", async () => {
    const t = await town(await readSave())
    const mine = await advise(t), prices = await supplyPrices(), camp = await campingSkills()
    const named = t.heroes.slice(0, 4).map((h) => h.name)
    const runs = [{}, ...mine.parties.map((p) => ({ expedition: questLabel(p) })), { partyNames: named }, { expedition: questLabel(mine.parties.at(-1)!), partyNames: named }]
    let other = 0
    for (const answers of runs) {
      const { a, own, chosen } = await prepare(t, answers)
      const p = plan(t, a, { answers, ...(own ? { own } : {}), prices, camp })
      expect(p.chosen).toBe(chosen)
      if (!chosen) continue
      const four = new Set(chosen.seats.map((s) => s.hero.guid)), names = new Set(chosen.seats.map((s) => s.hero.name))
      if ([...four].sort().join() !== [...(mine.best?.seats ?? [])].map((s) => s.hero.guid).sort().join()) other++
      for (const d of a.dismiss) expect(four.has(d.hero.guid)).toBe(false)
      for (const x of a.alike) expect(four.has(x.drop.guid)).toBe(false)
      for (const u of [...a.buys, ...a.blocked]) expect(names.has(u.hero ?? "")).toBe(true)
      for (const tr of a.trinkets) if (tr.to) expect(names.has(tr.to)).toBe(true)
      for (const tr of a.treat) expect(tr.inParty).toBe(four.has(tr.hero.guid))
      for (const l of p.upkeep?.lines ?? []) expect(names.has(l.item.hero)).toBe(true)
    }
    // the probe meets at least one four that is not my own best
    expect(other).toBeGreaterThan(0)
  })

  test("B7: the upkeep and the Survivalist read what a hero knows at the fire from one source", async () => {
    const t = await town(await readSave())
    const a = await advise(t), camp = await campingSkills(), prices = await supplyPrices()
    const first = plan(t, a, { answers: {}, prices, camp })
    const seat = first.camp?.best[0]
    if (!seat) return
    // a hero whose save lists only the skills taken to the fire: the one I would have taught them is among them
    seat.hero.campKnown = undefined
    seat.hero.campEquipped = [...(seat.hero.campEquipped ?? []), seat.k.id]
    const p = plan(t, a, { answers: {}, prices, camp })
    const best = p.camp!.best.find((b) => b.hero.guid === seat.hero.guid)
    expect(best?.k.id).not.toBe(seat.k.id)
    const up = (p.upkeep?.lines ?? []).find((l) => l.item.hero === seat.hero.name && l.item.kind === "camp")
    expect(up?.item.what).toBe(best ? `${best.k.name} at the Survivalist` : undefined)
  })

  test("a plan given advice made for another four refuses it", async () => {
    const t = await town(await readSave())
    const answers = { partyNames: t.heroes.slice(0, 4).map((h) => h.name) }
    const { own } = await prepare(t, answers)
    if (!own) return
    const mine = await advise(t)
    expect(() => plan(t, mine, { answers, own })).toThrow("another four")
  })
})
