// Step 3b of the refactor: the week as the save shows it and the week as the plan advises it are two different towns (C90), and
// each reader takes the right one. What was done (C18's checks, C26's "This week so far") is read from the save; the four are
// chosen on the Hamlet as the week found it.
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { buildBoard } from "../src/voice/board.ts"
import { profileDir, root } from "../src/sources/paths.ts"
import { readSave } from "../src/sources/read.ts"
import { town, type Town } from "../src/world/town.ts"

let profile = ""
try { profile = profileDir() } catch {}
const has = !!profile && existsSync(profile)

/** The save with one free hero placed in a place of relief that has a free seat, as the game would show it once the pick is followed. */
export async function placedTown(): Promise<{ t: Town; real: Town; hero: Town["heroes"][number]; act: Town["activities"][number] }> {
  const t = await town(await readSave())
  const act = t.activities.find((a) => a.heal > 0 && !a.locked && a.slots > a.used)!
  const hero = t.heroes.find((h) => !h.busy && !h.quirks.some((q) => act.barred.includes(q.id)))!
  const real: Town = { ...t, heroes: t.heroes.map((h) => (h.guid === hero.guid ? { ...h, busy: act.name } : h)), activities: t.activities.map((a) => (a === act ? { ...a, used: a.used + 1 } : a)) }
  return { t, real, hero, act }
}

/** Builds the town board into a fresh folder, with the week's start and the picks given. */
export async function buildIn(dir: string, t: Town, start: unknown, picks?: unknown, files: Record<string, string> = {}): Promise<string> {
  const saved = process.env.DD_TOWN_OUT
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "week-start.json"), JSON.stringify(start))
  for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text)
  if (picks) writeFileSync(join(dir, "picks.json"), JSON.stringify(picks))
  process.env.DD_TOWN_OUT = dir
  try { await buildBoard(t) } finally { if (saved === undefined) delete process.env.DD_TOWN_OUT; else process.env.DD_TOWN_OUT = saved }
  return Bun.file(join(dir, "town.md")).text()
}

describe.skipIf(!has)("B1: what was done is read from the save, not from the planned view", () => {
  test("C18, C26: a followed placement reads Done, and the hero shows in the buildings", async () => {
    const { real, hero, act } = await placedTown()
    // the week began with the hero free; since then they were placed where the board leaned them
    const start = { week: real.week, heroes: real.heroes.map((h) => ({ guid: h.guid, name: h.name, busy: h.guid === hero.guid ? "" : h.busy })), bought: [...real.bought], gold: real.wallet.gold ?? 0 }
    const picks = { week: real.week, picks: { [`Where does ${hero.name} go?`]: { pick: act.name } } }
    const md = await buildIn(join(root, ".dd-runtime", "test-week-b1"), real, start, picks)
    expect(md).toContain(`Done: Where does ${hero.name} go?`)
    expect(md).not.toContain(`Not yet: Where does ${hero.name} go?`)
    expect(md).toMatch(new RegExp(`In the buildings: [^"]*${hero.name} at the ${act.name}`))
  }, 60_000)
})

describe.skipIf(!has)("C42, C91: the lessons ledger is part of the Town", () => {
  test("the Town carries the kept lessons, so every advise() caller ranks the roads with them; the board loads them nowhere else", async () => {
    const { readFileSync } = await import("node:fs")
    const dir = join(root, ".dd-runtime", "test-week-ledger"), saved = process.env.DD_TOWN_OUT
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
    const lessons = [{ trip: "Weald, week 1", dungeon: "weald", difficulty: 1, length: 1, week: 1, kind: "light", text: "they broke in the dark" }]
    writeFileSync(join(dir, "lessons.json"), JSON.stringify(lessons))
    process.env.DD_TOWN_OUT = dir
    try {
      expect((await town(await readSave())).ledger).toEqual(lessons as any)
      rmSync(join(dir, "lessons.json"))
      expect((await town(await readSave())).ledger).toEqual([])
    } finally { if (saved === undefined) delete process.env.DD_TOWN_OUT; else process.env.DD_TOWN_OUT = saved }
    expect(readFileSync(new URL("../src/voice/board.ts", import.meta.url), "utf8")).not.toContain("t.ledger = await loadLedger()")
  })
})

describe.skipIf(!has)("C18: answers sent in another week do not steer this one", () => {
  test("answers.md is stamped with its week when sent, and last week's road and four are dropped on reading", async () => {
    const { stampAnswers, readAnswers } = await import("../src/voice/board.ts")
    const { advise } = await import("../src/caretaker/advise.ts")
    const { questLabel } = await import("../src/world/town.ts")
    const t = await town(await readSave()), a = await advise(t)
    const other = a.parties.find((p) => p !== a.best)
    if (!other) return
    const names = t.heroes.slice(-4).map((h) => h.name)
    const body = [`## My answers: The Hamlet, week ${t.week}`, "", `- **1. Which expedition next?** ${questLabel(other)}`, `- **2. Take this party to the ${other.quest.dungeonName}?** No, I choose my own`, `  - Note (refines or overrides the pick): ${names.join(", ")}`, ""].join("\n")
    const start = { week: t.week, heroes: t.heroes.map((h) => ({ guid: h.guid, name: h.name, busy: h.busy })), bought: [...t.bought], gold: t.wallet.gold ?? 0 }
    const dir = join(root, ".dd-runtime", "test-week-answers")
    // this week's answers steer the road and the four
    await buildIn(dir, t, start, undefined, { "answers.md": stampAnswers(body, t.week) })
    const now = await Bun.file(join(dir, "proposal.json")).json()
    expect(now.picked).toBe(true)
    expect(now.label).toBe(questLabel(other))
    // the same answers, sent last week, steer nothing
    await buildIn(dir, t, start, undefined, { "answers.md": stampAnswers(body.replace(`week ${t.week}`, `week ${t.week - 1}`), t.week - 1) })
    const was = await Bun.file(join(dir, "proposal.json")).json()
    expect(was.picked).toBe(false)
    expect(was.own).toBe(false)
    expect(was.label).toBe(questLabel(a.best!))
    const saved = process.env.DD_TOWN_OUT
    process.env.DD_TOWN_OUT = dir
    try { const r = await readAnswers(t.week); expect(r.expedition).toBeUndefined(); expect(r.partyNames).toBeUndefined() } finally { if (saved === undefined) delete process.env.DD_TOWN_OUT; else process.env.DD_TOWN_OUT = saved }
  }, 60_000)
})

/** A card of the built board by its question: its options in order, the option it leans to, and why. */
function card(md: string, q: string): { options: string[]; lean: string | undefined; why: string } | undefined {
  const c = md.split(/\n- q: /).find((x) => x.startsWith(JSON.stringify(q)))
  if (!c) return undefined
  const options = [...c.matchAll(/^\s+- pick: (".*")$/gm)].map((m) => JSON.parse(m[1]!) as string)
  const lean = Number(c.match(/^\s+lean: (\d+)$/m)?.[1])
  return { options, lean: options[lean] ?? (lean === options.length ? "(none)" : undefined), why: JSON.parse(c.match(/^\s+lean_why: (".*")$/m)?.[1] ?? '""') }
}

describe.skipIf(!has)("B4: a hero placed this week keeps their seat, and the four are chosen as the week began", () => {
  test("C90: placed heroes hold their seat and bed at no charge; nobody else is leaned to it, and the four do not move", async () => {
    const { advise } = await import("../src/caretaker/advise.ts")
    const t = await town(await readSave())
    const a = await advise(t)
    // two heroes the Hamlet would relieve in the same place, the later one placed there since the week began
    const rs = a.relief.filter((r) => r.options.length && !a.dismiss.some((d) => d.hero.guid === r.hero.guid))
    const pair = rs.flatMap((r1, i) => rs.slice(i + 1).flatMap((r2) => r1.options.filter((o) => r2.options.some((x) => x.activity.name === o.activity.name)).map((o) => ({ r1, r2, act: o.activity }))))[0]
    const tw = t.activities.find((x) => x.activity === "treatment"), mw = t.activities.find((x) => x.activity === "disease_treatment")
    // a hero of the four placed in the Treatment Ward, an ill hero placed in the Medical Ward
    const treated = a.treat.find((x) => x.inParty) ?? a.treat.at(-1), ill = a.disease.at(-1)
    expect(pair ?? treated ?? ill).toBeDefined()
    const place = new Map<number, string>()
    if (pair) place.set(pair.r2.hero.guid, pair.act.name)
    if (treated && tw && tw.slots > tw.used && !place.has(treated.hero.guid)) place.set(treated.hero.guid, tw.name)
    if (ill && mw && mw.slots > mw.used && !place.has(ill.guid)) place.set(ill.guid, mw.name)
    // the save once they are placed: each place they took is now full
    const real: Town = {
      ...t,
      heroes: t.heroes.map((h) => (place.has(h.guid) ? { ...h, busy: place.get(h.guid)! } : h)),
      activities: t.activities.map((x) => { const n = [...place.values()].filter((p) => p === x.name).length; return n ? { ...x, used: x.used + n, slots: x.used + n } : x }),
    }
    const start = { week: t.week, heroes: t.heroes.map((h) => ({ guid: h.guid, name: h.name, busy: h.busy })), bought: [...t.bought], gold: t.wallet.gold ?? 0 }
    const md = await buildIn(join(root, ".dd-runtime", "test-week-b4"), real, start)
    const four = (await Bun.file(join(root, ".dd-runtime", "test-week-b4", "proposal.json")).json()).party
    const paid = (p: string) => `already there this week, and paid for: the ${p} keeps them.`
    if (pair) {
      const mine = card(md, `Where does ${pair.r2.hero.name} go?`)!, theirs = card(md, `Where does ${pair.r1.hero.name} go?`)!
      expect(mine.lean).toBe(pair.act.name)
      expect(mine.why).toBe(paid(pair.act.name))
      // the seat is the placed hero's: the earlier hero is never leaned into it
      expect(theirs.lean).not.toBe(pair.act.name)
    }
    if (treated && place.get(treated.hero.guid) === tw?.name) {
      const c = card(md, `Treat ${treated.hero.name}'s ${treated.quirk.name}?`)!
      expect(c.lean).toBe(tw!.name)
      expect(c.why).toBe(paid(tw!.name))
      // the ward has no seat left: no other card leans to it
      const others = md.split(/\n- q: /).filter((x) => x.startsWith('"Treat ') && !x.startsWith(`"Treat ${treated.hero.name}'s `))
      for (const o of others) expect(o).not.toMatch(new RegExp(`- pick: "${tw!.name}"[\\s\\S]*\\n  lean: 0\\n`))
    }
    if (ill && place.get(ill.guid) === mw?.name) {
      const c = card(md, `Treat ${ill.name}'s ${ill.quirks.filter((q) => q.disease).map((q) => q.name).join(", ")}?`)!
      expect(c.lean).toBe("Medical Ward")
      expect(c.why).toBe(paid(mw!.name))
    }
    // review 1: a hero of the four who is in a building this week is named on "Take this party?", which then leans No, and the
    // board agrees with itself
    const busyFour = real.heroes.filter((h) => place.has(h.guid) && four.includes(h.guid))
    expect(busyFour.length).toBeGreaterThan(0)
    const party = card(md, md.split(/\n- q: /).find((x) => x.startsWith('"Take this party'))!.match(/^"(.*?)"/)![1]!)!
    expect(party.lean).toBe("No, I choose my own")
    for (const h of busyFour) expect(party.why).toContain(`${h.name} is in the ${h.busy} this week`)
    const { contradictions } = await import("../src/voice/coherence.ts")
    expect(contradictions(md)).toEqual([])
    // C90: the four are the ones the week began with
    await buildIn(join(root, ".dd-runtime", "test-week-b4-start"), t, start)
    expect(four).toEqual((await Bun.file(join(root, ".dd-runtime", "test-week-b4-start", "proposal.json")).json()).party)
  }, 60_000)
})
