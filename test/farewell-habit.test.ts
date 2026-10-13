// U33 (C24, C42): the farewell weighs the packs by the same habit the provisions table set, lessons learnt included. On
// 2026-10-11 it read "Food: 14 carried, 12 by my habit" while the Hamlet's table had said 14, "+2: the food ran out".
import { describe, expect, test } from "bun:test"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { RULE_FOOD, RULE_PROVISION } from "../src/advise.ts"
import { buildFarewell } from "../src/board.ts"
import { CHRONICLE_RULE } from "../src/chronicle.ts"
import { profileDir, root } from "../src/paths.ts"
import { readSave } from "../src/read.ts"
import { town } from "../src/town.ts"

let profile = ""
try { profile = profileDir() } catch {}
const has = !!profile && existsSync(profile)

describe.skipIf(!has)("U33: the farewell's habit counts what was learnt", () => {
  test("a hunger lesson on the road's dungeon raises the farewell's food, and says so", async () => {
    const dir = join(root, ".dd-runtime", "test-farewell-habit"), out = join(dir, "town"), prof = join(dir, "profile")
    rmSync(dir, { recursive: true, force: true }); mkdirSync(prof, { recursive: true }); mkdirSync(out, { recursive: true })
    for (const f of readdirSync(profile)) if (f.startsWith("persist.") && f !== "persist.raid.json") cpSync(join(profile, f), join(prof, f))
    const g = join(prof, "persist.game.json"), buf = readFileSync(g), at = buf.indexOf("inraid\0")
    if (at >= 0 && buf[at + 7]) { buf[at + 7] = 0; writeFileSync(g, buf) }
    const t = await town(await readSave(prof))
    // a road as if they had just left on the week's first quest, packed by the plain habit
    const q = t.quests.find((x) => !x.plot)!, len = Math.max(1, Math.min(3, q.length))
    t.raid = { key: "test", quest: q, party: t.heroes.slice(0, 4).map((h) => h.guid), carried: { provision: RULE_PROVISION[len]!, torch: RULE_FOOD[len]! } }
    writeFileSync(join(out, "lessons.json"), JSON.stringify([{ dungeon: q.dungeon, difficulty: q.difficulty, length: q.length, week: 1, trip: "a test road", kind: "food", text: "they went hungry" }]))
    const was = process.env.DD_TOWN_OUT
    process.env.DD_TOWN_OUT = out
    try { await buildFarewell(t) } finally { process.env.DD_TOWN_OUT = was }
    const md = readFileSync(join(out, "town.md"), "utf8")
    const want = RULE_PROVISION[len]! + CHRONICLE_RULE.lessonFood
    expect(md).toContain(`Food: ${RULE_PROVISION[len]} carried, ${want} by my habit`)
    expect(md).toContain(`What I learnt: +${CHRONICLE_RULE.lessonFood}: the food ran out (a test road)`)
    rmSync(dir, { recursive: true, force: true })
  })
})
