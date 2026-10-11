// C78: the upkeep of the four who leave (Soushi, 2026-10-11 06:42: "ensure the heroes that go in expedition are well upgraded
// ... Exceptions: budget for provisions, heroes not worth it (could be dismissed), skills not used that often. This also
// includes survivalism and campaign skills").
import { describe, expect, test } from "bun:test"
import { upkeep, upkeepWords, type UpItem } from "../src/upkeep.ts"

const coin = (n: number) => `${n.toLocaleString("en-US")} gold`
const item = (hero: string, what: string, kind: UpItem["kind"], gold: number, more: Partial<UpItem> = {}): UpItem => ({ hero, what, kind, gold, used: true, ...more })

describe("C78: the four leave trained and armed, from the gold the road leaves free", () => {
  test("healing first, then weapon and armour, then the other skills they carry, then a camping skill, cheapest first within each", () => {
    const items = [item("Azor", "Illumination to level 2", "skill", 225), item("Papon", "Weapon to level 2", "weapon", 750),
      item("Azor", "Divine Grace to level 2", "skill", 300, { heal: true }), item("Papon", "Encourage at the Survivalist", "camp", 1575), item("Papon", "Armour to level 2", "armour", 500)]
    const plan = upkeep(items, 1900, { camps: true })
    expect(plan.lines.map((l) => [l.item.what, l.status])).toEqual([
      ["Divine Grace to level 2", "buy"], ["Weapon to level 2", "buy"], ["Armour to level 2", "buy"], ["Illumination to level 2", "buy"], ["Encourage at the Survivalist", "short"]])
    expect(plan.spent).toBe(1775)
    expect(plan.left).toBe(125)
    expect(plan.lines[4]!.short).toBe(1450)
  })

  test("the three exceptions: the road's reserve, a hero not worth it, a skill not carried; and a camping skill waits for a road that camps", () => {
    const items = [item("Poussin", "Chop to level 2", "skill", 225, { used: false }), item("Gomboult", "Weapon to level 2", "weapon", 100),
      item("Azor", "Sanctuary at the Survivalist", "camp", 100), item("Azor", "Armour to level 2", "armour", 750, { blockedBy: "the Blacksmith's armour, first tier" }), item("Azor", "Weapon to level 2", "weapon", 750)]
    const plan = upkeep(items, 0, { camps: false, dismiss: new Map([["Gomboult", "level 0 and three bad quirks"]]) })
    const by = (what: string) => plan.lines.find((l) => l.item.what === what)!
    expect(by("Chop to level 2").status).toBe("unused")
    expect(by("Weapon to level 2").status).toBe("not-worth")
    expect(by("Sanctuary at the Survivalist").status).toBe("no-camp")
    expect(by("Armour to level 2").status).toBe("waits")
    expect(plan.lines.find((l) => l.item.hero === "Azor" && l.item.kind === "weapon")!).toMatchObject({ status: "short", short: 750 })
    expect(plan.spent).toBe(0)
    expect(upkeepWords(by("Armour to level 2"), coin)).toBe("Armour to level 2 (750 gold) waits on the Blacksmith's armour, first tier")
    expect(upkeepWords(by("Chop to level 2"), coin)).toBe("not Chop to level 2: not a skill they carry from this seat")
    expect(upkeepWords(by("Weapon to level 2"), coin)).toBe("nothing for them: I would rather dismiss them")
  })
})
