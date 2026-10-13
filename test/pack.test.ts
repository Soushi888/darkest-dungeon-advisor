// C79: the pack's slots (Soushi, 2026-10-11 06:48: "There is only 6 remaining places. It is to take into consideration").
import { describe, expect, test } from "bun:test"
import { dropFirst, packRules, slotsOf, trims } from "../src/pack.ts"

describe("C79: the pack has room, or I say what to leave", () => {
  test("the slots and the stacks come from the game's files", async () => {
    const r = await packRules()
    expect(r.slots).toBe(16)
    expect([r.stack.get("food"), r.stack.get("torch"), r.stack.get("bandage"), r.stack.get("firewood"), r.stack.get("emerald"), r.stack.get("gold"), r.stack.get("crest")]).toEqual([12, 8, 6, 1, 5, 1750, 12])
    expect(r.value.get("emerald")).toBe(750)
  })

  test("the farewell's packs as he left on 2026-10-11: 10 slots used, 6 free", async () => {
    const r = await packRules()
    const left = { firewood: 1, medicinal_herbs: 1, dog_treats: 2, food: 14, torch: 14, shovel: 2, bandage: 3, antivenom: 3 }
    expect(slotsOf(left, r)).toBe(10)
    expect(r.slots - slotsOf(left, r)).toBe(6)
  })

  test("to free a slot, a small last stack is given back first; when full, the loot worth least a slot is left first", async () => {
    const r = await packRules()
    expect(trims({ food: 14, torch: 16, shovel: 3 }, r)).toEqual([{ key: "food", n: 2 }])
    expect(dropFirst({ food: 14, crest: 5, citrine: 3, ruby: 1, gold: 1750, "journal page 13": 1 }, r).map((d) => [d.key, d.perSlot])).toEqual([["citrine", 750], ["ruby", 1250], ["gold", 1750]])
  })

  test("C95: once the quest is done, supplies go before loot, heirlooms never, and a purse gives only its last stack", async () => {
    const r = await packRules()
    const pack = { shovel: 2, holy_water: 1, crest: 16, jade: 4, gold: 2650 }
    const before = dropFirst(pack, r).map((d) => d.key)
    expect(before).not.toContain("shovel")
    const after = dropFirst(pack, r, true)
    const firstLoot = after.findIndex((d) => d.perSlot > 0)
    expect(after[0]!.key).toBe("shovel")
    expect(after.slice(firstLoot).every((d) => d.perSlot > 0)).toBe(true)
    expect(after.map((d) => d.key)).not.toContain("crest")
    const gold = after.find((d) => d.key === "gold")!
    expect(gold.n).toBe(2650 % (r.stack.get("gold") ?? 1) || 2650)
    expect(gold.n).toBeLessThan(2650)
  })
})
