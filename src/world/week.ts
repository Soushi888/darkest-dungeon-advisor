// The week as the save shows it and the week as it began (C26, C90, C92): the Hamlet as the week found it, kept on the week's
// first board, and what can be derived from it without judgement: who joined, who was placed since, and the view of the Hamlet
// the four are chosen on. The habits that read these (who settles, who is charged nothing) are the Caretaker's, in caretaker/.
import type { Town } from "./town.ts"

/** The Hamlet as the week found it, kept on the first board of each week, so later boards can say what was done since (C26). */
export interface WeekStart { week: number; heroes: { guid: number; name: string; busy?: string }[]; bought: string[]; gold: number | null; purchases?: string[] }

/** The record a week's first board keeps. */
export function weekStartOf(t: Town): WeekStart {
  return { week: t.week, heroes: t.heroes.map((h) => ({ guid: h.guid, name: h.name, busy: h.busy })), bought: [...t.bought], gold: t.wallet.gold ?? 0, purchases: t.purchases.map((p) => `${p.guid}|${p.key}`) }
}

/** C92: the roster ledger, the week each hero joined. */
export interface RosterLedger { joined: Record<string, number> }

/** C92: the roster ledger, kept across weeks so a recruit is not let go while they settle. A hero first seen this week who was not
 *  on the roster when the week began joined this week; anyone else first seen counts as long settled. */
export function rosterLedger(prev: RosterLedger | undefined, t: Town, start: WeekStart | undefined): RosterLedger {
  const joined = { ...(prev?.joined ?? {}) }
  const atStart = start && start.week === t.week ? new Set(start.heroes.map((h) => h.guid)) : undefined
  for (const h of t.heroes) if (!(String(h.guid) in joined)) joined[String(h.guid)] = atStart && !atStart.has(h.guid) ? t.week : 0
  return { joined }
}

/** C90: the heroes placed in a building since the week began, and where (decision 34). */
export function placedThisWeek(t: Town, start: WeekStart | undefined): Map<number, string> {
  return new Map(t.heroes.filter((h) => h.busy && start?.week === t.week && start.heroes.some((x) => x.guid === h.guid && !x.busy)).map((h) => [h.guid, h.busy] as const))
}

/** The heroes who joined the roster since the week began (decision 35). */
export function newcomersThisWeek(t: Town, start: WeekStart | undefined): Set<number> | undefined {
  return start && start.week === t.week ? new Set(t.heroes.filter((h) => !start.heroes.some((x) => x.guid === h.guid)).map((h) => h.guid)) : undefined
}

/** The Hamlet as the week found it (C90): heroes placed in a building since the week began are free again, and their seats open.
 *  A week-start record without places (written before C90) counts nobody as placed when the week began. The four are chosen on
 *  this view; the seats, the beds and the gold the plan hands out are the save's. */
export function planView(t: Town, start: WeekStart | undefined): Town {
  if (!start || start.week !== t.week) return t
  const atStart = new Map(start.heroes.map((h) => [h.guid, h.busy ?? ""]))
  const placed = t.heroes.filter((h) => h.busy && atStart.has(h.guid) && !atStart.get(h.guid))
  if (!placed.length) return t
  const freed = new Set(placed.map((h) => h.guid))
  return {
    ...t,
    heroes: t.heroes.map((h) => (freed.has(h.guid) ? { ...h, busy: "" } : h)),
    activities: t.activities.map((x) => ({ ...x, used: x.used - placed.filter((h) => h.busy === x.name).length })),
  }
}
