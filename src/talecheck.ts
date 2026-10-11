// The tale checks itself against the pages before it is told (C55). Soushi, 2026-10-11 04:18: "Fix the tale so it doesn't make
// errors anymore". Every number a beat says is read back out of its words and re-derived from the pages around it, in sign and
// size; the counts the tale tells are held against the game's own tallies; no hero stands among the foes. A beat that fails is
// dropped rather than told wrong, and every failure is an issue the board writes to coherence.json for the live session.
import type { Beat, Debrief, Snap } from "./chronicle.ts"

type Delta = { hp: number; st: number }
const delta = (a: Snap | undefined, b: Snap | undefined, who: string): Delta | undefined => {
  const h = b?.heroes.find((x) => x.name === who), w = a?.heroes.find((x) => x.name === who)
  return h && w ? { hp: Math.round(w.hp) - Math.round(h.hp), st: h.stress - w.stress } : undefined
}

/** The claims a beat's words make, each a test against two pages. */
function claims(text: string): ((a?: Snap, b?: Snap) => boolean)[] {
  const out: ((a?: Snap, b?: Snap) => boolean)[] = []
  for (const m of text.matchAll(/(\p{Lu}[\p{L}'-]+) lost (\d+) health/gu)) out.push((a, b) => delta(a, b, m[1]!)?.hp === Number(m[2]))
  for (const m of text.matchAll(/(\p{Lu}[\p{L}'-]+) (?:lost \d+ health and )?gained (\d+) stress/gu)) out.push((a, b) => delta(a, b, m[1]!)?.st === Number(m[2]))
  for (const m of text.matchAll(/(\p{Lu}[\p{L}'-]+) (?:lost|shed) (\d+) stress/gu)) out.push((a, b) => delta(a, b, m[1]!)?.st === -Number(m[2]))
  const trap = text.match(/sprung on (\p{Lu}[\p{L}'-]+), costing (?:(\d+) health)?(?: and )?(?:(\d+) stress)?/u)
  if (trap) out.push((a, b) => { const d = delta(a, b, trap[1]!); return !!d && d.hp === Number(trap[2] ?? 0) && d.st === Number(trap[3] ?? 0) })
  const crit = text.match(/critical blow on (\p{Lu}[\p{L}'-]+) for (\d+)/u)
  if (crit) out.push((a, b) => delta(a, b, crit[1]!)?.hp === Number(crit[2]))
  const bare = text.match(/cost the four (\d+) stress between them and dropped the light from (\d+) to (\d+)/)
  if (bare) out.push((a, b) => !!a && !!b && a.torch === Number(bare[2]) && b.torch === Number(bare[3]) && b.heroes.reduce((t, h) => t + Math.max(0, delta(a, b, h.name)?.st ?? 0), 0) === Number(bare[1]))
  return out
}

/** A health a beat names from one page to the next ("health fell from 26 to 15"). */
function healths(text: string): ((a?: Snap, b?: Snap) => boolean)[] {
  return [...text.matchAll(/(\p{Lu}[\p{L}'-]+)(?: took a heavy wound| was mended): health (?:fell|rose) from (\d+) to (\d+)/gu)].map((m) => (a?: Snap, b?: Snap) =>
    Math.round(a?.heroes.find((h) => h.name === m[1])?.hp ?? NaN) === Number(m[2]) && Math.round(b?.heroes.find((h) => h.name === m[1])?.hp ?? NaN) === Number(m[3]))
}

/** A stress level a beat names on its own page ("stress leapt to 27", "stress reached 93"). */
function levels(text: string): ((s?: Snap) => boolean)[] {
  return [...text.matchAll(/(\p{Lu}[\p{L}'-]+)'s stress (?:leapt to|reached) (\d+)/gu)].map((m) => (s?: Snap) => s?.heroes.find((h) => h.name === m[1])?.stress === Number(m[2]))
}

export interface TaleCheck { beats: Beat[]; issues: string[] }

export function checkTale(snaps: Snap[], beats: Beat[], db?: Debrief, heroClasses: string[] = []): TaleCheck {
  const issues: string[] = [], kept: Beat[] = []
  for (const b of beats) {
    const cs = [...claims(b.text), ...healths(b.text)], ls = levels(b.text), i = b.i
    // the harm a beat tells shows on its page, or the one after when the game saves before the blow lands
    const spans: [number, number][] = [[i - 1, i], [i, i + 1], [i - 1, i + 1]]
    const ok = cs.every((c) => spans.some(([x, y]) => c(snaps[x], snaps[y]))) && ls.every((l) => [i, i - 1, i + 1].some((k) => l(snaps[k])))
    if (ok) kept.push(b)
    else issues.push(`the tale's step on page ${i} does not match the pages, and is not told: "${b.text}"`)
  }
  if (snaps.length > 1) {
    const first = snaps[0]!, last = snaps.at(-1)!, tally = (k: string) => (last.tally[k] ?? 0) - (first.tally[k] ?? 0)
    const said = (k: Beat["kind"]) => kept.filter((b) => b.kind === k)
    const battles = said("battle").reduce((t, b) => t + (Number(b.text.match(/^(\d+) battles/)?.[1]) || 1), 0)
    if (battles !== tally("BATTLE_COMPLETED")) issues.push(`the tale tells ${battles} battles won, the road counted ${tally("BATTLE_COMPLETED")}`)
    if (said("curio").length !== tally("CURIO_INVESTIGATED")) issues.push(`the tale tells ${said("curio").length} curios searched, the road counted ${tally("CURIO_INVESTIGATED")}`)
    // obstacles: one per shovel spent outside a fight and a curio, and one per obstacle cleared by hand the narrator spoke of
    let shovels = 0, food = 0
    for (let k = 1; k < snaps.length; k++) {
      const a = snaps[k - 1]!, b = snaps[k]!, calm = !a.inBattle && !b.inBattle && (b.tally.CURIO_INVESTIGATED ?? 0) === (a.tally.CURIO_INVESTIGATED ?? 0)
      if (calm) { shovels += Math.max(0, (a.supplies.shovel ?? 0) - (b.supplies.shovel ?? 0)); food += (a.supplies.food ?? 0) > (b.supplies.food ?? 0) ? 1 : 0 }
    }
    const byHand = (last.narrated ?? []).filter((e) => e === "obstacle_clear_no_item").length
    if (said("obstacle").length !== shovels + byHand) issues.push(`the tale tells ${said("obstacle").length} obstacles, the road spent ${shovels} shovels and cleared ${byHand} by hand`)
    if (said("meal").length !== food) issues.push(`the tale tells ${said("meal").length} meals or hungers, the food fell ${food} times outside a fight`)
  }
  // a hero never stands among the foes, by name or by calling
  const heroes = new Set([...snaps.flatMap((s) => s.heroes.map((h) => h.name)), ...heroClasses])
  for (const f of db?.foes ?? []) if (heroes.has(f.name)) issues.push(`${f.name} is one of the four, yet stands among the foes`)
  return { beats: kept, issues }
}
