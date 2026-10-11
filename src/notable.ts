// Which chronicle page changes the story (C65): one test for the live stream's CHRON line and for the road zone's busy line,
// so the board never shows the Caretaker at work on a page he does not answer (Soushi, 2026-10-11 04:59: "it looks like you
// are always writing").
import { newlySeen } from "./map.ts"

const crossed = (a: number, b: number) => [50, 25].some((x) => a >= x && b < x)

/** True when the page changes the story against the one before it: a battle, a room or an ambush, the light past 50 or 25, a
 *  break, a virtue, Death's Door, a hero under 30% health, a change in the four, or something new in sight. The first page is. */
export function isNotable(prev: any, p: any): boolean {
  if (!prev) return true
  const tl = p.tally ?? {}, pt = prev.tally ?? {}
  return ["BATTLE_COMPLETED", "ROOM_VISITED", "AMBUSHED"].some((k) => (tl[k] ?? 0) !== (pt[k] ?? 0)) || crossed(prev.torch, p.torch)
    || (p.heroes ?? []).some((h: any) => { const w = prev.heroes?.find((x: any) => x.guid === h.guid); return !w || (h.affliction && !w.affliction) || (h.virtue && !w.virtue) || (h.deathsDoor && !w.deathsDoor) || (h.hp < h.maxHp * 0.3 && w.hp >= w.maxHp * 0.3) })
    || (prev.heroes ?? []).length !== (p.heroes ?? []).length
    || newlySeen(prev.map, p.map).length > 0
}
