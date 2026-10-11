// C67: the training lean follows the skills Soushi prefers (issue #4). A note on the Guild card names them; they are kept
// across weeks, put first on the card and leaned to, said as his choice and not my habit.
import { describe, expect, test } from "bun:test"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { advise } from "../src/advise.ts"
import { readAnswers, source } from "../src/board.ts"
import { profileDir, root } from "../src/paths.ts"
import { readSave } from "../src/read.ts"
import { town } from "../src/town.ts"

let profile = ""
try { profile = profileDir() } catch {}
const has = !!profile && existsSync(profile)
const out = join(root, ".dd-runtime", "test-prefs")
const withOut = async <T>(f: () => Promise<T>) => { const was = process.env.DD_TOWN_OUT; process.env.DD_TOWN_OUT = out; try { return await f() } finally { process.env.DD_TOWN_OUT = was } }

describe("C67: the training lean follows his preferred skills", () => {
  test("a note on the Guild card is read as his preferred skills, and kept for the weeks after", async () => {
    rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true })
    await Bun.write(join(out, "answers.md"), "## Soushi's answers\n\n- **11. What do we train first?** Keep the gold\n  - Note (refines or overrides the pick): Prefer: Pistol Shot, Grapeshot Blast over Open Vein.\n")
    expect((await withOut(readAnswers)).preferred).toEqual(["Pistol Shot", "Grapeshot Blast"])
    // the next week's answers say nothing about the Guild; the preference stays
    await Bun.write(join(out, "answers.md"), "## Soushi's answers\n\n- Left open: 1, 2\n")
    expect((await withOut(readAnswers)).preferred).toEqual(["Pistol Shot", "Grapeshot Blast"])
    // a new note puts its skills first and keeps the rest
    await Bun.write(join(out, "answers.md"), "- **9. What do we train first?** Keep the gold\n  - Note (refines or overrides the pick): Hand of the Light\n")
    expect((await withOut(readAnswers)).preferred).toEqual(["Hand of the Light", "Pistol Shot", "Grapeshot Blast"])
    rmSync(out, { recursive: true, force: true })
  })

  test.skipIf(!has)("a preferred skill the coffers can pay for is on the card and leaned to, as his choice", async () => {
    const dir = join(root, ".dd-runtime", "test-prefs-profile")
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
    for (const f of readdirSync(profile)) if (f.startsWith("persist.") && f !== "persist.raid.json") cpSync(join(profile, f), join(dir, f))
    const p = join(dir, "persist.game.json"), buf = readFileSync(p), at = buf.indexOf("inraid\0")
    if (at >= 0 && buf[at + 7]) { buf[at + 7] = 0; writeFileSync(p, buf) }
    const t = await town(await readSave(dir))
    rmSync(dir, { recursive: true, force: true })
    // a rich estate, so every lesson is within reach, and the dearest Guild lesson is the one he prefers
    t.wallet = { ...t.wallet, gold: 1_000_000 }
    t.heroUpgrades = t.heroUpgrades.map((u) => ({ ...u, affordable: true, blockedBy: "" }))
    // the card offers the advised party's lessons only, so the liked one is the dearest of theirs: a hero of the roster left out
    // of the party (on the road, as Dismas was on 2026-10-11) has no lesson on the card
    const a = await advise(t)
    const lessons = a.buys.filter((u) => u.where === "Guild").sort((x, y) => (y.cost.find((c) => c.type === "gold")?.amount ?? 0) - (x.cost.find((c) => c.type === "gold")?.amount ?? 0))
    if (!lessons.length) return
    const liked = lessons[0]!
    const md = source(t, a, { foresight: false, answers: { preferred: [liked.label] } }).board
    const card = md.split(/\n- q: /).find((c) => c.startsWith('"What do we train first?"'))!
    expect(card).toContain(`The skills you prefer: ${liked.label}.`)
    const picks = [...card.matchAll(/- pick: "([^"]+)"/g)].map((m) => m[1]!), lean = Number(card.match(/\n {2}lean: (\d+)/)![1])
    expect(picks[lean]).toContain(liked.label)
    expect(card).toContain(`you prefer ${liked.label}, so it comes first (your choice, not my habit).`)
    // without a preference, the lean is my habit again
    const plain = source(t, a, { foresight: false, answers: {} }).board.split(/\n- q: /).find((c) => c.startsWith('"What do we train first?"'))!
    expect(plain).not.toContain("your choice")
  })
})
