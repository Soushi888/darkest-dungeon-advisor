// C58: a relief card never leans to a seat the game will not give. The Caretaker's own seat counts as taken, and two cards
// never lean to the same last seat (Soushi, 2026-10-11 04:29: the Gambling Hall seat the board leaned to was "taken by the caretaker").
import { describe, expect, test } from "bun:test"
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { profileDir, root } from "../src/paths.ts"
import { readSave } from "../src/read.ts"
import { town } from "../src/town.ts"

let profile = ""
try { profile = profileDir() } catch {}
const has = !!profile && existsSync(profile)

describe.skipIf(!has)("C58: seats as the game gives them", () => {
  test("a seat the Caretaker holds is not free", async () => {
    const save = (await readSave()) as any
    const slots = save.town.buildings.tavern.activities.brothel
    for (const s of Object.values<any>(slots)) { s.hero = 0; s.resident_occupied = -1 }
    const before = (await town(save)).activities.find((a) => a.activity === "brothel")!
    ;(Object.values<any>(slots)[0]).resident_occupied = 0
    const after = (await town(save)).activities.find((a) => a.activity === "brothel")!
    expect(after.used).toBe(before.used + 1)
    expect(after.caretaker).toBe(1)
  })

  test("no place is leaned to by more cards than it has free seats", async () => {
    const out = join(root, ".dd-runtime", "test-town"), dir = join(root, ".dd-runtime", "test-seats")
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
    for (const f of readdirSync(profile)) if (f.startsWith("persist.") && f !== "persist.raid.json") cpSync(join(profile, f), join(dir, f))
    const proc = Bun.spawnSync(["bun", "src/cli.ts", "town"], { cwd: root, env: { ...process.env, DD_PROFILE: dir, DD_TOWN_OUT: out } })
    if (proc.exitCode !== 0) return // a save made in a dungeon writes no town board (C8)
    const md = await Bun.file(join(out, "town.md")).text(), t = await town(await readSave(dir))
    const leaned = new Map<string, number>()
    for (const card of md.split(/\n- q: /).filter((c) => /^"Where does .+ go\?"/.test(c))) {
      const picks = [...card.matchAll(/- pick: "([^"]+)"/g)].map((m) => m[1]!), lean = Number(card.match(/\n {2}lean: (\d+)/)?.[1] ?? -1)
      const place = picks[lean]
      if (place && place !== "Leave them be") leaned.set(place, (leaned.get(place) ?? 0) + 1)
    }
    for (const [place, n] of leaned) {
      const a = t.activities.find((x) => x.name === place)!
      expect(n).toBeLessThanOrEqual(a.slots - a.used)
    }
    rmSync(dir, { recursive: true, force: true })
  })
})
