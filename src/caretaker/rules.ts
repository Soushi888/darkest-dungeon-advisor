// C110: the Caretaker's habits come from one registry. Each row of the board's "The Caretaker's habits" section is an entry here,
// in the board's order, and reads its number from the constant that holds it (RULE, RULE_FOOD, RULE_PROVISION in advise.ts,
// CHRONICLE_RULE in chronicle.ts); no number is copied. UNSHOWN names the keys of RULE and CHRONICLE_RULE that no row shows yet,
// so a habit added to those objects without a decision (a row, or a place on that list) fails test/rules.test.ts.
import { RULE, RULE_FOOD, RULE_PROVISION } from "./advise.ts"
import { CHRONICLE_RULE } from "../road/chronicle.ts"

const TABLES = { RULE, CHRONICLE_RULE }
type Scalar = keyof typeof TABLES
type Arrays = { RULE_FOOD: number[]; RULE_PROVISION: number[] }
const ARRAYS: Arrays = { RULE_FOOD, RULE_PROVISION }

/** How a number is written in its cell. */
export type Fmt = "plain" | "plus" | "minus" | "percent" | "gold"

/** Where a habit's number is read: a key of RULE or CHRONICLE_RULE, or a whole array (RULE_FOOD, RULE_PROVISION). */
export type Source = { table: Scalar; key: string } | { table: keyof Arrays; key?: undefined }

export interface Habit {
  /** The RULE or CHRONICLE_RULE key, or a clear name for the rows that read an array. */
  id: string
  /** The board's group heading. */
  group: string
  /** The row's words. */
  words: string
  source: Source
  fmt: Fmt | "steps"
  /** The cell text, read from the constant at call time. */
  value: () => string
}

// the board's gold writing (the same as board.ts's own `coin`, which cannot be imported without a cycle)
const coin = (n: number) => `${n.toLocaleString("en-US")} gold`

/** The one place a number becomes a cell. */
export function cell(fmt: Fmt, n: number): string {
  switch (fmt) {
    case "plain": return `${n}`
    case "plus": return `+${n}`
    case "minus": return `−${n}`
    case "percent": return `${Math.round(n * 100)}%`
    case "gold": return coin(n)
  }
}

function row<T extends Scalar>(group: string, words: string, table: T, key: keyof (typeof TABLES)[T] & string, fmt: Fmt = "plain"): Habit {
  return { id: key, group, words, source: { table, key }, fmt, value: () => cell(fmt, TABLES[table][key] as number) }
}
// the road's torches and food by length (index 0 is no road): short, medium and long
function steps(group: string, id: string, words: string, table: keyof Arrays): Habit {
  return { id, group, words, source: { table }, fmt: "steps", value: () => ARRAYS[table].slice(1).join(", ") }
}

const REST = "Rest and sending", ROAD = "Choosing the road", SEATS = "Seating the four", ON = "On the road", LEARN = "Learning from the road", CAMP = "At the Survivalist"

export const HABITS: Habit[] = [
  row(REST, "A hero at this much stress or more rests before going out again", "RULE", "restAbove"),
  row(REST, "I only send heroes under this much stress", "RULE", "sendBelow"),
  row(REST, "A level 0 hero with this many bad quirks is one I would let go", "RULE", "dismissNegatives"),
  row(REST, "When this share of the roster is level 1 or lower, the heirlooms go to the Stage Coach's seasoned recruits first", "RULE", "youngRoster", "percent"),
  row(REST, "A heal restoring this many hit points a cast, at its first level, makes a healer; less is no heal at all", "RULE", "realHeal"),

  row(ROAD, "When this many of the four are level 0, a longer road counts against itself", "RULE", "greenParty"),
  row(ROAD, "How much it counts, for each step beyond a short road", "RULE", "greenPerStep"),
  row(ROAD, "Every this much gold the road leaves in the coffers counts one point", "RULE", "goldPerPoint", "gold"),
  row(ROAD, "Up to this many points for gold left", "RULE", "goldCap"),
  row(ROAD, "A road the coffers cannot provision counts this much against itself", "RULE", "brokeRoad"),

  row(SEATS, "A true healer in the four", "RULE", "healerWorth", "plus"),
  row(SEATS, "A stun in the four", "RULE", "stunWorth", "plus"),
  row(SEATS, "Two of the same calling in the four", "RULE", "sameClass", "minus"),
  row(SEATS, "Each level of a hero", "RULE", "levelWorth", "plus"),
  row(SEATS, "Each point of stress a hero carries", "RULE", "stressWeight", "minus"),
  row(SEATS, "Each enemy rank the four can strike from their seats", "RULE", "reachPerRank", "plus"),
  row(SEATS, "Each neighbouring rank a hero can still strike from, if knocked out of their seat", "RULE", "shufflePerSide", "plus"),
  row(SEATS, "A skill that moves its user back into their seat", "RULE", "moveWorth", "plus"),
  row(SEATS, "A mark carried with a hand that strikes the marked harder", "RULE", "markPair", "plus"),
  row(SEATS, "A bleed or blight, times the share of the road's known foes that fail to resist it", "RULE", "dotWorth", "plus"),
  row(SEATS, "Each hit point above the four's average at the front (rank 1 twice, rank 2 once, rank 3 once against, rank 4 twice against)", "RULE", "frontHp"),
  row(SEATS, "A true healer's extra weight on a road where healing failed before", "RULE", "lessonHeal", "plus"),

  steps(ON, "torches", "Torches for a short, medium and long road", "RULE_FOOD"),
  steps(ON, "food", "Food for a short, medium and long road, in full slots of 12", "RULE_PROVISION"),
  row(ON, "When this many of the four have broken, I bring them home", "RULE", "turnBackBroken"),
  row(ON, "Below this light I count them as walking in the dark", "CHRONICLE_RULE", "darkTorch"),
  row(ON, "This much stress between two pages is a blow worth telling", "CHRONICLE_RULE", "stressSpike"),
  row(ON, "This share of a hero's health lost or regained between two pages is a wound or a mending worth telling", "CHRONICLE_RULE", "woundShare", "percent"),

  row(LEARN, "Torches a lesson about the dark adds on its dungeon", "CHRONICLE_RULE", "lessonTorches", "plus"),
  row(LEARN, "Food a lesson about hunger adds on its dungeon", "CHRONICLE_RULE", "lessonFood", "plus"),
  row(LEARN, "One more torch and food on a road harder than any yet", "CHRONICLE_RULE", "untriedMargin", "plus"),

  row(CAMP, "Each point of stress a camping skill relieves, times how many it reaches", "RULE", "campStress"),
  row(CAMP, "A camping heal, per whole health bar, times how many it reaches", "RULE", "campHealth"),
  row(CAMP, "A cure at camp (bleeding, blight, disease)", "RULE", "campCure"),
  row(CAMP, "A guard on the camp against a night ambush", "RULE", "campGuard"),
  row(CAMP, "A boon until the next fight", "RULE", "campBoon"),
]

/** Keys of RULE and CHRONICLE_RULE that no row of the board shows today. Showing one is a separate decision: move it into HABITS
 *  with its row; adding a key to either object without doing one or the other fails test/rules.test.ts. */
export const UNSHOWN: string[] = [
  "levelUnder", "packFree", "learnHealMin", "learners", "settleWeeks", "noHealerPerStep", "lightHealWorth",
  "closeCall", "lowLeft",
]

/** The habits grouped as the board shows them: groups and rows in registry order. */
export function habitGroups(): [string, Habit[]][] {
  const out: [string, Habit[]][] = []
  for (const h of HABITS) {
    const g = out.find(([name]) => name === h.group)
    if (g) g[1].push(h)
    else out.push([h.group, [h]])
  }
  return out
}
