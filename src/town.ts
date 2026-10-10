// The Hamlet as the save describes it, and the Caretaker's reading of it. Pure derivation: every figure
// is a save field or a game-file value, and every piece of advice carries the paths it came from (C14).
import type { Dson } from "./dson.ts"
import type { Save } from "./read.ts"
import {
  P, applied, buildingData, buildingTrees, describeQuirk, dungeonMonsters, heroClass, heroTrees, levelOf, levelThresholds,
  monster, nameOf, quirks, strings, trinkets, type Cost,
} from "./game.ts"

const raw = (h: any) => h.hero_file_data?.raw_data ?? h

export interface QuirkView { id: string; name: string; positive: boolean; disease: boolean; locked: boolean; description: string }
export interface HeroView {
  guid: number; name: string; cls: string; clsName: string; level: number; xp: number; stress: number
  affliction: string; busy: string; quirks: QuirkView[]; skills: { id: string; name: string; level: number }[]
  weapon: number; armour: number; trinkets: string[]; dungeons: string[]; portrait: string
}
export interface Activity { building: string; activity: string; name: string; cost: number; heal: number; cure: number; slots: number; used: number; barred: string[] }
export interface Quest { unknownTypes: string[]; bleeders: string[]; blighters: string[]; walked: boolean; idx: number; dungeon: string; dungeonName: string; type: string; difficulty: number; length: number; plot: boolean; rewards: string[]; known: string[]; unknownCount: number; types: string[] }
export interface Upgrade { hero?: string; toLevel?: number; where?: string; tree: string; label: string; code: string; cost: Cost[]; affordable: boolean; blockedBy: string }
export interface Town {
  week: number; inRaid: boolean; raidDungeon: string; estate: string
  wallet: Record<string, number>; heroes: HeroView[]; recruits: HeroView[]; rosterSize: number; rosterCap: number
  activities: Activity[]; quests: Quest[]; witnessedSkills: number; dungeonsUnlocked: string[]
  quests_done: number; quests_won: number; lastQuest: string; lastWon: boolean
  skillDiscount: number; gearDiscount: number; visited: string[]; knownVariants: string[]
  heroUpgrades: Upgrade[]; buildingUpgrades: Upgrade[]; estateTrinkets: { id: string; name: string; classes: string[] }[]
  bought: Set<string>
  supply: Record<string, string>
}

async function supplies(): Promise<Record<string, string>> {
  const s = await strings()
  const out: Record<string, string> = { provision: s.get("str_inventory_description_provision") ?? "" }
  for (const k of ["torch", "shovel", "bandage", "antivenom", "firewood", "holy_water", "skeleton_key", "medicinal_herbs", "laudanum"]) out[k] = s.get(`str_inventory_description_supply${k}`) ?? ""
  return out
}

const LENGTH = ["", "Short", "Medium", "Long"]
const DIFFICULTY: Record<number, string> = { 1: "Apprentice", 3: "Veteran", 5: "Champion", 6: "Darkest" }

async function heroView(guid: number, h: any, thr: number[], busy: Map<number, string>): Promise<HeroView> {
  const r = raw(h)
  const lib = await quirks()
  const qs: QuirkView[] = []
  for (const [id, q] of Object.entries<any>(r.quirks ?? {})) {
    const d = lib.get(id)
    qs.push({ id, name: await nameOf("quirk", id), positive: !!d?.positive, disease: !!d?.disease, locked: !!q.is_locked, description: await describeQuirk(id) })
  }
  const skills = []
  for (const [id, lvl] of Object.entries<any>(r.skills?.selected_combat_skills ?? {})) skills.push({ id, name: await nameOf("skill", id, r.heroClass), level: Number(lvl) })
  return {
    guid, name: r.actor?.name ?? `#${guid}`, cls: r.heroClass, clsName: await nameOf("class", r.heroClass),
    level: levelOf(r.resolveXp ?? 0, thr), xp: r.resolveXp ?? 0, stress: Math.round(r.m_Stress ?? 0),
    affliction: r.affliction_type_id ? await nameOf("affliction", r.affliction_type_id) : "",
    busy: busy.get(guid) ?? "", quirks: qs, skills, weapon: r.weapon_rank ?? 0, armour: r.armour_rank ?? 0,
    trinkets: Object.values<any>(r.trinkets?.items ?? {}).map((t) => t.id).filter(Boolean),
    dungeons: (r.dungeon_history ?? []).filter((d: unknown) => typeof d === "string"), portrait: P.portrait(r.heroClass),
  }
}

export async function town(save: Save): Promise<Town> {
  const thr = await levelThresholds()
  const bought = new Set<string>()
  for (const p of Object.values<any>((save.upgrades as any)?.purchases ?? {})) if (p.is_purchased !== false) bought.add(`${p.tree_id}:${p.requirement_code}`)
  const heroBought = new Map<number, Set<string>>()
  for (const p of Object.values<any>((save.upgrades as any)?.purchases ?? {})) {
    if (!heroBought.has(p.instance_number)) heroBought.set(p.instance_number, new Set())
    heroBought.get(p.instance_number)!.add(`${p.tree_id}:${p.requirement_code}`)
  }

  // who is in which building, from the town's activity slots
  const busy = new Map<number, string>()
  const activities: Activity[] = []
  const tb = (save.town as any)?.buildings ?? {}
  for (const b of ["abbey", "tavern", "sanitarium"]) {
    const def = await buildingData(b)
    for (const a of def.data.activities ?? []) {
      const slots = tb[b]?.activities?.[a.id] ?? {}
      let used = 0
      for (const s of Object.values<any>(slots)) if (s && typeof s === "object" && s.hero > 0) { busy.set(s.hero, await nameOf("activity", a.id)); used++ }
      const d = a.data
      const tree = b === "sanitarium" ? (a.id === "disease_treatment" ? "sanitarium.disease_quirk_cost" : "sanitarium.cost") : `${b}.${a.id}`
      const slotTree = b === "sanitarium" ? "sanitarium.slots" : `${b}.${a.id}`
      const costList = d.cost_upgrades ?? d.negative_quirk_cost_upgrades ?? d.disease_quirk_cost_upgrades
      const cost = costList ? applied(costList, tree, bought) as any : undefined
      const heal = d.stress_upgrades ? applied(d.stress_upgrades, tree, bought) as any : undefined
      const slot = d.slot_upgrades ? applied(d.slot_upgrades, slotTree, bought) as any : { number_of_slots: 0 }
      const cure = d.affliction_cure_upgrades ? (applied(d.affliction_cure_upgrades, tree, bought) as any).chance ?? 0 : 0
      const barred = (d.requirements ?? []).filter((r: any) => r.type === "not_have_quirks").flatMap((r: any) => r.data.quirk_library_names)
      activities.push({
        building: b, activity: a.id, name: await nameOf("activity", a.id), cost: cost?.cost_currency?.amount ?? 0,
        heal: heal?.heal_high ?? 0, cure, slots: slot.number_of_slots ?? 0, used, barred,
      })
    }
  }

  const heroes: HeroView[] = []
  for (const [g, h] of Object.entries<any>((save.roster as any)?.heroes ?? {})) heroes.push(await heroView(Number(g), h, thr, busy))
  const recruits: HeroView[] = []
  for (const [g, h] of Object.entries<any>(tb.stage_coach?.store?.hero_recruit?.generated ?? {})) recruits.push(await heroView(Number(g), h, thr, new Map()))

  // roster cap from the stage coach's own upgrade list
  const coach = await buildingData("stage_coach")
  const rs = coach.data.stores[0].data.roster_size_upgrades
  const rosterCap = rs ? (applied(rs, "stage_coach.rostersize", bought) as any).amount ?? 0 : 0

  const wallet: Record<string, number> = {}
  for (const w of Object.values<any>((save.estate as any)?.wallet ?? {})) wallet[w.type] = w.amount

  // knowledge boundary (C5): skills suffered, dungeons unlocked
  const known = new Set<string>(((save.game_knowledge as any)?.combat_skills ? Object.keys((save.game_knowledge as any).combat_skills) : []))
  const kn = (save.game_knowledge as any)?.combat_skills
  if (Array.isArray(kn)) kn.forEach((k: string) => known.add(k))
  const dungeonsUnlocked: string[] = ((save.game_knowledge as any)?.dungeons_unlocked ?? []).filter((d: unknown) => typeof d === "string")

  // a dungeon counts as walked when a living hero's history or the progression record names it
  const visited = new Set<string>(Object.keys((save.progression as any)?.dungeon ?? {}))
  for (const h of heroes) h.dungeons.forEach((d) => visited.add(d))
  // the levels walked in each dungeon, from every expedition the campaign log records
  const walkedLevels = new Map<string, Set<number>>()
  const scan = (o: any) => {
    if (!o || typeof o !== "object") return
    if (typeof o.dungeon_type === "string" && typeof o.difficulty === "number") {
      if (!walkedLevels.has(o.dungeon_type)) walkedLevels.set(o.dungeon_type, new Set())
      walkedLevels.get(o.dungeon_type)!.add(o.difficulty)
      visited.add(o.dungeon_type)
    }
    for (const v of Object.values(o)) scan(v)
  }
  scan(save.campaign_log)
  // a monster is known when it lives in a dungeon level you have walked and one of its attacks has struck you;
  // attack ids are shared across tiers (Bone Soldier, Bone Veteran), so the walked level is what tells them apart
  const knownVariants = new Set<string>()
  for (const [d, levels] of walkedLevels) for (const lvl of levels) for (const v of await dungeonMonsters(d, lvl)) {
    const m = await monster(v)
    if (m && m.skills.some((s) => known.has(s))) knownVariants.add(v)
  }

  const quests: Quest[] = []
  let idx = 0
  for (const q of Object.values<any>((save.quest as any)?.quests ?? {})) {
    idx++
    const variants = await dungeonMonsters(q.dungeon, q.difficulty, ["hall", "room"])
    const seen = new Map<string, string>(), types = new Set<string>(), bleeders = new Set<string>(), blighters = new Set<string>()
    const unknown = new Set<string>(), unknownTypes = new Set<string>()
    for (const v of variants) {
      const m = await monster(v)
      if (!m) continue
      if (knownVariants.has(v) && (walkedLevels.has(q.dungeon) || visited.has(q.dungeon))) {
        const n = await nameOf("monster", m.id)
        seen.set(m.id, n); types.add(m.type)
        // only the attacks you have suffered say what they do to you
        for (const s of m.skills.filter((s) => known.has(s))) {
          const fx = (m.effects.get(s) ?? []).join(" ")
          if (/bleed/i.test(fx)) bleeders.add(n)
          if (/blight|poison/i.test(fx)) blighters.add(n)
        }
      } else { unknown.add(m.base); if (m.type) unknownTypes.add(m.type) }
    }
    const rewards: string[] = []
    for (const it of Object.values<any>(q.completion_reward?.items_definition?.items ?? {})) {
      if (it.type === "gold") rewards.push(`${it.amount} gold`)
      else if (it.type === "heirloom") rewards.push(`${it.amount} ${it.id}${it.amount > 1 ? "s" : ""}`)
      else if (it.type === "trinket") rewards.push(await nameOf("trinket", it.id))
    }
    quests.push({
      unknownTypes: [...unknownTypes], bleeders: [...bleeders], blighters: [...blighters], walked: visited.has(q.dungeon), idx, dungeon: q.dungeon, dungeonName: await nameOf("dungeon", q.dungeon), type: q.type, difficulty: q.difficulty,
      length: q.length, plot: !!q.is_plot_quest, rewards, known: [...new Set(seen.values())], unknownCount: unknown.size, types: [...types],
    })
  }

  // Guild and Blacksmith discounts: each "cost" upgrade bought takes its listed percent off, summed
  const discount = async (b: string, key: string) => {
    const list = (await buildingData(b)).data[key] ?? []
    return list.filter((e: any) => bought.has(`${e.upgrade_tree_id}:${e.upgrade_requirement_code}`)).reduce((a: number, e: any) => a + e.discount_percent, 0)
  }
  const skillDiscount = await discount("guild", "combat_skill_cost_discount_upgrades")
  const gearDiscount = await discount("blacksmith", "equipment_cost_discount_upgrades")

  // upgrades a hero could buy next: the first unbought code of each tree they own
  const heroUpgrades: Upgrade[] = []
  for (const h of heroes) {
    const trees = await heroTrees(h.cls)
    const mine = heroBought.get(h.guid) ?? new Set()
    const owned = [...h.skills.map((s) => `${h.cls}.${s.id}`), `${h.cls}.weapon`, `${h.cls}.armour`]
    for (const id of owned) {
      const reqs = trees.get(id)
      if (!reqs) continue
      const next = reqs.find((r) => !mine.has(`${id}:${r.code}`))
      if (!next) continue
      const missing = next.pre.filter((p) => !(p.tree.startsWith(h.cls) ? mine : bought).has(`${p.tree}:${p.code}`) && !(p.tree === id))
      const lvlBlock = h.level < next.resolve ? `needs resolve level ${next.resolve}` : ""
      const preBlock = missing.length ? `needs ${missing.map((m) => `${m.tree} ${m.code}`).join(", ")}` : ""
      const kind = id.endsWith(".weapon") ? "weapon" : id.endsWith(".armour") ? "armour" : "skill"
      const off = kind === "skill" ? skillDiscount : gearDiscount
      const cost = next.cost.map((c) => c.type === "gold" ? { type: "gold", amount: Math.round(c.amount * (1 - off)) } : c)
      const gold = cost.find((c) => c.type === "gold")?.amount ?? 0
      // weapon and armour trees start at level 2 ("first_level_not_upgrade"); a skill's code n buys level n+1
      const toLevel = Number(next.code) + (kind === "skill" ? 1 : 2)
      const label = kind === "skill" ? await nameOf("skill", id.split(".")[1]!, h.cls) : kind === "weapon" ? "Weapon" : "Armour"
      heroUpgrades.push({ hero: h.name, tree: id, label, code: next.code, toLevel, where: kind === "skill" ? "Guild" : "Blacksmith", cost, affordable: gold <= (wallet.gold ?? 0), blockedBy: lvlBlock || preBlock })
    }
  }
  const buildingUpgrades: Upgrade[] = []
  for (const b of ["abbey", "tavern", "sanitarium", "blacksmith", "guild", "stage_coach", "nomad_wagon", "camping_trainer"]) {
    for (const [id, reqs] of await buildingTrees(b)) {
      const next = reqs.find((r) => !bought.has(`${id}:${r.code}`))
      if (!next) continue
      const affordable = next.cost.every((c) => c.amount <= (wallet[c.type] ?? 0))
      buildingUpgrades.push({ tree: id, label: `${await nameOf("building", b)}: ${id.split(".")[1]!.replace(/_/g, " ")}`, code: next.code, cost: next.cost.filter((c) => c.amount > 0), affordable, blockedBy: "" })
    }
  }

  const lib = await trinkets()
  const estateTrinkets = []
  for (const t of Object.values<any>((save.estate as any)?.trinkets?.items ?? {})) {
    estateTrinkets.push({ id: t.id, name: await nameOf("trinket", t.id), classes: lib.get(t.id)?.classes ?? [] })
  }

  const g = save.game as any, prog = save.progression as any
  return {
    week: (save.campaign_log as any)?.total_weeks ?? 0, inRaid: !!g?.inraid, raidDungeon: typeof g?.raiddungeon === "string" ? g.raiddungeon : "",
    estate: g?.estatename ?? "", wallet, heroes, recruits, rosterSize: heroes.length, rosterCap,
    activities, quests, witnessedSkills: known.size, dungeonsUnlocked,
    quests_done: prog?.total_quests_finished ?? 0, quests_won: prog?.total_successful_quests_finished ?? 0,
    lastQuest: typeof prog?.last_quest_played_id === "string" ? prog.last_quest_played_id : "", lastWon: !!prog?.last_raid_success,
    skillDiscount, gearDiscount, visited: [...visited], knownVariants: [...knownVariants],
    heroUpgrades, buildingUpgrades, estateTrinkets, bought, supply: await supplies(),
  }
}

export { LENGTH, DIFFICULTY }
