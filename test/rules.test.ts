// C110: the Caretaker's habits come from one registry (src/caretaker/rules.ts). The board's habits section is drawn from it; every
// key of RULE and CHRONICLE_RULE is either a row there or named on UNSHOWN, so a habit added without a decision fails here.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { RULE, RULE_FOOD, RULE_PROVISION } from "../src/caretaker/advise.ts"
import { CHRONICLE_RULE } from "../src/road/chronicle.ts"
import { cell, HABITS, habitGroups, UNSHOWN } from "../src/caretaker/rules.ts"

const TABLES: Record<string, Record<string, number> | number[]> = { RULE, CHRONICLE_RULE, RULE_FOOD, RULE_PROVISION }

describe("C110: the habits come from one registry", () => {
  test("every entry's source resolves to an existing key, and the row shows what that key holds", () => {
    for (const h of HABITS) {
      const t = TABLES[h.source.table]!
      expect(t, `${h.id}: table ${h.source.table}`).toBeDefined()
      if (Array.isArray(t)) {
        expect(h.source.key).toBeUndefined()
        expect(h.value()).toBe(t.slice(1).join(", "))
      } else {
        expect(h.source.key, `${h.id}: has a key`).toBeDefined()
        expect(Object.keys(t)).toContain(h.source.key!)
        expect(h.id).toBe(h.source.key!)
        const n = t[h.source.key!]!
        expect(typeof n).toBe("number")
        expect(h.value()).toBe(cell(h.fmt as Parameters<typeof cell>[0], n))
      }
    }
  })

  test("the cells are written as the board always wrote them", () => {
    expect(cell("plain", 45)).toBe("45")
    expect(cell("plus", 8)).toBe("+8")
    expect(cell("minus", 2)).toBe("−2")
    expect(cell("percent", 0.6)).toBe("60%")
    expect(cell("gold", 1500)).toBe("1,500 gold")
    // a cell follows its constant: no number is held in the registry
    const before = RULE.restAbove
    try { (RULE as { restAbove: number }).restAbove = before + 7; expect(HABITS.find((h) => h.id === "restAbove")!.value()).toBe(`${before + 7}`) }
    finally { (RULE as { restAbove: number }).restAbove = before }
  })

  test("registry ids plus UNSHOWN cover every key of RULE and CHRONICLE_RULE exactly", () => {
    const keys = [...Object.keys(RULE), ...Object.keys(CHRONICLE_RULE)].sort()
    const shown = HABITS.filter((h) => h.source.key !== undefined).map((h) => h.id)
    expect([...shown, ...UNSHOWN].sort()).toEqual(keys)
    expect(new Set(HABITS.map((h) => h.id)).size).toBe(HABITS.length)
    for (const k of UNSHOWN) expect(shown).not.toContain(k)
  })

  test("the groups come in registry order, each heading once", () => {
    const g = habitGroups()
    expect(g.map(([n]) => n)).toEqual(["Rest and sending", "Choosing the road", "Seating the four", "On the road", "Learning from the road", "At the Survivalist"])
    expect(g.flatMap(([, hs]) => hs)).toEqual(HABITS)
  })

  test("the board draws its habits section from the registry", () => {
    const src = readFileSync(new URL("../src/voice/board.ts", import.meta.url), "utf8")
    expect(src).toContain("habitGroups()")
    expect(src).not.toContain('H("Rest and sending"')
  })
})
