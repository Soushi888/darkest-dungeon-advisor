// C102: what a road teaches, beyond what it used (Soushi, 2026-10-13, on "What I will remember: carry more torches": "Those
// learning are such superficials... I was more expecting learning about foes and synergie between the heroes, like useful
// stuff"). Read from the debrief and the pages: the foe that hurt most and how, whom the foes went for, the healer pulled
// forward by the shuffles, what the heals cost the others, and who carried the killing blows. Each is a short line for the
// board and a lesson for the ledger, so the next road to the same dungeon is advised by it.
import type { Beat, Debrief, Lesson, Snap } from "./chronicle.ts"
import { slainIn } from "./slain.ts"

type Base = Omit<Lesson, "kind" | "text">

/** The fights of a trip, each its run of pages in a battle, a round that runs backwards starting a new one. */
function fights(snaps: Snap[]): { page: string; snap: Snap }[][] {
  const out: { page: string; snap: Snap }[][] = []
  let cur: { page: string; snap: Snap }[] = []
  snaps.forEach((snap, i) => {
    if (!snap.battle) { if (cur.length) out.push(cur); cur = []; return }
    if (cur.length && snap.battle.round < cur.at(-1)!.snap.battle!.round) { out.push(cur); cur = [] }
    cur.push({ page: String(i), snap })
  })
  if (cur.length) out.push(cur)
  return out
}

export function teachings(snaps: Snap[], beats: Beat[], db: Debrief | undefined, base: Base, healers: string[]): { lines: string[]; lessons: Lesson[] } {
  const lines: string[] = [], lessons: Lesson[] = []
  const add = (kind: Lesson["kind"], line: string, lesson = line) => { lines.push(line); lessons.push({ ...base, kind, text: lesson }) }
  const foes = (db?.foes ?? []).map((f) => ({ ...f, total: f.hp + f.bleed + f.blight })).filter((f) => f.total > 0).sort((a, b) => b.total - a.total)
  // the foe that hurt most, and what answers it
  const top = foes[0]
  if (top) {
    const how = [top.bleed ? `${top.bleed} by bleeding` : "", top.blight ? `${top.blight} by blight` : "", top.crits ? `${top.crits} critical${top.crits > 1 ? "s" : ""}` : ""].filter(Boolean)
    const answer = [top.bleed ? "bring bandages" : "", top.blight ? "bring antivenom" : ""].filter(Boolean)
    add("foe", `The ${top.name}s hurt them most: ${top.total} health${how.length ? `, ${how.join(", ")}` : ""}. Strike them first${answer.length ? `, and ${answer.join(" and ")}` : ""}.`,
      `${top.name}s hurt most (${top.total} health${how.length ? `, ${how.join(", ")}` : ""}): strike them first${answer.length ? `, ${answer.join(" and ")}` : ""}`)
  }
  // whom the foes went for: the healer above all is a lesson about the line
  const taken = new Map<string, number>()
  for (const f of foes) for (const [who, n] of Object.entries(f.victims)) taken.set(who, (taken.get(who) ?? 0) + n)
  const all = [...taken.values()].reduce((a, b) => a + b, 0)
  const [mark, hp] = [...taken].sort((a, b) => b[1] - a[1])[0] ?? []
  if (mark && all && hp! / all >= 0.35) {
    const isHealer = healers.includes(mark)
    add("line", `The foes went for ${mark}: ${hp} of the ${all} health they took was ${isHealer ? "the healer's" : "theirs"}.${isHealer ? " Keep the heal at the back, behind the toughest." : ""}`,
      `the foes went for ${mark}${isHealer ? ", the healer" : ""} (${hp} of ${all} health)${isHealer ? ": keep the heal at the back" : ""}`)
  }
  // the healer pulled forward by the shuffles
  for (const h of healers) {
    const pulled = beats.filter((b) => b.kind === "shuffle" && new RegExp(`${h} (?:took )?rank [12]\\b`).test(b.text)).length
    if (pulled >= 2) add("line", `The line shuffled ${h}, the healer, forward ${pulled} times. Put them back after each fight; a hero who moves the line would help.`, `${h}, the healer, was shuffled forward ${pulled} times`)
  }
  // what the heals cost the others
  const costs = db?.costs ?? []
  for (const by of [...new Set(costs.map((c) => c.by))]) {
    const mine = costs.filter((c) => c.by === by), sum = mine.reduce((a, c) => a + c.hp, 0)
    if (sum >= 5) add("cost", `${by}'s heals left ${sum} health of ${mine[0]!.kind === "bleed" ? "bleeding" : "blight"} on ${[...new Set(mine.map((c) => c.to))].join(", ")}: heal those already bleeding last.`, `${by}'s heals cost the others ${sum} health of ${mine[0]!.kind === "bleed" ? "bleeding" : "blight"}`)
  }
  // who carried the killing blows
  const kills = new Map<string, number>()
  for (const f of fights(snaps)) for (const s of slainIn(f)) if (s.by) kills.set(s.by, (kills.get(s.by) ?? 0) + 1)
  const total = [...kills.values()].reduce((a, b) => a + b, 0)
  const [lead, n] = [...kills].sort((a, b) => b[1] - a[1])[0] ?? []
  if (lead && total >= 3 && n! / total >= 0.4) add("four", `${lead} struck ${n} of the ${total} killing blows I could tell: the four's blade. Keep ${lead} in the four, and train the blow that finishes.`, `${lead} carried the killing blows (${n} of ${total})`)
  return { lines, lessons }
}
