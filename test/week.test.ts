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
export async function buildIn(dir: string, t: Town, start: unknown, picks?: unknown): Promise<string> {
  const saved = process.env.DD_TOWN_OUT
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "week-start.json"), JSON.stringify(start))
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
