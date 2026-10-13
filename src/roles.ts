// The roster's balance (C85): what each hero does in a fight, read from the skills they carry, and the pairs too alike to keep
// both. Soushi, 2026-10-11 07:15: "maybe it is worth looking for diversity and complementarity in our roster, so if we have 2
// heroes too similar we can dismiss one and recruit a new one that could better complement the roster, even if lower level."
import type { Skill } from "./game.ts"

export type Role = "healer" | "stunner" | "stress" | "marker" | "front" | "back"
export const ROLE_WORDS: Record<Role, string> = { healer: "heals", stunner: "stuns", stress: "relieves stress", marker: "marks a foe", front: "holds the front", back: "strikes from the back" }
const ORDER: Role[] = ["healer", "stunner", "stress", "marker", "front", "back"]
const SPECIAL = new Set<Role>(["healer", "stunner", "stress", "marker"])

/** The roles of a hero from the skills they carry: a true heal (at least `realHeal` hit points), a stun, a stress relief, a mark;
 *  and where they fight, front or back, from where at least two of their attacks are used. */
export function rolesOf(skills: Skill[], realHeal: number): Role[] {
  const attacks = skills.filter((k) => !k.targetsAllies && k.target.length)
  const has: Record<Role, boolean> = {
    healer: skills.some((k) => k.heal && k.targetsAllies && k.healAvg >= realHeal), stunner: skills.some((k) => k.stun),
    stress: skills.some((k) => !!k.stressHeal), marker: skills.some((k) => k.marks),
    front: attacks.filter((k) => k.launch.some((r) => r <= 2)).length >= 2, back: attacks.filter((k) => k.launch.some((r) => r >= 3)).length >= 2,
  }
  return ORDER.filter((r) => has[r])
}

export interface Member { guid: number; name: string; cls: string; clsName: string; level: number; bad: number; stress: number; roles: Role[] }
export interface Alike { keep: Member; drop: Member; shared: string; why: string }

/** Pairs too alike to keep both: the same class, or the very same roles with a speciality among them (a heal, a stun, a stress
 *  relief, a mark). The one to let go is never in the party leaving, and is
 *  the lower level, then the one with more bad quirks, then the more stressed; each hero is let go at most once. */
export function alikePairs(roster: Member[], going: Set<number>): Alike[] {
  const out: Alike[] = [], gone = new Set<number>()
  const weaker = (x: Member, y: Member) => x.level - y.level || y.bad - x.bad || y.stress - x.stress
  for (let i = 0; i < roster.length; i++) for (let j = i + 1; j < roster.length; j++) {
    const a = roster[i]!, b = roster[j]!
    // the same roles count only with a speciality among them: front and back alone are what most heroes do
    const same = a.cls === b.cls, sameRoles = a.roles.some((r) => SPECIAL.has(r)) && a.roles.join() === b.roles.join()
    if (!same && !sameRoles) continue
    // C86: two true healers are never too alike; a party leaves short of a heal far more often than it carries two
    if (a.roles.includes("healer") && b.roles.includes("healer")) continue
    const [drop, keep] = weaker(a, b) <= 0 ? [a, b] : [b, a]
    if (going.has(drop.guid) || gone.has(drop.guid) || gone.has(keep.guid)) continue
    gone.add(drop.guid)
    const shared = same ? `both ${keep.clsName}s` : `the same roles: ${keep.roles.map((r) => ROLE_WORDS[r]).join(", ")}`
    const why = keep.level !== drop.level ? `${keep.name} is level ${keep.level}, ${drop.name} level ${drop.level}` : keep.bad !== drop.bad ? `${drop.name} carries ${drop.bad} bad quirk${drop.bad === 1 ? "" : "s"} to ${keep.name}'s ${keep.bad}` : `${drop.name} is the more stressed, ${drop.stress} to ${keep.stress}`
    out.push({ keep, drop, shared, why })
  }
  return out
}

/** The roles the roster would lack, or hold only once, once these heroes are gone: what a recruit should bring. */
export function gaps(roster: Member[], without: Set<number>): Role[] {
  const left = roster.filter((m) => !without.has(m.guid))
  const count = (r: Role) => left.filter((m) => m.roles.includes(r)).length
  return ORDER.filter((r) => count(r) <= 1).sort((a, b) => count(a) - count(b))
}
