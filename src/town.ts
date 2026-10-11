// The Hamlet as the save describes it, and the Caretaker's reading of it. Pure derivation: every figure
// is a save field or a game-file value, and every piece of advice carries the paths it came from (C14).
import type { Dson } from "./dson.ts"
import type { Save } from "./read.ts"
import type { Lesson } from "./chronicle.ts"
import {
  P, applied, buildingData, buildingTrees, describeQuirk, dungeonMonsters, heroClass, heroTrees, levelOf, levelThresholds,
  monster, nameOf, quirks, strings, townEvents, trinkets, type Cost, type Monster,
  campingSkills, questGoal } from "./game.ts"

const raw = (h: any) => h.hero_file_data?.raw_data ?? h

export interface QuirkView { id: string; name: string; positive: boolean; disease: boolean; locked: boolean; description: string; thief: boolean; treatable: boolean }
export interface HeroView {
  guid: number; name: string; cls: string; clsName: string; level: number; xp: number; stress: number
  affliction: string; busy: string; quirks: QuirkView[]; skills: { id: string; name: string; level: number }[]
  // every combat skill the hero has learned, equipped or not: the equipped four plus every skill tree with a purchase (C34)
  learned?: { id: string; name: string }[]
  // camping skills: the ones taken to camp, and every one learned (the taken plus each bought at the Survivalist)
  campEquipped?: string[]; campKnown?: string[]
  weapon: number; armour: number; trinkets: string[]; dungeons: string[]; portrait: string
  from?: string // the town event that brought a recruit
}
export interface Activity { building: string; buildingName: string; activity: string; name: string; locked: boolean; baseCost: number; cost: number; lockedQuirkCost?: number; heal: number; cure: number; slots: number; used: number; barred: string[] }
export interface Quest { foeResist?: { bleed: number; blight: number; foes: number }; unknownTypes: string[]; bleeders: string[]; blighters: string[]; walked: boolean; idx: number; dungeon: string; dungeonName: string; type: string; goal: string; difficulty: number; length: number; plot: boolean; rewards: string[]; known: string[]; unknownCount: number; types: string[] }
export interface Upgrade { hero?: string; toLevel?: number; where?: string; tree: string; label: string; code: string; cost: Cost[]; affordable: boolean; blockedBy: string }
export interface Town {
  week: number; inRaid: boolean; raidDungeon: string; estate: string
  wallet: Record<string, number>; heroes: HeroView[]; fallen: HeroView[]; recruits: HeroView[]; rosterSize: number; rosterCap: number
  activities: Activity[]; quests: Quest[]; witnessedSkills: number; dungeonsUnlocked: string[]
  quests_done: number; quests_won: number; lastQuest: string; lastWon: boolean
  // the expedition the coach just brought back, as the campaign log's latest chapter records it (C37)
  trips: { dungeon: string; difficulty: number }[] // every expedition the campaign log records
  ledger?: Lesson[] // the lessons kept from past expeditions (C42), loaded by the board before it advises
  back?: { dungeon: string; dungeonName: string; quest: string; length: number; success: boolean; heroes: { guid: number; name: string; cls: string; died: boolean }[] }
  skillDiscount: number; gearDiscount: number; campDiscount: number; visited: string[]; knownVariants: string[]
  heroUpgrades: Upgrade[]; buildingUpgrades: Upgrade[]; estateTrinkets: { id: string; name: string; classes: string[]; rank: number }[]
  worn: Record<string, { id: string; name: string; rank: number }[]>; trinketSlots: number
  bought: Set<string>
  /** every purchase with the hero it was bought for (0 for a building), from persist.upgrades.json instance_number (C26) */
  purchases: { key: string; guid: number }[]
  supply: Record<string, string>
  event?: TownEvent
  raid?: Raid
}
/** The expedition under way: a key that names it (one farewell per expedition), its quest, the party front to back, what it carries. */
export interface Raid { key: string; quest: Quest; party: number[]; carried: Record<string, number> }
/** This week's town event, as the game rolled it: its own title and text, and what it changes, in the game's own effect lines. */
export interface TownEvent { id: string; title: string; description: string; lines: string[]; provisions: { item: string; cost: number; amount: number }[] }

async function supplies(): Promise<Record<string, string>> {
  const s = await strings()
  const out: Record<string, string> = { provision: s.get("str_inventory_description_provision") ?? "" }
  for (const k of ["torch", "shovel", "bandage", "antivenom", "firewood", "holy_water", "skeleton_key", "medicinal_herbs", "laudanum"]) out[k] = s.get(`str_inventory_description_supply${k}`) ?? ""
  return out
}

// building upgrade trees in the Hamlet's words; the activity trees (abbey.meditation...) are named by their activity
const TREE_WORDS: Record<string, string> = {
  cost: "lower prices", disease_quirk_cost: "cheaper cures for disease", slots: "more beds", weapon: "better weapons", armour: "better armour",
  skill_levels: "higher teachings", numrecruits: "more recruits each week", rostersize: "a larger roster", upgraded_recruits: "seasoned recruits", numitems: "more wares",
}
const titleWord = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)
const LENGTH = ["", "Short", "Medium", "Long"]
const DIFFICULTY: Record<number, string> = { 1: "Apprentice", 3: "Veteran", 5: "Champion", 6: "Darkest" }

async function heroView(guid: number, h: any, thr: number[], busy: Map<number, string>): Promise<HeroView> {
  const r = raw(h)
  const lib = await quirks()
  const qs: QuirkView[] = []
  for (const [id, q] of Object.entries<any>(r.quirks ?? {})) {
    const d = lib.get(id)
    qs.push({ id, name: await nameOf("quirk", id), positive: !!d?.positive, disease: !!d?.disease, locked: !!q.is_locked, description: await describeQuirk(id), thief: !!d?.keepLoot, treatable: d?.treatable !== false })
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
    campEquipped: Object.keys(r.skills?.selected_camping_skills ?? {}),
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
      // a locked quirk costs the Treatment Ward more: its own list, permanent_negative_quirk_cost_upgrades (C25)
      const lockedCost = d.permanent_negative_quirk_cost_upgrades ? (applied(d.permanent_negative_quirk_cost_upgrades, tree, bought) as any)?.cost_currency?.amount : undefined
      const heal = d.stress_upgrades ? applied(d.stress_upgrades, tree, bought) as any : undefined
      const slot = d.slot_upgrades ? applied(d.slot_upgrades, slotTree, bought) as any : { number_of_slots: 0 }
      const cure = d.affliction_cure_upgrades ? (applied(d.affliction_cure_upgrades, tree, bought) as any).chance ?? 0 : 0
      const barred = (d.requirements ?? []).filter((r: any) => r.type === "not_have_quirks").flatMap((r: any) => r.data.quirk_library_names)
      activities.push({
        building: b, buildingName: await nameOf("building", b), activity: a.id, name: await nameOf("activity", a.id), locked: false,
        baseCost: cost?.cost_currency?.amount ?? 0, cost: cost?.cost_currency?.amount ?? 0, lockedQuirkCost: lockedCost,
        heal: heal?.heal_high ?? 0, cure, slots: slot.number_of_slots ?? 0, used, barred,
      })
    }
  }

  // this week's town event (persist.town_event.json), active when the week's own log chapter records it
  const te = save.town_event as any
  const chapters = Object.values<any>((save.campaign_log as any)?.chapters ?? {})
  const thisWeek = chapters.length ? Object.values<any>(chapters[chapters.length - 1]).find((x) => x && typeof x === "object" && "town_event_result_id" in x)?.town_event_result_id : undefined
  const trip = chapters.length ? Object.values<any>(chapters[chapters.length - 1]).find((x) => x && typeof x === "object" && x.heroes && typeof x.dungeon_type === "string") : undefined
  const trips = chapters.flatMap((c) => Object.values<any>(c).filter((x) => x && typeof x === "object" && x.heroes && typeof x.dungeon_type === "string").map((x) => ({ dungeon: String(x.dungeon_type), difficulty: Number(x.difficulty ?? 0) })))
  const back = trip ? {
    dungeon: trip.dungeon_type, dungeonName: await nameOf("dungeon", trip.dungeon_type), quest: String(trip.quest ?? ""), length: Number(trip.length ?? 0), success: !!trip.success,
    heroes: Object.values<any>(trip.heroes).map((h) => ({ guid: Number(h.guid), name: String(h.name), cls: String(h.class), died: !!h.died })),
  } : undefined
  let event: TownEvent | undefined
  if (te?.current_result_event_id && te.current_result_event_id === thisWeek) {
    const id: string = te.current_result_event_id
    const s = await strings()
    const def = (await townEvents()).get(id)
    const pct = (n: number) => Math.round(n * 100)
    const fmt = (key: string, ...args: (string | number)[]) => {
      let i = 0
      return (s.get(`town_event_info_format_${key}`) ?? "").replace(/\{\?[a-z_]+\}/g, "").replace(/%%/g, "\u0000").replace(/%[sd]/g, () => String(args[i++] ?? "")).replace(/\u0000/g, "%")
    }
    const ITEM: Record<string, string> = { supply: "Supplies", provision: "Food" }
    const lines: string[] = [], provisions: TownEvent["provisions"] = []
    if (s.get(`town_event_info_${id}`)) lines.push(s.get(`town_event_info_${id}`)!)
    for (const d of def?.data ?? []) {
      const act = activities.find((a) => a.activity === d.string_data)
      if (d.type === "activity_lock" && act) { act.locked = true; lines.push(fmt(d.type, act.name)) }
      else if (d.type === "activity_cost_change" && act) { act.cost = Math.round(act.baseCost * (1 + d.number_data)); if (act.lockedQuirkCost) act.lockedQuirkCost = Math.round(act.lockedQuirkCost * (1 + d.number_data)); lines.push(fmt(d.type, act.name, pct(d.number_data))) }
      else if (d.type === "free_activity" && act) { act.cost = 0; if (act.lockedQuirkCost !== undefined) act.lockedQuirkCost = 0; if (!s.get(`town_event_info_${id}`)) lines.push(fmt(d.type, act.name)) }
      else if (d.type === "provision_item_type_cost_change") { provisions.push({ item: d.string_data, cost: d.number_data, amount: 0 }); lines.push(fmt(d.type, ITEM[d.string_data] ?? d.string_data, pct(d.number_data))) }
      else if (d.type === "provision_item_type_amount_change") { provisions.push({ item: d.string_data, cost: 0, amount: d.number_data }); lines.push(fmt(d.type, ITEM[d.string_data] ?? d.string_data, pct(d.number_data))) }
      else if (d.type === "idle_resolve_level") lines.push(fmt(d.type, await nameOf("class", d.string_data), d.number_data))
      else if (d.type === "upgrade_tag_free") lines.push(fmt(d.type, titleWord(d.string_data), d.number_data))
      else if (d.type === "upgrade_tag_discount") lines.push(fmt(d.type, titleWord(d.string_data), pct(d.number_data)))
      else if (d.type === "trinket_retention_add_from_storage") lines.push(fmt(d.type, d.number_data))
    }
    event = { id, title: s.get(`town_event_title_${id}`) ?? id, description: s.get(`town_event_description_${id}`) ?? "", lines: [...new Set(lines.filter(Boolean))], provisions }
  }

  // the roster file keeps the fallen: a hero the campaign log records as died is mourned, never advised
  const died = new Set<number>()
  const deaths = (o: any): void => { if (o && typeof o === "object") { if (o.died === true && typeof o.guid === "number") died.add(o.guid); Object.values(o).forEach(deaths) } }
  deaths(save.campaign_log)
  const heroes: HeroView[] = [], fallen: HeroView[] = []
  for (const [g, h] of Object.entries<any>((save.roster as any)?.heroes ?? {})) (died.has(Number(g)) ? fallen : heroes).push(await heroView(Number(g), h, thr, busy))
  for (const h of heroes) {
    const combat = (await heroClass(h.cls)).skills, mine = heroBought.get(h.guid) ?? new Set<string>()
    const ids = new Set([...h.skills.map((s) => s.id), ...[...mine].map((k) => k.split(":")[0]!).filter((t) => t.startsWith(`${h.cls}.`)).map((t) => t.slice(h.cls.length + 1)).filter((id) => combat.has(id))])
    h.learned = await Promise.all([...ids].map(async (id) => ({ id, name: h.skills.find((s) => s.id === id)?.name ?? (await nameOf("skill", id, h.cls)) })))
    const camp = await campingSkills()
    h.campKnown = [...new Set([...(h.campEquipped ?? []), ...[...mine].map((k) => k.split(":")[0]!).filter((t) => t.startsWith(`${h.cls}.`)).map((t) => t.slice(h.cls.length + 1)).filter((id) => camp.has(id))])]
  }
  const recruits: HeroView[] = []
  for (const [g, h] of Object.entries<any>(tb.stage_coach?.store?.hero_recruit?.generated ?? {})) recruits.push(await heroView(Number(g), h, thr, new Map()))
  // a town event's bonus recruits wait at the coach beside the usual offer
  if (event) for (const [g, h] of Object.entries<any>(te.bonus_hero_entries ?? {})) recruits.push({ ...(await heroView(Number(g), h, thr, new Map())), from: event.title })

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
  for (const h of [...heroes, ...fallen]) h.dungeons.forEach((d) => visited.add(d))
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

  const g0 = save.game as any
  const quests: Quest[] = []
  let idx = 0
  const view = async (q: any, idx: number): Promise<Quest> => {
    const variants = await dungeonMonsters(q.dungeon, q.difficulty, ["hall", "room"])
    const seen = new Map<string, string>(), types = new Set<string>(), bleeders = new Set<string>(), blighters = new Set<string>()
    const unknown = new Set<string>(), unknownTypes = new Set<string>(), met: Monster[] = []
    for (const v of variants) {
      const m = await monster(v)
      if (!m) continue
      if (knownVariants.has(v) && (walkedLevels.has(q.dungeon) || visited.has(q.dungeon))) {
        const n = await nameOf("monster", m.id)
        seen.set(m.id, n); types.add(m.type); met.push(m)
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
    // how well the foes you have met on this road resist bleed and blight, on average (C36); nothing is said of the rest
    const avg = (k: "bleedResist" | "blightResist") => (met.length ? met.reduce((a, m) => a + m[k], 0) / met.length : 0)
    return {
      foeResist: { bleed: avg("bleedResist"), blight: avg("blightResist"), foes: met.length },
      unknownTypes: [...unknownTypes], bleeders: [...bleeders], blighters: [...blighters], walked: visited.has(q.dungeon), idx, dungeon: q.dungeon, dungeonName: await nameOf("dungeon", q.dungeon), type: q.type, goal: await questGoal(q.type, q.dungeon, Number(q.length ?? 0)), difficulty: q.difficulty,
      length: q.length, plot: !!q.is_plot_quest, rewards, known: [...new Set(seen.values())], unknownCount: unknown.size, types: [...types],
    }
  }
  for (const q of Object.values<any>((save.quest as any)?.quests ?? {})) quests.push(await view(q, ++idx))

  // the expedition under way (persist.raid.json, written once the party has left): where, who front to back, what they carry
  let raid: Raid | undefined
  const ri = (save.raid as any)?.raid_instance, rp = (save.raid as any)?.party
  if (g0?.inraid && ri && rp) {
    const carried: Record<string, number> = {}
    for (const it of Object.values<any>(rp.inventory?.items ?? {})) { const k = it.type === "provision" ? "provision" : it.id || it.type; carried[k] = (carried[k] ?? 0) + (it.amount ?? 0) }
    raid = { key: `${ri.id}:${(save.raid as any).start_elapsed_time ?? ""}`, quest: await view(ri, 0), party: (rp.heroes ?? []).filter((x: unknown) => typeof x === "number"), carried }
  }

  // Guild and Blacksmith discounts: each "cost" upgrade bought takes its listed percent off, summed
  const discount = async (b: string, key: string) => {
    const list = (await buildingData(b)).data[key] ?? []
    return list.filter((e: any) => bought.has(`${e.upgrade_tree_id}:${e.upgrade_requirement_code}`)).reduce((a: number, e: any) => a + e.discount_percent, 0)
  }
  const skillDiscount = await discount("guild", "combat_skill_cost_discount_upgrades")
  const gearDiscount = await discount("blacksmith", "equipment_cost_discount_upgrades")
  const campDiscount = await discount("camping_trainer", "camping_skill_cost_discount_upgrades")

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
      const part = id.split(".")[1]!
      const what = TREE_WORDS[part] ?? `${await nameOf("activity", part)}, improved`
      buildingUpgrades.push({ tree: id, label: `${await nameOf("building", b)}: ${what}`, code: next.code, cost: next.cost.filter((c) => c.amount > 0), affordable, blockedBy: "" })
    }
  }

  const lib = await trinkets()
  const estateTrinkets = []
  for (const t of Object.values<any>((save.estate as any)?.trinkets?.items ?? {})) {
    estateTrinkets.push({ id: t.id, name: await nameOf("trinket", t.id), classes: lib.get(t.id)?.classes ?? [], rank: lib.get(t.id)?.rank ?? 99 })
  }
  // what each hero wears, and how many a hero can wear: the most any hero on the roster wears now
  const worn: Record<string, { id: string; name: string; rank: number }[]> = {}
  for (const h of heroes) worn[h.guid] = await Promise.all(h.trinkets.map(async (id) => ({ id, name: await nameOf("trinket", id), rank: lib.get(id)?.rank ?? 99 })))
  const trinketSlots = Math.max(1, ...heroes.map((h) => h.trinkets.length))

  const g = g0, prog = save.progression as any
  return {
    week: (save.campaign_log as any)?.total_weeks ?? 0, inRaid: !!g?.inraid, raidDungeon: typeof g?.raiddungeon === "string" ? g.raiddungeon : "",
    estate: g?.estatename ?? "", wallet, heroes, fallen, recruits, rosterSize: heroes.length, rosterCap,
    activities, quests, witnessedSkills: known.size, dungeonsUnlocked,
    quests_done: prog?.total_quests_finished ?? 0, quests_won: prog?.total_successful_quests_finished ?? 0,
    lastQuest: typeof prog?.last_quest_played_id === "string" ? prog.last_quest_played_id : "", lastWon: !!prog?.last_raid_success, back, trips,
    skillDiscount, gearDiscount, campDiscount, visited: [...visited], knownVariants: [...knownVariants],
    heroUpgrades, buildingUpgrades, estateTrinkets, worn, trinketSlots, bought, supply: await supplies(), event, raid,
    purchases: Object.values<any>((save.upgrades as any)?.purchases ?? {}).filter((p) => p.is_purchased !== false).map((p) => ({ key: `${p.tree_id}:${p.requirement_code}`, guid: Number(p.instance_number) || 0 })),
  }
}

export { LENGTH, DIFFICULTY }
