// C55: the tale checks itself against the pages before it is told, and the six errors of the Cove trip of 2026-10-11 stay fixed.
// Synthetic pages, so each rule is probed whatever the last trip was.
import { describe, expect, test } from "bun:test"
import { beats, debrief, type Beat, type Snap } from "../src/chronicle.ts"
import { checkTale } from "../src/talecheck.ts"

const hero = (name: string, cls: string, stress = 10, hp = 20, more: object = {}) => ({ guid: name.length * 100 + name.charCodeAt(0), name, cls, hp, maxHp: 20, stress, affliction: "", virtue: "", deathsDoor: false, lastBlow: "", ...more })
function page(over: Partial<Snap> & { stress?: Record<string, number>; hp?: Record<string, number> } = {}): Snap {
  const four = [hero("Wissant", "abomination"), hero("Emory", "grave_robber"), hero("Guernon", "occultist"), hero("Fossard", "houndmaster")]
  for (const h of four) { if (over.stress?.[h.name] != null) h.stress = over.stress[h.name]!; if (over.hp?.[h.name] != null) h.hp = over.hp[h.name]! }
  const { stress, hp, ...rest } = over
  return { at: "", dungeon: "cove", difficulty: 1, length: 1, quest: "cleanse", key: "test:trip", torch: 80, inBattle: false, supplies: { food: 8, shovel: 2 }, tally: {}, heroes: four, ...rest } as Snap
}
const beat = (i: number, kind: Beat["kind"], text: string, who?: string): Beat => ({ i, kind, text, who, bad: false })

describe("C55: the tale checks itself", () => {
  test("a step whose number has the wrong sign is dropped and reported; the right one is told", () => {
    const snaps = [page(), page({ stress: { Wissant: 35 }, tally: { CURIO_INVESTIGATED: 1 } })]
    const wrong = checkTale(snaps, [beat(1, "curio", "they searched an Eerie Coral: Wissant lost 25 stress")])
    expect(wrong.beats).toEqual([])
    expect(wrong.issues.join()).toContain("does not match the pages")
    const right = checkTale(snaps, [beat(1, "curio", "they searched an Eerie Coral: Wissant gained 25 stress")])
    expect(right.beats.length).toBe(1)
    expect(right.issues).toEqual([])
  })

  test("a level the tale names is the level on its page", () => {
    const snaps = [page(), page({ stress: { Guernon: 93 } })]
    expect(checkTale(snaps, [beat(1, "close", "the closest call: Guernon's stress reached 93, and held")]).beats.length).toBe(1)
    expect(checkTale(snaps, [beat(1, "close", "the closest call: Guernon's stress reached 90, and held")]).beats.length).toBe(0)
  })

  test("the counts the tale tells are the road's own: battles, curios, obstacles, meals", () => {
    const snaps = [page(), page({ tally: { BATTLE_COMPLETED: 2, CURIO_INVESTIGATED: 1 }, supplies: { food: 8, shovel: 2 } }), page({ tally: { BATTLE_COMPLETED: 2, CURIO_INVESTIGATED: 1 }, supplies: { food: 4, shovel: 1 } })]
    const short = checkTale(snaps, [beat(1, "battle", "a battle won")])
    expect(short.issues.join(" | ")).toContain("1 battles won, the road counted 2")
    expect(short.issues.join(" | ")).toContain("0 curios searched, the road counted 1")
    expect(short.issues.join(" | ")).toContain("0 obstacles, the road spent 1 shovels")
    expect(short.issues.join(" | ")).toContain("0 meals or hungers, the food fell 1 times")
    const whole = checkTale(snaps, [beat(1, "battle", "2 battles won"), beat(1, "curio", "they searched a curio, and nothing came of it"), beat(2, "obstacle", "they cleared an obstacle with a shovel"), beat(2, "meal", "they ate 4 food")])
    expect(whole.issues).toEqual([])
  })

  test("a hero never stands among the foes", () => {
    const issues = checkTale([page(), page()], [], { foes: [{ name: "Occultist", blows: 0, hp: 0, crits: 0, attacks: {}, victims: {}, blight: 0, bleed: 3 }], beats: [], loot: {}, costs: [] }, ["Occultist"]).issues
    expect(issues).toEqual(["Occultist is one of the four, yet stands among the foes"])
  })

  test("the debrief tells a coral's stress as gained, each shovel, each meal, and a heal's bleed as its cost", async () => {
    const bleeding = (p: Snap) => ({ ...p, heroes: p.heroes.map((h) => (h.name === "Emory" ? { ...h, effects: ["bleed 1 (2) from occultist"] } : h)) })
    const snaps = [
      page(),
      page({ stress: { Wissant: 35 }, tally: { CURIO_INVESTIGATED: 1 } }),
      page({ stress: { Wissant: 35 }, tally: { CURIO_INVESTIGATED: 1 }, supplies: { food: 8, shovel: 1 } }),
      page({ stress: { Wissant: 35 }, tally: { CURIO_INVESTIGATED: 1 }, supplies: { food: 8, shovel: 0 } }),
      page({ stress: { Wissant: 35 }, tally: { CURIO_INVESTIGATED: 1 }, supplies: { food: 4, shovel: 0 } }),
      bleeding(page({ stress: { Wissant: 35 }, tally: { CURIO_INVESTIGATED: 1 }, supplies: { food: 4, shovel: 0 }, inBattle: true })),
      page({ stress: { Wissant: 35 }, hp: { Emory: 19 }, tally: { CURIO_INVESTIGATED: 1 }, supplies: { food: 4, shovel: 0 }, inBattle: true }),
    ]
    const db = await debrief(snaps)
    const said = db.beats.map((b) => b.text)
    expect(said).toContain("they searched a curio: Wissant gained 25 stress")
    expect(said.filter((t) => t === "they cleared an obstacle with a shovel").length).toBe(2)
    expect(said).toContain("they ate 4 food")
    expect(db.foes.map((f) => f.name)).not.toContain("Occultist")
    expect(db.costs).toEqual([{ by: "Guernon", to: "Emory", hp: 1, kind: "bleed" }])
    // and the whole of it checks against the pages
    expect(checkTale(snaps, [...beats(snaps), ...db.beats].sort((x, y) => x.i - y.i), db, ["Occultist"]).issues).toEqual([])
  })
})
