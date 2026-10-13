// What a turn did (C53): a hit, a dodge, a move, a buff or a heal, told apart from what changed between two chronicle pages
// and the fight's own counters (raid.battle). Soushi, 2026-10-11 04:06: "ensure you make well the distinction between miss, move, dodge".
//
// The counters, read against the Cove trip of 2026-10-11: consecutive_monster_dodges rises when a foe dodges a hero's blow
// (page 59: Emory struck, nothing changed, the counter went 0 to 1, and current_hero_consecutive_miss_acc_buff, the accuracy
// the game lends the next hero after a dodge, went 0 to 0.04). The save keeps no counter for a hero dodging a foe, so a foe's
// turn that changes nothing is told as missed or unseen, never as a dodge.

export type TurnKind = "hit" | "dodge" | "move" | "buff" | "heal" | "unknown"
export interface Turn { who: string; side: "hero" | "foe"; kind: TurnKind; said: string }

type Actor = { name: string; guid?: number; hp: number; stress?: number; effects?: string[]; stunned?: boolean }
interface Side { heroes: Actor[]; foes: Actor[] }

const by = (xs: Actor[], a: Actor) => xs.find((x) => (a.guid != null && x.guid === a.guid) || (a.guid == null && x.name === a.name))
const newEffects = (a: Actor, w?: Actor) => (a.effects ?? []).filter((x) => !(w?.effects ?? []).includes(x)).length > 0 || (!!a.stunned && !w?.stunned)
const order = (xs: Actor[]) => xs.map((x) => x.guid ?? x.name).join()

/** The kind of the one turn taken between two pages, or undefined when no one acted or more than one did. */
export function turnKind(prev: Side, now: Side, actor: { name: string; side: "hero" | "foe" }, dodges: [number, number]): Turn {
  const mine = actor.side === "hero" ? now.heroes : now.foes, theirs = actor.side === "hero" ? now.foes : now.heroes
  const mineWas = actor.side === "hero" ? prev.heroes : prev.foes, theirsWas = actor.side === "hero" ? prev.foes : prev.heroes
  // a foe that fell is gone from the list: it was struck
  const struck = theirsWas.some((w) => { const a = by(theirs, w); return !a || a.hp < w.hp || (a.stress ?? 0) > (w.stress ?? 0) || newEffects(a, w) })
  const healed = mine.some((a) => { const w = by(mineWas, a); return !!w && (a.hp > w.hp || (a.stress ?? 0) < (w.stress ?? 0)) })
  const buffed = mine.some((a) => newEffects(a, by(mineWas, a)))
  const moved = order(mine) !== order(mineWas) || order(theirs) !== order(theirsWas.filter((w) => by(theirs, w)))
  const t = (kind: TurnKind, said: string): Turn => ({ who: actor.name, side: actor.side, kind, said: `${actor.name} ${said}` })
  if (struck) return t("hit", "hit")
  if (actor.side === "hero" && dodges[1] > dodges[0]) return t("dodge", "struck, and the foe dodged")
  if (moved) return t("move", "moved")
  if (healed) return t("heal", "healed")
  if (buffed) return t("buff", "strengthened their side")
  return t("unknown", actor.side === "hero" ? "acted, and nothing I can see changed" : "missed, or did what I cannot see")
}
