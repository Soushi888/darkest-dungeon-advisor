// C66: the Caretaker's recap is built from the page itself and shown as the road zone's report, beside the conversation.
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { root } from "../src/sources/paths.ts"
import { buildRecap } from "../src/road/recap.ts"
import { feed, roadPanel } from "../src/road.ts"

const hero = (name: string, guid: number, hp: number, stress: number, more: object = {}) => ({ guid, name, cls: "leper", hp, maxHp: 35, stress, affliction: "", virtue: "", deathsDoor: false, lastBlow: "", ...more })
const page = { at: "", dungeon: "warrens", difficulty: 1, length: 1, quest: "explore", key: "k", torch: 79, inBattle: false, tally: { ROOM_VISITED: 8, BATTLE_COMPLETED: 3 },
  supplies: { food: 4, torch: 6, holy_water: 1, gold: 1375, portrait: 3, journal_page_13: 1, vengeful_greaves: 1, no_such_thing: 1 }, heroes: [hero("Poussin", 1, 35.4, 50), hero("Burci", 2, 22, 56, { affliction: "Paranoid" }), hero("Azor", 3, 20, 16)] }

describe("C66: the recap, built from the page, shown as the report", () => {
  test("every number comes from the page: the tally, the four, the light, the provisions before the loot", async () => {
    const out = join(root, ".dd-runtime", "test-recap")
    rmSync(out, { recursive: true, force: true })
    const r = await buildRecap(page as any, { raid: { party: { start_heroes_size: 4 } } }, "0115", Date.now(), { advice: "Light a torch.", since: "Two battles won." }, out)
    expect(r.tally).toEqual({ rooms: 8, battles: 3, lost: 1 })
    expect(r.four.map((h) => [h.rank, h.name, h.hp, h.stress])).toEqual([[1, "Poussin", 35, 50], [2, "Burci", 22, 56], [3, "Azor", 20, 16]])
    expect(r.four[1]!.tags).toEqual(["Paranoid"])
    expect(r.packs.light).toBe(79)
    const kinds = r.packs.items.map((x) => x.kind)
    expect(kinds.lastIndexOf("provision")).toBeLessThan(kinds.indexOf("loot"))
    expect(r.packs.items.slice(0, 2).map((x) => x.key)).toEqual(["food", "torch"])
    // the install's own icons, copied beside the page; an item with none keeps its word
    const food = r.packs.items.find((x) => x.key === "food")!
    expect(food.icon).toBe("img/items/food.png")
    expect(existsSync(join(out, "img", "items", "food.png"))).toBe(true)
    // journal pages and trinkets carry their own icons too (pm#27); only what the install has no picture for keeps its word
    expect(r.packs.items.find((x) => x.key === "journal_page_13")!.icon).toBe("img/items/journal_page_13.png")
    // a journal page goes by the game's own title and is a page of the story, never loot (pm, 2026-10-11)
    expect(r.packs.items.find((x) => x.key === "journal_page_13")).toMatchObject({ label: "A Trampled Journal (2/4)", kind: "page" })
    expect(r.packs.items.at(-1)!.kind).toBe("page")
    expect(r.packs.items.find((x) => x.key === "vengeful_greaves")!.icon).toBe("img/items/vengeful_greaves.png")
    expect(r.packs.items.find((x) => x.key === "no_such_thing")!.icon).toBeUndefined()
    expect(r).toMatchObject({ page: "0115", advice: "Light a torch.", since: "Two battles won." })
    rmSync(out, { recursive: true, force: true })
  })

  test("say --recap stores the recap on the line, and the latest is the report while older ones fold into the conversation", async () => {
    const out = join(root, ".dd-runtime", "test-recap-say"), trip = join(out, "chronicle", "generated_1_t")
    rmSync(out, { recursive: true, force: true }); mkdirSync(trip, { recursive: true })
    await Bun.write(join(trip, "0115.json"), JSON.stringify(page))
    const run = (args: string[]) => Bun.spawnSync(["bun", "src/road.ts", "say", ...args], { cwd: root, env: { ...process.env, DD_TOWN_OUT: out } })
    expect(run(["--recap", "--page", "115", "--words", "Light a torch."]).exitCode).toBe(0)
    expect(run(["--recap", "--page", "115"]).exitCode).toBe(1) // no advice, no recap
    const was = process.env.DD_TOWN_OUT
    process.env.DD_TOWN_OUT = out
    const line = (await feed()).lines.at(-1)!
    process.env.DD_TOWN_OUT = was
    rmSync(out, { recursive: true, force: true })
    expect(line.recap).toMatchObject({ page: "0115", tally: { rooms: 8, battles: 3 }, advice: "Light a torch." })
    expect(line.text).toBe("Light a torch.") // his words alone; the card carries the page and the tally
    // the report (card, foes, map) beside the conversation (form, busy line, thread); one column on a phone
    for (const id of ['id="roadReport"', 'id="roadCard"', 'id="roadFoes"', 'id="roadMap"', 'id="roadTalk"', 'id="roadThread"']) expect(roadPanel).toContain(id)
    expect(roadPanel).toMatch(/@media \(max-width:900px\)\{#road \.roadgrid\{grid-template-columns:minmax\(0,1fr\)\}\}/)
    expect(roadPanel).toContain("filter(l=>l!==latest)")
    expect(roadPanel).toContain('<details class="msg caretaker">')
    // the card carries the numbers as bars, icons and the map, and his words as plain paragraphs: no section headings (pm#26)
    expect(roadPanel).not.toMatch(/<h[1-6] |class="rt"/)
    // the script the page runs parses, so an escape lost in the template cannot reach the board
    expect(() => new Function(roadPanel.slice(roadPanel.indexOf("<script>") + 8, roadPanel.lastIndexOf("</script>")))).not.toThrow()
    expect(roadPanel).toContain("split(/\\n\\s*\\n/)")
  })
})

describe("journal pages: their own title, no value", () => {
  test("the page the Caretaker reads lists journal pages apart from the supplies, as pages of the story worth no gold", async () => {
    const { nowText } = await import("../src/now.ts")
    const text = await nowText({ ...page, supplies: { food: 4, "journal page 13": 1, "journal page 99999": 1 } } as any, undefined, "0115", Date.now())
    expect(text).toMatch(/^SUPPLIES food 4; light 79$/m)
    expect(text).toContain("JOURNAL PAGES (pages of the estate's story, worth no gold) A Trampled Journal (2/4); Journal Page")
  })
})
