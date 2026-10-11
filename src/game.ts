// The game's own declared data, read from the install: every number the advisor prints comes from here
// or from the save (ISA A2). Each loader names the file it reads so a board can cite it (C14).
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { install } from "./paths.ts"

export const P = {
  quirks: "shared/quirk/quirk_library.json",
  rosterVars: "campaign/roster/roster.variables.json",
  trinkets: "trinkets/base.entries.trinkets.json",
  trinketRarities: "trinkets/base.rarities.trinkets.json",
  heroInfo: (c: string) => `heroes/${c}/${c}.info.darkest`,
  heroUpgrades: (c: string) => `upgrades/heroes/${c}.upgrades.json`,
  buildingUpgrades: (b: string) => `upgrades/building/${b}.upgrades.json`,
  building: (b: string) => `campaign/town/buildings/${b}/${b}.building.json`,
  mash: (d: string, level: number) => `dungeons/${d}/${d}.${level}.mash.darkest`,
  portrait: (c: string) => `heroes/${c}/${c}_A/${c}_portrait_roster.png`,
  townEvents: "campaign/town_events/base.town_events.events.json",
  supplies: "inventory/base.supply.inventory.items.darkest",
  effects: "effects/base.effects.darkest",
}

const json = async (rel: string) => Bun.file(join(install, rel)).json()
export const text = async (rel: string) => Bun.file(join(install, rel)).text()

// ---------- English names ----------
let en: Map<string, string> | undefined
export async function strings(): Promise<Map<string, string>> {
  if (en) return en
  en = new Map()
  const dir = join(install, "localization")
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".string_table.xml"))) {
    const xml = await Bun.file(join(dir, f)).text()
    const start = xml.indexOf('<language id="english">')
    if (start < 0) continue
    const end = xml.indexOf("</language>", start)
    for (const m of xml.slice(start, end).matchAll(/<entry id="([^"]+)"><!\[CDATA\[([\s\S]*?)\]\]><\/entry>/g)) {
      if (!en.has(m[1]!)) en.set(m[1]!, m[2]!)
    }
  }
  return en
}
const titleCase = (id: string) => id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
export async function nameOf(kind: "quirk" | "class" | "trinket" | "dungeon" | "affliction" | "skill" | "monster" | "building" | "activity", id: string, cls = ""): Promise<string> {
  const s = await strings()
  const key = {
    quirk: `str_quirk_name_${id}`, class: `hero_class_name_${id}`, trinket: `str_inventory_title_trinket${id}`,
    dungeon: `dungeon_name_${id}`, affliction: `str_affliction_name_${id}`, skill: `combat_skill_name_${cls}_${id}`,
    monster: `str_monstername_${id}`, building: `town_name_${id}`, activity: `town_activity_name_${id}`,
  }[kind]
  return s.get(key) ?? s.get(`upgrade_tree_name_${cls}.${id}`) ?? titleCase(id)
}
export async function describeQuirk(id: string): Promise<string> {
  return (await strings()).get(`str_quirk_description_${id}`) ?? ""
}

// ---------- quirks ----------
export interface Quirk { id: string; positive: boolean; disease: boolean; classification: string; curioTag: string; keepLoot: boolean; treatable: boolean }
let quirkLib: Map<string, Quirk> | undefined
export async function quirks(): Promise<Map<string, Quirk>> {
  if (quirkLib) return quirkLib
  const lib = await json(P.quirks)
  quirkLib = new Map(lib.quirks.map((q: any) => [q.id, { id: q.id, positive: q.is_positive, disease: q.is_disease, classification: q.classification, curioTag: q.curio_tag, keepLoot: q.keep_loot, treatable: q.can_modify_in_activity !== false }]))
  return quirkLib
}

export async function levelThresholds(): Promise<number[]> {
  return (await json(P.rosterVars)).resolve_level_thresholds
}
export function levelOf(xp: number, thr: number[]): number {
  let lvl = 0
  thr.forEach((t, i) => { if (xp >= t) lvl = i })
  return lvl
}

// ---------- hero classes ----------
export interface Skill {
  id: string; launch: number[]; targetsAllies: boolean; heal: boolean; healAvg: number; stun: boolean; type: string
  // the enemy ranks it strikes (none for a skill on allies or on oneself), how far it moves its user back and forward,
  // and, from its effect lines, whether it marks a foe, hits a marked foe harder, bleeds or blights (C32 to C36)
  target: number[]; move: [number, number]; marks: boolean; onMarked: boolean; bleed: boolean; blight: boolean
}
export interface HeroClass { id: string; skills: Map<string, Skill>; tags: string[]; hp: number }
const classCache = new Map<string, HeroClass>()
// the game's named effects, one line each, keyed by name
let effectLib: Map<string, string> | undefined
export async function effect(name: string): Promise<string> {
  if (!effectLib) {
    effectLib = new Map()
    for (const line of (await text(P.effects)).split("\n")) { const n = line.match(/^effect: \.name "([^"]+)"/)?.[1]; if (n && !effectLib.has(n)) effectLib.set(n, line) }
  }
  return effectLib.get(name) ?? ""
}

export async function heroClass(id: string): Promise<HeroClass> {
  if (classCache.has(id)) return classCache.get(id)!
  const info = await text(P.heroInfo(id))
  const skills = new Map<string, Skill>()
  for (const line of info.split("\n")) {
    if (!line.startsWith("combat_skill:") || !line.includes(".level 0")) continue
    const sid = line.match(/\.id "([^"]+)"/)?.[1]
    if (!sid) continue
    const launch = (line.match(/\.launch (\d+)/)?.[1] ?? "").split("").map(Number)
    const target = line.match(/\.target (\S*)/)?.[1] ?? ""
    const fx = await Promise.all([...(line.match(/\.effect((?: "[^"]+")+)/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((e) => effect(e[1]!)))
    const mv = line.match(/\.move (\d+) (\d+)/)
    skills.set(sid, {
      target: target.startsWith("@") ? [] : target.replace(/\D/g, "").split("").map(Number).filter(Boolean),
      move: [Number(mv?.[1] ?? 0), Number(mv?.[2] ?? 0)],
      marks: fx.some((f) => /\.tag 1\b/.test(f) && /\.target "target"/.test(f)),
      onMarked: fx.some((f) => /\.keyStatus "tagged"/.test(f) && /\.target "performer"/.test(f)),
      bleed: fx.some((f) => /\.dotBleed \d/.test(f)), blight: fx.some((f) => /\.dotPoison \d/.test(f)),
      id: sid, launch, targetsAllies: target.startsWith("@"), heal: /\.heal \d/.test(line),
      // the hit points a heal restores at its first level, the mean of the file's .heal range (C30)
      healAvg: ((m) => (m ? (Number(m[1]) + Number(m[2])) / 2 : 0))(line.match(/\.heal (\d+) (\d+)/)),
      stun: /\.effect[^\n]*Stun/i.test(line), type: line.match(/\.type "([^"]+)"/)?.[1] ?? "support",
    })
  }
  const tags = [...info.matchAll(/^tag: \.id "([^"]+)"/gm)].map((m) => m[1]!)
  // base hit points: the first armour tier's .hp
  const hp = Number(info.match(/^armour: [^\n]*\.hp (\d+)/m)?.[1] ?? 0)
  const hc = { id, skills, tags, hp }
  classCache.set(id, hc)
  return hc
}

// ---------- upgrades ----------
export interface Cost { type: string; amount: number }
export interface Requirement { code: string; cost: Cost[]; pre: { tree: string; code: string }[]; resolve: number }
export async function heroTrees(cls: string): Promise<Map<string, Requirement[]>> {
  const j = await json(P.heroUpgrades(cls))
  return new Map(j.trees.map((t: any) => [t.id, t.requirements.map((r: any) => ({
    code: r.code, cost: r.currency_cost ?? [], resolve: r.prerequisite_resolve_level ?? 0,
    pre: (r.prerequisite_requirements ?? []).map((p: any) => ({ tree: p.tree_id, code: p.requirement_code })),
  }))]))
}
export async function buildingTrees(b: string): Promise<Map<string, Requirement[]>> {
  if (!existsSync(join(install, P.buildingUpgrades(b)))) return new Map()
  const j = await json(P.buildingUpgrades(b))
  return new Map(j.trees.map((t: any) => [t.id, t.requirements.map((r: any) => ({
    code: r.code, cost: r.currency_cost ?? [], resolve: 0,
    pre: (r.prerequisite_requirements ?? []).map((p: any) => ({ tree: p.tree_id, code: p.requirement_code })),
  }))]))
}
export async function buildingData(b: string): Promise<any> {
  return json(P.building(b))
}

/** The entry of a building's upgrade list that applies, given what has been purchased. */
export function applied<T extends { upgrade_requirement_code?: string; upgrade_tree_id?: string }>(list: T[], defaultTree: string, bought: Set<string>): T {
  let cur = list[0]!
  for (const e of list) {
    if (!e.upgrade_requirement_code || bought.has(`${e.upgrade_tree_id ?? defaultTree}:${e.upgrade_requirement_code}`)) cur = e
  }
  return cur
}

// ---------- trinkets ----------
export interface Trinket { id: string; buffs: string[]; classes: string[]; rarity: string; origin: string; rank: number }
let trinketLib: Map<string, Trinket> | undefined
export async function trinkets(): Promise<Map<string, Trinket>> {
  if (trinketLib) return trinketLib
  const j = await json(P.trinkets)
  // the game lists its rarities rarest first; a trinket's place in that list is its rank (lower is rarer)
  const order: string[] = (await json(P.trinketRarities)).rarities.map((r: any) => r.id)
  trinketLib = new Map(j.entries.map((t: any) => [t.id, { id: t.id, buffs: t.buffs, classes: t.hero_class_requirements, rarity: t.rarity, origin: t.origin_dungeon, rank: order.includes(t.rarity) ? order.indexOf(t.rarity) : order.length }]))
  return trinketLib
}

// ---------- monsters ----------
export interface Monster { id: string; base: string; type: string; skills: string[]; effects: Map<string, string[]>; dmg: Map<string, [number, number]>; multi: Set<string>; bleedResist: number; blightResist: number }
const monsterCache = new Map<string, Monster>()
export async function monster(variant: string): Promise<Monster | undefined> {
  if (monsterCache.has(variant)) return monsterCache.get(variant)
  const base = variant.replace(/_[A-Z]$/, "")
  const rel = `monsters/${base}/${variant}/${variant}.info.darkest`
  if (!existsSync(join(install, rel))) return undefined
  const info = await text(rel)
  const m = {
    id: variant, base, type: info.match(/^enemy_type: \.id "([^"]+)"/m)?.[1] ?? "",
    bleedResist: Number(info.match(/^stats:[^\n]*\.bleed_resist (\d+)/m)?.[1] ?? 0) / 100,
    blightResist: Number(info.match(/^stats:[^\n]*\.poison_resist (\d+)/m)?.[1] ?? 0) / 100,
    skills: [...info.matchAll(/^skill: \.id "([^"]+)"/gm)].map((x) => x[1]!),
    // each skill's named effects ("Minor Bleed 1", "Blight 2"), for what a supply counters
    effects: new Map([...info.matchAll(/^skill: \.id "([^"]+)"([^\n]*)/gm)].map((x) => [x[1]!, [...(x[2]!.match(/\.effect((?: "[^"]+")+)/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((e) => e[1]!)])),
    // each skill's damage range, for telling which attack dealt a blow
    dmg: new Map([...info.matchAll(/^skill: \.id "([^"]+)"[^\n]*?\.dmg (\d+) (\d+)/gm)].map((x) => [x[1]!, [Number(x[2]), Number(x[3])] as [number, number]])),
    // skills that strike several ranks at once (a target written with ~)
    multi: new Set([...info.matchAll(/^skill: \.id "([^"]+)"[^\n]*?\.target ~/gm)].map((x) => x[1]!)),
  }
  monsterCache.set(variant, m)
  return m
}

/** Monster variants a dungeon fields at a quest level. `kinds` limits to line kinds (hall, room, boss, named, stall). */
export async function dungeonMonsters(d: string, level: number, kinds?: string[]): Promise<string[]> {
  const rel = P.mash(d, level)
  if (!existsSync(join(install, rel))) return []
  const out = new Set<string>()
  for (const m of (await text(rel)).matchAll(/^(\w+):[^\n]*?\.types ([^\n]+)/gm)) {
    if (kinds && !kinds.includes(m[1]!)) continue
    for (const t of m[2]!.trim().split(/\s+/)) out.add(t)
  }
  return [...out]
}

// ---------- town events ----------
export interface TownEventDef { id: string; data: { type: string; string_data: string; number_data: number }[] }
let eventLib: Map<string, TownEventDef> | undefined
export async function townEvents(): Promise<Map<string, TownEventDef>> {
  if (eventLib) return eventLib
  eventLib = new Map((await json(P.townEvents)).events.map((e: any) => [e.id, { id: e.id, data: e.data ?? [] }]))
  return eventLib
}

// ---------- the Provisioner's prices ----------
/** Purchase price in gold of each item the Provisioner sells: "provision" is food, the rest are supply ids (torch, shovel...). */
export async function supplyPrices(): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (const m of (await text(P.supplies)).matchAll(/\.type\s+"(\w+)"\s+\.id\s+"(\w*)".*?\.purchase_gold_value\s+(\d+)/g)) out.set(m[2] || m[1]!, Number(m[3]))
  return out
}
