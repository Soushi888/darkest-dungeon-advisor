// C59: the Stage Coach's upgrades are always on the heirlooms' card, with their cost and what is missing, and a young roster
// leans to the seasoned recruits (Soushi, 2026-10-11 04:26: the roster is full of level 1s; the card had no Stage Coach at all).
import { describe, expect, test } from "bun:test"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { advise, RULE } from "../src/advise.ts"
import { profileDir, root } from "../src/paths.ts"
import { readSave } from "../src/read.ts"
import { town } from "../src/town.ts"

let profile = ""
try { profile = profileDir() } catch {}
const has = !!profile && existsSync(profile)
const copy = () => {
  const dir = join(root, ".dd-runtime", "test-coach")
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
  for (const f of readdirSync(profile)) if (f.startsWith("persist.") && f !== "persist.raid.json") cpSync(join(profile, f), join(dir, f))
  const p = join(dir, "persist.game.json"), buf = readFileSync(p), at = buf.indexOf("inraid\0")
  if (at >= 0 && buf[at + 7]) { buf[at + 7] = 0; writeFileSync(p, buf) }
  return dir
}

describe.skipIf(!has)("C59: the Stage Coach on the heirlooms' card", () => {
  test("every coach tree's next upgrade is read with its cost, and a young roster is told by my habit", async () => {
    const t = await town(await readSave(copy()))
    const a = await advise(t)
    expect(a.coach.length).toBeGreaterThan(0)
    for (const u of a.coach) { expect(u.tree.startsWith("stage_coach.")).toBe(true); expect(u.cost.length).toBeGreaterThan(0) }
    const low = t.heroes.filter((h) => h.level <= 1).length
    expect(!!a.young).toBe(low / t.heroes.length >= RULE.youngRoster)
    // with the heirlooms to pay for it, the seasoned recruits become a pick on the card
    const rich = { ...t, wallet: { ...t.wallet, bust: 99, crest: 99, deed: 99, portrait: 99 }, buildingUpgrades: t.buildingUpgrades.map((u) => ({ ...u, affordable: true })) }
    expect((await advise(rich)).heirlooms.some((u) => u.tree === "stage_coach.upgraded_recruits")).toBe(a.coach.some((u) => u.tree === "stage_coach.upgraded_recruits"))
  })

  test("the card names each coach upgrade out of reach with its cost and shortfall, and leans by my habit", async () => {
    const dir = copy(), out = join(root, ".dd-runtime", "test-town")
    const proc = Bun.spawnSync(["bun", "src/cli.ts", "town"], { cwd: root, env: { ...process.env, DD_PROFILE: dir, DD_TOWN_OUT: out } })
    expect(proc.exitCode).toBe(0)
    const md = await Bun.file(join(out, "town.md")).text(), a = await advise(await town(await readSave(dir)))
    const card = md.split(/\n- q: /).find((c) => c.startsWith('"Where do the heirlooms go?"')) ?? ""
    for (const u of a.coach.filter((u) => !u.affordable)) expect(card).toContain(`${u.label.replace(/^[^:]+: /, "")} (${u.cost.map((c) => `${c.amount} ${c.type}s`).join(" and ")};`)
    // C97: the habit holds only for the first tier of seasoned recruits
    if (a.young && a.coach.some((u) => u.tree === "stage_coach.upgraded_recruits" && u.code === "a")) expect(card).toMatch(/lean_why: "my habit: \d+ of your \d+ heroes are level 1 or lower/)
    expect(md).toContain(`the heirlooms go to the Stage Coach's seasoned recruits first | ${Math.round(RULE.youngRoster * 100)}% |`)
    rmSync(dir, { recursive: true, force: true })
  })
})
