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

  test("B9: a Treatment Ward card exists only for a free seat, so no card says the seat went to someone else", async () => {
    const { readFileSync } = await import("node:fs")
    // the reason could never be reached: a card is made only while a seat is free, and the rest wait in line on one note
    expect(readFileSync(new URL("../src/voice/board.ts", import.meta.url), "utf8")).not.toContain("the seat goes to someone the road needs more")
    expect(readFileSync(new URL("../src/caretaker/plan.ts", import.meta.url), "utf8")).not.toMatch(/TreatWhy = [^\n]*"seat"/)
    const t = await town(await readSave())
    const { a } = await prepare(t, {})
    const p = plan(t, a, { answers: {}, prices: await supplyPrices() })
    if (!p.treatment) return
    expect(p.treatment.cards.filter((c) => c.why !== "paid" && c.lean === 0).length).toBeLessThanOrEqual(Math.max(0, p.treatment.freeSeats))
    expect(p.treatment.cards.length + p.treatment.waiting.length).toBe(a.treat.length)
  })

  test("Review 3: a Treatment Ward seat goes only to a card that leans to the ward; Not this week passes it on, thief first still", async () => {
    const t = await town(await readSave())
    const prices = await supplyPrices()
    for (const gold of [t.wallet.gold ?? 0, 0, 100000]) {
      const tt = { ...t, wallet: { ...t.wallet, gold } }
      const { a } = await prepare(tt, {})
      const p = plan(tt, a, { answers: {}, prices })
      if (!p.treatment) continue
      const free = Math.max(0, p.treatment.freeSeats), to = p.treatment.cards.filter((c) => c.why !== "paid" && c.lean === 0)
      expect(to.length).toBeLessThanOrEqual(free)
      // nobody waits while a seat is still free: a card leaning Not this week did not hold it
      if (p.treatment.waiting.length) expect(to.length).toBe(free)
      // the seats go down the line in order (C103: a thief first), skipping only those leaned Not this week
      const order = a.treat.filter((x) => p.treatment!.cards.some((c) => c.treat === x && c.why !== "paid"))
      const firstTaken = order.findIndex((x) => to.some((c) => c.treat === x))
      for (const x of order.slice(0, Math.max(0, firstTaken))) expect(p.treatment.cards.find((c) => c.treat === x)!.lean).toBe(1)
      if (gold === 100000) for (const x of a.treat.filter((x) => x.quirk.thief && !x.inParty).slice(0, free)) expect(to.some((c) => c.treat === x)).toBe(true)
    }
  })

  test("B10: the heirlooms improve the place of relief leaned this week by its building and activity, never by a name inside a label", async () => {
    const t = await town(await readSave())
    const { a } = await prepare(t, {})
    const prices = await supplyPrices()
    const first = plan(t, a, { answers: {}, prices })
    const leaned = first.relief.find((c) => c.why.kind === "cheapest")
    if (!leaned) return
    const act = leaned.relief.options[leaned.lean]!.activity
    const up = (tree: string, label: string) => ({ tree, code: "a", label, cost: [{ type: "crest", amount: 1 }], affordable: true, blockedBy: "" }) as any
    // a label that only mentions the place, and the place's own upgrade under a label that does not name it
    const decoy = up("guild.cost", `Guild: lower prices, as cheap as the ${act.name}`), own = up(`${act.building}.${act.activity}`, `${act.buildingName}: improved`)
    const p = plan(t, { ...a, heirlooms: [decoy, own], blocked: [], coach: [], young: undefined }, { answers: {}, prices })
    expect(p.heirlooms!.why).toEqual({ kind: "relief", place: act.name })
    expect(p.heirlooms!.lean).toBe(1)
  })

  test("B11: no module of the Caretaker's judgement imports directly from the voice, and the README lists every module of it", async () => {
    const { readdirSync, readFileSync } = await import("node:fs")
    const dir = new URL("../src/caretaker/", import.meta.url)
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"))
    for (const f of files) expect(`${f}: ${readFileSync(new URL(f, dir), "utf8").match(/from "\.\.\/voice\/[^"]+"/)?.[0] ?? "none"}`).toBe(`${f}: none`)
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8")
    for (const f of files) expect(readme).toContain(`src/caretaker/${f}`)
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
