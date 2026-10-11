// The campfire (#8, C74): what a camping skill does in the Hamlet's words, whether a page shows the party camping, and what the
// four carry to the fire. Soushi, 2026-10-11 06:09: "Only at the camp. Like invoking the presence of the town advisor during the
// camp for bilan of the situation and advices."
import type { Snap } from "./chronicle.ts"
import { campingSkills, type CampEffect, type CampSkill } from "./game.ts"

const who = (sel: string) => ({ self: "the one who uses it", individual: "one hero", party_other: "each companion", party: "the whole party" })[sel] ?? sel.replace(/_/g, " ")

// a boon named from its own id: campingDMGLowBuff is damage, campingStressResistBuff stress resistance
function boon(e: { sub: string; amount: number }) {
  const w = e.sub.replace(/^camping/, "").replace(/Buff$/, "").replace(/(Low|High)$/, "").replace(/DMG/g, "Damage").replace(/Resist$/, "Resistance").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()
  const n = Math.abs(e.amount)
  return `${n < 2 ? `${Math.round(n * 100)}%` : n} ${w || "boon"}`.trim()
}

const says = (e: CampEffect) => ({
  stress_heal_amount: `relieves ${e.amount} stress for ${who(e.selection)}`, stress_damage_amount: `adds ${e.amount} stress to ${who(e.selection)}`,
  health_heal_max_health_percent: `heals ${Math.round(e.amount * 100)}% of health for ${who(e.selection)}`, health_damage_max_health_percent: `costs ${who(e.selection)} ${Math.round(e.amount * 100)}% of health`,
  remove_bleeding: `stops bleeding on ${who(e.selection)}`, remove_poison: `clears blight on ${who(e.selection)}`, remove_disease: `cures a disease of ${who(e.selection)}`,
  remove_deaths_door_recovery_buffs: `lifts the weakness left by Death's Door from ${who(e.selection)}`, reduce_ambush_chance: "guards the camp against a night ambush",
  loot: "turns up some loot", reduce_torch: "dims the torch", buff: `${boon(e)} for ${who(e.selection)} until the next fight`,
} as Record<string, string>)[e.type] ?? e.type.replace(/_/g, " ")

/** What a camping skill does, from its effects in the game's file: the same effect told once, and one whose amount depends on
 *  who takes it (religious or not, say) told as "10 or 20". */
export function campTell(k: CampSkill): string {
  const groups = new Map<string, number[]>()
  for (const e of k.effects) if (/^stress_(heal|damage)_amount$/.test(e.type)) groups.set(`${e.type}|${e.selection}`, [...(groups.get(`${e.type}|${e.selection}`) ?? []), e.amount])
  return [...new Set(k.effects.map((e) => {
    const g = groups.get(`${e.type}|${e.selection}`)
    return g && new Set(g).size > 1 ? says(e).replace(/\d+/, `${[...new Set(g)].join(" or ")}`) + ", by who they are" : says(e)
  }))].join("; ")
}

/** Whether this page shows the party at the campfire, and by which sign. Not yet pinned against a real camp save: no recorded
 *  road has camped (every page of the four trips kept on 2026-10-11 holds `raid.camp` at phase 0, 0 skill points, an empty
 *  skill log). So any one of the signs a camp must leave counts: a firewood spent since the last page (firewood is only burnt
 *  to camp), the camp's phase leaving 0, camp skill points to spend, or a camping skill in the log. */
export function camping(prev: Snap | undefined, p: Snap, raw: any): string {
  const camp = raw?.raid?.camp ?? {}
  if (prev && (p.supplies.firewood ?? 0) < (prev.supplies.firewood ?? 0)) return "a firewood burnt"
  if (Number(camp.phase ?? 0) !== 0) return `the camp's phase ${camp.phase}`
  if (Number(camp.camping_skill_points ?? 0) > 0) return `${camp.camping_skill_points} camp points to spend`
  if (Object.keys(camp.skill_log ?? {}).length || Object.keys(camp.party_skill_log ?? {}).length) return "a camping skill used"
  return ""
}

/** The four at the fire: each one's camping skills as they took them to camp, with what each does, its cost in camp points and
 *  how often it may be used; and the points the camp holds when the save says so. */
export async function campBrief(p: Snap, raw: any): Promise<string> {
  const lib = await campingSkills(), roster = raw?.heroes ?? {}, camp = raw?.raid?.camp ?? {}
  const lines = p.heroes.map((h) => {
    const r = roster[h.guid] ?? Object.values<any>(roster).find((x: any) => Number(x?.hero_file_data?.raw_data?.id ?? x?.id) === h.guid)
    const ids = Object.keys(r?.hero_file_data?.raw_data?.skills?.selected_camping_skills ?? {})
    const ks = ids.map((id) => lib.get(id)).filter(Boolean) as CampSkill[]
    return `  ${h.name}: ${ks.length ? ks.map((k) => `${k.name} (${k.points} points${k.limit ? `, ${k.limit} use${k.limit > 1 ? "s" : ""}` : ""}): ${campTell(k)}`).join("; ") : "no camping skill I can read"}`
  })
  const pts = Number(camp.camping_skill_points ?? 0)
  return [`CAMPING SKILLS THEY TOOK TO THE FIRE${pts ? ` (${pts} camp points to spend)` : ""}`, ...lines].join("\n")
}

/** How much a camping skill is worth at the fire, by my habit (RULE in advise.ts): stress relieved by how many it reaches,
 *  health healed, a cure, a guard on the camp, a boon for the next fight. */
export function campWorth(k: CampSkill, R: { campStress: number; campHealth: number; campCure: number; campGuard: number; campBoon: number }): number {
  const reach = (sel: string) => (sel === "party_other" ? 3 : sel === "party" ? 4 : 1)
  return k.effects.reduce((v, e) => v + (e.type === "stress_heal_amount" ? e.amount * reach(e.selection) * R.campStress
    : e.type === "stress_damage_amount" ? -e.amount * reach(e.selection) * R.campStress / 2 : e.type === "health_heal_max_health_percent" ? e.amount * R.campHealth * reach(e.selection)
    : /^remove_/.test(e.type) ? R.campCure : e.type === "reduce_ambush_chance" ? R.campGuard : e.type === "buff" ? R.campBoon : 0), 0)
}
