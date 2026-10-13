// C80: the foes a fight has slain stay in the report (Soushi, 2026-10-11 06:55: "I still want to see the killed foes").
import { describe, expect, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { root } from "../src/sources/paths.ts"
import { fightOf, slainIn, slainLine } from "../src/road/slain.ts"

const hero = (name: string, guid: number, turns: number) => ({ name, guid, turns })
const page = (round: number, foes: [string, number, string?][], heroes: ReturnType<typeof hero>[]) =>
  ({ heroes, battle: { round, foes: foes.map(([name, guid, cls]) => ({ name, guid, cls: cls ?? name.toLowerCase().replace(/ /g, "_"), hp: 5, hitBy: "" })) } }) as any

describe("C80: the slain stay listed", () => {
  test("a foe gone from the fight is slain, in its slot, on its page, by the one hero whose turn came; a corpse cleared is no kill", () => {
    const a = page(2, [["Cultist Brawler", 163], ["Corpse", 170, "corpse_A"], ["Cultist Acolyte", 164]], [hero("Poussin", 1, 1), hero("Papon", 2, 0)])
    const b = page(2, [["Cultist Brawler", 163]], [hero("Poussin", 1, 1), hero("Papon", 2, 1)])
    const s = slainIn([{ page: "0011", snap: a }, { page: "0012", snap: b }])
    expect(s).toEqual([{ name: "Cultist Acolyte", guid: 164, slot: 3, page: "0012", by: "Papon" }])
    expect(slainLine(s)).toBe("SLAIN IN THIS FIGHT: Cultist Acolyte, was at slot 3, fell on page 0012 to Papon")
    // two heroes acted on the page: nobody is named rather than a guess
    const c = page(2, [], [hero("Poussin", 1, 2), hero("Papon", 2, 1)])
    expect(slainIn([{ page: "0011", snap: b }, { page: "0013", snap: c }])[0]).toEqual({ name: "Cultist Brawler", guid: 163, slot: 1, page: "0013", by: "Poussin" })
  })

  test("the fight is read back from its own pages only: a page out of a fight, or a round running backwards, starts another", async () => {
    const dir = join(root, ".dd-runtime", "test-slain"), w = (n: string, x: any) => Bun.write(join(dir, `${n}.json`), JSON.stringify(x))
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
    await w("0001", page(3, [["Old Foe", 9]], [])) // the end of an earlier fight
    await w("0002", { heroes: [] }) // a step out of any fight
    await w("0003", page(1, [["Webber", 20], ["Spitter", 21]], [hero("Azor", 3, 0)]))
    await w("0004", page(1, [["Spitter", 21]], [hero("Azor", 3, 1)]))
    const fight = await fightOf(join(dir, "0004.json"))
    expect(fight.map((x) => x.page)).toEqual(["0003", "0004"])
    expect(slainIn(fight).map((x) => [x.name, x.by])).toEqual([["Webber", "Azor"]])
    rmSync(dir, { recursive: true, force: true })
  })
})
