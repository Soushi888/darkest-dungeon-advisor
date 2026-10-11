// The upkeep of the four who leave (C78): every time a party goes out, the Hamlet takes the chance to train and arm it. One
// plan per hero, the next rank of each skill they will use from their seat, their next weapon and armour, and the camping skill
// most worth learning, paid in an order of my habit from the gold the road leaves free. Soushi, 2026-10-11 06:42: "ensure the
// heroes that go in expedition are well upgraded so we take the opportunity each time to maintain and upgrade the roster.
// Exceptions: budget for provisions, heroes not worth it (could be dismissed), skills not used that often. This also includes
// survivalism and campaign skills."

export interface UpItem {
  hero: string; what: string; kind: "skill" | "weapon" | "armour" | "camp"; gold: number
  heal?: boolean // a skill that heals: the party's way home
  used?: boolean // a skill the hero carries from their seat; one they do not is not worth the gold this week
  blockedBy?: string // in the Hamlet's words: what has to come first
}
export type UpStatus = "buy" | "short" | "waits" | "unused" | "no-camp" | "not-worth"
export interface UpLine { item: UpItem; status: UpStatus; short?: number }

// RULE (my habit): the order the gold goes in. Healing first, because it is what brings everyone home; then the weapon and the
// armour, which count on every blow; then the other skills they use; then a camping skill, only on a road that camps
export const UPKEEP_ORDER: UpItem["kind"][] = ["weapon", "armour", "skill", "camp"]
const rank = (i: UpItem) => (i.kind === "skill" && i.heal ? -1 : UPKEEP_ORDER.indexOf(i.kind))

/** The plan for the four: each item's fate, what it spends of the free gold, and what is left. A hero I would dismiss gets
 *  nothing; a skill they do not carry from their seat waits; a camping skill waits for a road that camps. */
export function upkeep(items: UpItem[], free: number, opts: { camps: boolean; dismiss?: Map<string, string> }): { lines: UpLine[]; spent: number; left: number } {
  let left = Math.max(0, free), spent = 0
  const lines: UpLine[] = []
  const order = [...items].sort((a, b) => rank(a) - rank(b) || a.gold - b.gold)
  for (const item of order) {
    if (opts.dismiss?.has(item.hero)) { lines.push({ item, status: "not-worth" }); continue }
    if (item.blockedBy) { lines.push({ item, status: "waits" }); continue }
    if (item.kind === "skill" && !item.used) { lines.push({ item, status: "unused" }); continue }
    if (item.kind === "camp" && !opts.camps) { lines.push({ item, status: "no-camp" }); continue }
    if (item.gold <= left) { left -= item.gold; spent += item.gold; lines.push({ item, status: "buy" }) }
    else lines.push({ item, status: "short", short: item.gold - left })
  }
  return { lines, spent, left }
}

/** One plan line in the Caretaker's words. */
export function upkeepWords(l: UpLine, coin: (n: number) => string): string {
  const i = l.item, what = `${i.what} (${coin(i.gold)})`
  return {
    buy: `buy ${what}`,
    short: `${what} waits: ${coin(l.short ?? 0)} short once the road and the rest are paid`,
    waits: `${what} waits on ${i.blockedBy}`,
    unused: `not ${i.what}: not a skill they carry from this seat`,
    "no-camp": `${what} waits for a road that camps`,
    "not-worth": `nothing for them: I would rather dismiss them`,
  }[l.status]
}
