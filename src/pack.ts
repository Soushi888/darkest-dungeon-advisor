// The pack (C79): a party carries a fixed number of slots, and each slot holds a stack up to the item's own limit, both from the
// game's files (`inventory/base.inventory.system_configs.darkest`, `.type "raid" .max_slots`; each item's `.base_stack_limit`
// and `.sell_gold_value`). Soushi, 2026-10-11 06:48, on the farewell's packs: "There is only 6 remaining places. It is to take
// into consideration."
import { P, text } from "./game.ts"

export interface PackRules { slots: number; stack: Map<string, number>; value: Map<string, number>; quest: Set<string> }

// the chronicle's keys: food for the provision, gold for the coin, the id for the rest
const keyOf = (type: string, id: string) => (type === "provision" ? "food" : type === "gold" ? "gold" : id || type)

let rules: PackRules | undefined
export async function packRules(): Promise<PackRules> {
  if (rules) return rules
  const slots = Number((await text(P.inventoryConfigs)).match(/\.type\s+"raid"\s+\.max_slots\s+(\d+)/)?.[1] ?? 0)
  const stack = new Map<string, number>(), value = new Map<string, number>(), quest = new Set<string>()
  for (const f of P.inventoryItems) {
    for (const m of (await text(f)).matchAll(/\.type\s+"(\w+)"\s+\.id\s+"(\w*)"\s+\.base_stack_limit\s+(\d+)[^\n]*?\.sell_gold_value\s+(\d+)/g)) {
      const k = keyOf(m[1]!, m[2]!)
      if (m[1] === "quest_item") quest.add(k)
      // the supply comes first, so a quest item sharing its id (holy water, antivenom) does not change its stack
      if (stack.has(k)) continue
      stack.set(k, Number(m[3])); value.set(k, Number(m[4]))
    }
  }
  return (rules = { slots, stack, value, quest })
}

/** The slots these items take: each kind fills its stacks to its limit, and a kind the files do not list takes a slot each. */
export function slotsOf(items: Record<string, number>, r: PackRules): number {
  return Object.entries(items).filter(([, n]) => n > 0).reduce((t, [k, n]) => t + Math.ceil(n / (r.stack.get(k) ?? 1)), 0)
}

// what keeps them alive and what the estate builds with; never offered to the floor for a gem
const KEEP = new Set(["food", "torch", "shovel", "bandage", "antivenom", "medicinal_herbs", "holy_water", "laudanum", "skeleton_key", "dog_treats", "firewood", "crest", "bust", "portrait", "deed"])

/** When the pack is full: the loot to leave behind first, the least gold per slot first, from the files' sell values. */
export function dropFirst(items: Record<string, number>, r: PackRules): { key: string; n: number; worth: number; perSlot: number }[] {
  // a quest item is what the road is for: never left behind (U39: the medicines of Stave off Sickness were offered at 0 gold)
  return Object.entries(items).filter(([k, n]) => n > 0 && !KEEP.has(k) && !r.quest.has(k) && !/^journal/.test(k))
    .map(([key, n]) => { const worth = key === "gold" ? n : n * (r.value.get(key) ?? 0), slots = Math.ceil(n / (r.stack.get(key) ?? 1)); return { key, n, worth, perSlot: Math.round(worth / slots) } })
    .sort((a, b) => a.perSlot - b.perSlot)
}

/** The Hamlet's own keys (the Provisioner's "provision") in the pack's: food. */
export const asPack = (items: Record<string, number>) => Object.fromEntries(Object.entries(items).map(([k, n]) => [k === "provision" ? "food" : k, n]))

/** What to give back to keep a slot free: an item whose last stack is small, the smallest first ("2 food frees a slot"). */
export function trims(items: Record<string, number>, r: PackRules): { key: string; n: number }[] {
  return Object.entries(items).map(([key, n]) => ({ key, n: n % (r.stack.get(key) ?? 1) })).filter((x) => x.n > 0 && x.n <= (r.stack.get(x.key) ?? 1) / 2).sort((a, b) => a.n - b.n)
}
