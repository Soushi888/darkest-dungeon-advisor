// C106: the special foes a road met, kept so the next road is advised by them (Soushi, 2026-10-13, after the Collector drove the
// Warrens four out at Death's Door: "We need to take note when we encounter special foes like that to improve our strategy").
// A foe is special when the dungeon's usual halls and rooms do not field it at that level: a wanderer of its conditional lines
// (the Collector, the Shambler) or a boss. What is kept is what the pages show: how the fight ended, how long it ran, what the
// foe called to its side, and who it brought to Death's Door. Its blows come from its own file, never from memory.
import type { Snap } from "./chronicle.ts"

export interface Meeting { cls: string; name: string; kind: "wanderer" | "boss"; outcome: "won" | "fled" | "unfinished"; rounds: number; brought: string[]; brink: string[]; page: number }

/** The fights of a trip, each its run of pages in a battle, a round that runs backwards starting a new one. */
export function fights(snaps: Snap[]): { page: number; snap: Snap }[][] {
  const out: { page: number; snap: Snap }[][] = []
  let cur: { page: number; snap: Snap }[] = []
  snaps.forEach((snap, i) => {
    if (!snap.battle) { if (cur.length) out.push(cur); cur = []; return }
    if (cur.length && snap.battle.round < cur.at(-1)!.snap.battle!.round) { out.push(cur); cur = [] }
    cur.push({ page: i, snap })
  })
  if (cur.length) out.push(cur)
  return out
}

/** How a fight ended, read from the page after its last: a retreat, a win, or still on when the pages stop. */
export function fightEnd(snaps: Snap[], fight: { page: number; snap: Snap }[]): Meeting["outcome"] {
  const last = fight.at(-1)!, after = snaps[last.page + 1]
  // what the game narrated after the fight's last page: a retreat is "battle_retreat", a win "victory"
  const said = after?.narrated?.slice(last.snap.narrated?.length ?? 0) ?? []
  const won = said.includes("victory") || (after && (after.tally.BATTLE_COMPLETED ?? 0) > (last.snap.tally.BATTLE_COMPLETED ?? 0))
  return said.includes("battle_retreat") ? "fled" : won ? "won" : after ? "fled" : "unfinished"
}

/** Every special foe met on a trip, one meeting per fight it stood in. `special` maps a foe variant to what it is
 *  (`specialFoes()` in sources/game.ts), `usual` lists the variants the dungeon's halls and rooms field at that level. */
export function meetings(snaps: Snap[], special: Map<string, "wanderer" | "boss">, usual: Set<string>): Meeting[] {
  const out: Meeting[] = []
  for (const fight of fights(snaps)) {
    const foes = fight.flatMap((f) => f.snap.battle!.foes)
    const named = new Map<string, string>()
    for (const f of foes) if (f.cls && special.has(f.cls) && !named.has(f.cls)) named.set(f.cls, f.name)
    if (!named.size) continue
    const outcome = fightEnd(snaps, fight)
    // what it called to its side: foes of this fight that neither the usual halls field nor are special themselves, by name
    const brought = [...new Set(foes.filter((f) => f.cls && !usual.has(f.cls) && !special.has(f.cls) && !/^corpse/.test(f.cls)).map((f) => f.name))]
    // brought to Death's Door here: at the door in the fight and not on the page before it began
    const before = new Set((snaps[fight[0]!.page - 1]?.heroes ?? []).filter((h) => h.deathsDoor).map((h) => h.name))
    const brink = [...new Set(fight.flatMap((f) => f.snap.heroes.filter((h) => h.deathsDoor && !before.has(h.name)).map((h) => h.name)))]
    const rounds = Math.max(...fight.map((f) => f.snap.battle!.round))
    // one meeting per fight: a boss in several parts (the Formless Flesh) is one foe, kept under its first part
    const [cls] = named.keys()
    out.push({ cls: cls!, name: [...new Set(named.values())].join(" and "), kind: special.get(cls!)!, outcome, rounds, brought, brink, page: fight[0]!.page })
  }
  return out
}

/** One trip's meetings with the same foe as one, so the ledger keeps one lesson per foe and trip, each fight told in turn. */
export function byFoe(ms: Meeting[]): Meeting[][] {
  const out = new Map<string, Meeting[]>()
  for (const m of ms) out.set(m.cls, [...(out.get(m.cls) ?? []), m])
  return [...out.values()]
}

/** The meeting in a sentence for the return board and the ledger. */
export function meetingLine(m: Meeting, where: string): string {
  const end = m.outcome === "won" ? `they beat it in ${m.rounds} round${m.rounds === 1 ? "" : "s"}` : m.outcome === "fled" ? `they retreated after ${m.rounds} round${m.rounds === 1 ? "" : "s"}` : `the fight was still on when the road ended`
  const brought = m.brought.length ? ` It called ${m.brought.join(", ")} to its side.` : ""
  const brink = m.brink.length ? ` ${m.brink.join(" and ")} ${m.brink.length > 1 ? "were" : "was"} brought to Death's Door.` : ""
  return `${m.name}, ${m.kind === "boss" ? "the boss" : "a wanderer"} of ${where}: ${end}.${brought}${brink}`
}
