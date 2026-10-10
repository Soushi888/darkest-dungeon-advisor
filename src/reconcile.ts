// Picks against the save (C18): what Soushi chose on the board, checked against what the next Hamlet save shows
// he did. The board never acts in the game (A1), so every pick is done by hand, and this is where a slip shows.
// Picks are kept per week in .local/town/picks.json; a card that leaves the board once its pick is done
// (a hero placed in a building has no relief card) keeps its pick until the week turns.
import { join } from "node:path"
import type { Town } from "./town.ts"

export interface Pick { pick: string; note?: string; code?: string }
export interface Picks { week: number; picks: Record<string, Pick> }
export type Status = "done" | "pending" | "contrary"
export interface Check { question: string; pick: string; status: Status; seen: string }

/** Each card of a built board and its options, from the board's markdown (`- q:` then `    - pick:` lines, JSON strings). */
export function boardOptions(md: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  let q: string | undefined
  for (const line of md.split("\n")) {
    const mq = line.match(/^- q: (".*")\s*$/)
    if (mq) { q = JSON.parse(mq[1]!); out.set(q!, []); continue }
    const mp = line.match(/^\s+- pick: (".*")\s*$/)
    if (mp && q) out.get(q)!.push(JSON.parse(mp[1]!))
  }
  return out
}

/** The board's export: `- **N. Question** Pick` with an optional `  - Note (...): text` line. Card numbers are dropped.
 *  With the board's options, a pick that is not one of its card's options is dropped (C18): the page keeps picks by card
 *  position, so when cards come or go between builds an old pick can land on the wrong card. Its note is kept. */
export function parseAnswers(text: string, options?: Map<string, string[]>): Record<string, Pick> {
  const out: Record<string, Pick> = {}
  const lines = text.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^- \*\*\d+\.\s*(.+?)\*\*\s*(.*)$/)
    if (!m) continue
    const q = m[1]!.trim()
    const p: Pick = { pick: m[2]!.trim() }
    const n = lines[i + 1]?.match(/^\s+- Note[^:]*:\s*(.+)$/)
    if (n) p.note = n[1]!.trim()
    const opts = options?.get(q)
    if (opts && !opts.includes(p.pick)) { if (!p.note) continue; p.pick = "" }
    out[q] = p
  }
  return out
}

/** Merges a new export into the week's picks; a new week starts clean. Heirloom picks remember the code they aimed at. */
export function mergePicks(prev: Picks | undefined, text: string, t: Town, options?: Map<string, string[]>): Picks {
  const base: Picks = prev && prev.week === t.week ? prev : { week: t.week, picks: {} }
  for (const [q, p] of Object.entries(parseAnswers(text, options))) {
    if (q.startsWith("Where do the heirlooms go")) p.code = t.buildingUpgrades.find((u) => u.label === p.pick)?.code
    base.picks[q] = p
  }
  return base
}

export const picksFile = (dir: string) => join(dir, "picks.json")
export async function loadPicks(dir: string): Promise<Picks | undefined> {
  const f = Bun.file(picksFile(dir))
  return (await f.exists()) ? f.json() : undefined
}

/** One line per pick the save can confirm. Expedition and party picks wait for the save made on setting out. */
export function reconcile(p: Picks | undefined, t: Town): Check[] {
  if (!p || p.week !== t.week) return []
  const hero = (name: string) => t.heroes.find((h) => h.name === name)
  const out: Check[] = []
  const add = (question: string, pick: string, status: Status, seen: string) => out.push({ question, pick, status, seen })
  for (const [q, { pick, code }] of Object.entries(p.picks)) {
    if (!pick) continue
    let m: RegExpMatchArray | null
    if ((m = q.match(/^Where does (.+) go\?$/))) {
      const h = hero(m[1]!)
      if (!h) { add(q, pick, "contrary", `${m[1]} is no longer on the roster`); continue }
      if (pick === "Leave them be") add(q, pick, h.busy ? "contrary" : "done", h.busy ? `${h.name} is at the ${h.busy}` : `${h.name} is in no building`)
      else add(q, pick, h.busy === pick ? "done" : h.busy ? "contrary" : "pending", h.busy ? `${h.name} is at the ${h.busy}` : `${h.name} is in no building yet`)
    } else if ((m = q.match(/^Treat (.+?)'s .+\?$/))) {
      // the Medical Ward for a disease, the Treatment Ward for a quirk (C25): the pick names the place
      const h = hero(m[1]!)
      const wards = t.activities.filter((a) => a.activity === "disease_treatment" || a.activity === "treatment").map((a) => a.name)
      if (!h) { add(q, pick, "contrary", `${m[1]} is no longer on the roster`); continue }
      if (wards.includes(pick)) add(q, pick, h.busy === pick ? "done" : h.busy ? "contrary" : "pending", h.busy ? `${h.name} is at the ${h.busy}` : `${h.name} is in no building yet`)
      else { const there = wards.includes(h.busy); add(q, pick, there ? "contrary" : "done", there ? `${h.name} is in the ${h.busy}` : `${h.name} is not in a ward`) }
    } else if ((m = q.match(/^Dismiss (.+)\?$/))) {
      const gone = !hero(m[1]!)
      if (pick === "Dismiss") add(q, pick, gone ? "done" : "pending", gone ? `${m[1]} has left the roster` : `${m[1]} is still on the roster`)
      else add(q, pick, gone ? "contrary" : "done", gone ? `${m[1]} has left the roster` : `${m[1]} is still on the roster`)
    } else if ((m = q.match(/^Recruit (.+), .+\?$/))) {
      const joined = !!hero(m[1]!)
      if (pick === "Recruit") add(q, pick, joined ? "done" : "pending", joined ? `${m[1]} is on the roster` : `${m[1]} is not on the roster yet`)
      else add(q, pick, joined ? "contrary" : "done", joined ? `${m[1]} is on the roster` : `${m[1]} stayed at the coach`)
    } else if (q === "What do we train first?") {
      const u = pick.match(/^(.+?): (.+) to level (\d+)$/)
      if (!u) continue // "Keep the gold": the coffers move for many reasons, so the save cannot confirm it
      const still = t.heroUpgrades.some((x) => x.hero === u[1] && x.label === u[2] && (x.toLevel ?? 0) <= Number(u[3]))
      add(q, pick, still ? "pending" : "done", still ? `${u[1]}'s ${u[2]} is still below level ${u[3]}` : `${u[1]}'s ${u[2]} has reached level ${u[3]}`)
    } else if (q === "Where do the heirlooms go?") {
      if (pick === "Save them" || !code) continue
      const next = t.buildingUpgrades.find((x) => x.label === pick)
      const done = !next || next.code !== code
      add(q, pick, done ? "done" : "pending", done ? `${pick} is bought` : `${pick} is not bought yet`)
    }
  }
  return out
}
