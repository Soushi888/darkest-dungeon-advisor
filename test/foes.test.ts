// C60: the tale names the foes slain in each battle won, and tells a heavy wound and a mending (#12). Synthetic pages and
// their raw records, written under .dd-runtime for the test only, never read from the live chronicle.
import { describe, expect, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { beats, CHRONICLE_RULE, debrief, snapshot, type Snap } from "../src/chronicle.ts"
import { root } from "../src/paths.ts"
import { checkTale } from "../src/talecheck.ts"

const hero = (name: string, hp: number) => ({ guid: name.length * 7 + name.charCodeAt(0), name, cls: "crusader", hp, maxHp: 20, stress: 10, affliction: "", virtue: "", deathsDoor: false, lastBlow: "" })
const page = (hp: number, tally: Record<string, number>, inBattle = false): Snap => ({ at: "", dungeon: "cove", difficulty: 1, length: 1, quest: "cleanse", key: "test:foes", torch: 80, inBattle, supplies: {}, tally, heroes: [hero("Reynauld", hp), hero("Dismas", 20)] } as Snap)
const raw = (defeated: string[][]) => ({ raid: { stat_database: { MONSTER_DEFEATED: { entries: Object.fromEntries(defeated.map((d, i) => [i, { parameters: { 0: { data: d[0] }, 1: { data: d[1] } } }])) } } } })

describe("C60: foes slain, wounds and mendings in the tale", () => {
  test("a battle won names the foes slain, counts the same kind together, and leaves the corpses out", async () => {
    const was = process.env.DD_TOWN_OUT, out = join(root, ".dd-runtime", "test-foes")
    process.env.DD_TOWN_OUT = out
    const dir = join(out, "chronicle", "test_foes")
    rmSync(out, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
    const killed = [["fishman_harpoon", "fishman_harpoon_A"], ["fishman_harpoon", "fishman_harpoon_A"], ["corpse", "corpse_A"], ["cultist_witch", "cultist_witch_A"]]
    const snaps = [page(20, {}), page(20, { MONSTER_DEFEATED: 3 }, true), page(20, { MONSTER_DEFEATED: 4, BATTLE_COMPLETED: 1 })]
    await Bun.write(join(dir, "0000.raw.json"), JSON.stringify(raw([])))
    await Bun.write(join(dir, "0001.raw.json"), JSON.stringify(raw(killed.slice(0, 3))))
    await Bun.write(join(dir, "0002.raw.json"), JSON.stringify(raw(killed)))
    const db = await debrief(snaps)
    process.env.DD_TOWN_OUT = was
    rmSync(out, { recursive: true, force: true })
    const battle = db.beats.find((b) => b.kind === "battle")!
    expect(battle.i).toBe(2)
    expect(battle.text).toMatch(/^a battle won against 2 \S.+s and an? \S.+$/)
    expect(battle.text).not.toMatch(/corpse/i)
    expect(checkTale(snaps, [battle], db).issues).toEqual([])
  })

  test("a share of the bar lost or regained between two pages is told, with its numbers checked against the pages", () => {
    const share = Math.ceil(CHRONICLE_RULE.woundShare * 20)
    const snaps = [page(20, {}), page(20 - share, {}, true), page(20, {})]
    const said = beats(snaps).filter((b) => b.kind === "wound" || b.kind === "mend")
    expect(said.map((b) => b.text)).toEqual([`Reynauld took a heavy wound: health fell from 20 to ${20 - share}`, `Reynauld was mended: health rose from ${20 - share} to 20`])
    expect(checkTale(snaps, said).beats.length).toBe(2)
    // a step that misreads the numbers is dropped
    expect(checkTale(snaps, [{ ...said[0]!, text: "Reynauld took a heavy wound: health fell from 20 to 3" }]).beats.length).toBe(0)
    // less than the share is not told
    expect(beats([page(20, {}), page(20 - share + 1, {})]).some((b) => b.kind === "wound")).toBe(false)
  })

  test("a bleed a curio laid is told from the curio, never from the hero it cut (pm#18)", async () => {
    const curio = { entries: { 0: { parameters: { 0: { data: "knife_rack" } } } } }
    const heroRec = { heroClass: "vestal", actor: { name: "Azor", current_hp: 20, buff_group: { 0: { id: "", stat_type: 5, amount: 2, duration: 3, source_class_id: "vestal" } } }, m_Stress: 0 }
    const save: any = { game: { inraid: true }, raid: { raid_instance: { dungeon: "warrens", id: "t" }, inbattle: false, party: { heroes: [7] }, stat_database: { CURIO_INVESTIGATED: curio } }, roster: { heroes: { 7: heroRec } }, narration: { raid_entry_log: {} }, game_knowledge: {} }
    const s = await snapshot(save)
    expect(s!.heroes[0]!.effects![0]).toMatch(/^bleed 2 \(3\) from the \S/)
    expect(s!.heroes[0]!.effects![0]).not.toContain("vestal")
    // a trap the narrator just spoke of is named as a trap
    save.narration.raid_entry_log = { 0: { entry_type: "trap" } }
    expect((await snapshot(save))!.heroes[0]!.effects![0]).toBe("bleed 2 (3) from a trap")
    // in a fight there is no curio to name, and the hero is still never named as its source
    save.raid.inbattle = true
    expect((await snapshot(save))!.heroes[0]!.effects![0]).toBe("bleed 2 (3)")
  })
})
