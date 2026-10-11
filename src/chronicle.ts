// The expedition's chronicle (C39 to C42): what the party lived through, kept from each save made in a dungeon, because the
// game deletes its own record (persist.raid.json) when the coach comes home. From it: the survivors' tale, what went well and
// what went wrong, and a ledger of lessons that outlives the trip. Writes only under .local/town (ISA A1).
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { outDir } from "./board.ts"
import { monster, nameOf, strings, text } from "./game.ts"
import type { Save } from "./read.ts"
import { mapOf, type MapView } from "./map.ts"

// RULE: my own reading of a trip, not the game's numbers (ISA A2)
export const CHRONICLE_RULE = {
  darkTorch: 50, // RULE: below this light I count the party as walking in the dark
  stressSpike: 25, // RULE: this much stress between two saves is a blow worth telling
  lessonTorches: 2, // RULE: torches a light lesson adds on its dungeon
  lessonFood: 2, // RULE: food a hunger lesson adds on its dungeon
  untriedMargin: 1, // RULE: one more torch and food on a road harder than any in the ledger
}

export interface SnapHero { guid: number; name: string; cls: string; hp: number; maxHp: number; stress: number; affliction: string; virtue: string; deathsDoor: boolean; lastBlow: string
  // what the fight left on the hero: the foe class that last struck, turns taken, stun, effects (buffs, marks, damage over time) as the game keeps them
  blowCls?: string; turns?: number; stunned?: boolean; effects?: string[]; dots?: string[] }
export interface Snap {
  at: string; dungeon: string; difficulty: number; length: number; quest: string; key: string
  torch: number; inBattle: boolean; supplies: Record<string, number>; narrated?: string[]
  tally: Record<string, number> // the game's own counts: ROOM_VISITED, BATTLE_COMPLETED, AMBUSHED, CURIO_INVESTIGATED, ...
  heroes: SnapHero[]
  // the fight under way, as the game keeps it (raid.battle): the round, and the foes in rank order with their health and who last struck them
  battle?: { round: number; foes: { name: string; hp: number; hitBy: string; guid?: number; cls?: string; turns?: number; stunned?: boolean; effects?: string[]; dots?: string[] }[]; acted?: string[] }
  known?: string[] // every attack the party has witnessed, the boundary for naming one (C5)
  map?: MapView // where the party stands and what it knows of each room and corridor (C51)
}

// an actor's state in a fight: turns taken, stun, each buff or mark with who laid it, each damage over time
function fx(a: any) {
  const effects = Object.values<any>(a?.buff_group ?? {}).map((b) => {
    // the game keeps damage over time as buffs: stat 4 is blight, stat 5 bleed, their amount the damage each round
    // (read against base.effects.darkest: "Blight 1" deals 2 for 3 rounds, and stat 4 amount 2 counted down 3, 2, 1)
    const what = b.id || [b.stat_sub_type, b.ruledata_string].filter(Boolean).join(" vs ") || (b.stat_type === 4 ? "blight" : b.stat_type === 5 ? "bleed" : `stat ${b.stat_type}`)
    const src = typeof b.source_class_id === "string" ? ` from ${b.source_class_id}` : ""
    return `${what} ${Math.round(Number(b.amount) * 100) / 100}${b.duration > 0 ? ` (${b.duration})` : ""}${src}`
  })
  const dots = Object.entries<any>(a?.actor_dot ?? {}).map(([k, v]) => `${k} ${JSON.stringify(v)}`)
  return { turns: Number(a?.performing_turn ?? 0), stunned: !!a?.stunned, effects, dots }
}

// DSON keeps some floats as their raw bits
const f32 = (n: unknown) => {
  const v = Number(n ?? 0)
  if (!Number.isInteger(v) || Math.abs(v) < 1e6) return v
  const b = new DataView(new ArrayBuffer(4)); b.setInt32(0, v); return b.getFloat32(0)
}
const hpCache = new Map<string, number>()
async function maxHp(cls: string, armour: number): Promise<number> {
  const k = `${cls}:${armour}`
  if (!hpCache.has(k)) {
    const m = (await text(`heroes/${cls}/${cls}.info.darkest`)).match(new RegExp(`^armour: \\.name "${cls}_armour_${armour}"[^\\n]*\\.hp (\\d+)`, "m"))
    hpCache.set(k, Number(m?.[1] ?? 0))
  }
  return hpCache.get(k)!
}

/** The party as one dungeon save shows it. Undefined outside a dungeon. */
export async function snapshot(save: Save): Promise<Snap | undefined> {
  const r = save.raid as any, g = save.game as any
  if (!r?.raid_instance || !g?.inraid) return undefined
  const ri = r.raid_instance, party: number[] = (r.party?.heroes ?? []).filter((x: unknown) => typeof x === "number")
  const roster = (save.roster as any)?.heroes ?? {}
  const supplies: Record<string, number> = {}
  for (const it of Object.values<any>(r.party?.inventory?.items ?? {})) { const k = it.type === "provision" ? "food" : it.type === "journal_page" ? `journal page ${it.id}` : it.id || it.type; supplies[k] = (supplies[k] ?? 0) + (it.amount ?? 0) }
  const tally: Record<string, number> = {}
  for (const [k, v] of Object.entries<any>(r.stat_database ?? {})) if (k !== "UNDEFINED") tally[k] = Number(v?.count ?? 0)
  const heroes: SnapHero[] = []
  for (const guid of party) {
    const h = roster[guid]?.hero_file_data?.raw_data ?? roster[guid]
    if (!h) continue
    const blow = typeof h.actor?.damage_source_data === "string" ? h.actor.damage_source_data : ""
    heroes.push({
      guid, name: h.actor?.name ?? `#${guid}`, cls: h.heroClass, hp: Math.max(0, f32(h.actor?.current_hp)), maxHp: await maxHp(h.heroClass, h.armour_rank ?? 0),
      stress: Math.round(f32(h.m_Stress)), affliction: h.affliction_type_id ? await nameOf("affliction", h.affliction_type_id) : "", virtue: h.virtue_type_id ? await nameOf("affliction", h.virtue_type_id) : "",
      deathsDoor: !!h.visited_deaths_door, lastBlow: blow && /_[A-Z]$/.test(blow) ? await nameOf("monster", blow) : "",
      blowCls: blow && /_[A-Z]$/.test(blow) ? blow : "", ...fx(h.actor),
    })
  }
  const b = r.inbattle ? r.battle : undefined
  const battle = b ? {
    round: Number(b.round ?? 0),
    foes: await Promise.all(Object.values<any>(b.enemies ?? {}).filter((e) => !e.is_hero).map(async (e) => ({
      name: typeof e.data?.monster_class === "string" ? await nameOf("monster", e.data.monster_class) : "?",
      hp: Math.max(0, Math.round(f32(e.data?.actor?.current_hp))),
      hitBy: heroes.find((h) => h.guid === Number(e.data?.actor?.damage_source_data))?.name ?? "",
      guid: Number(e.data?.battle_guid ?? 0), cls: String(e.data?.monster_class ?? ""), ...fx(e.data?.actor),
    }))),
    // a hero whose initiative is spent has taken (or is taking) this round's turn
    acted: Object.values<any>(b.initiative?.heroes ?? {}).filter((i) => Number(i.initiative) === 0).map((i) => heroes.find((h) => h.guid === Number(i.roster_guid))?.name ?? "").filter(Boolean),
  } : undefined
  return {
    battle,
    at: new Date().toISOString(), dungeon: ri.dungeon, difficulty: Number(ri.difficulty ?? 0), length: Number(ri.length ?? 0), quest: String(ri.type ?? ""),
    key: `${ri.id}:${r.start_elapsed_time ?? ""}`, torch: Math.round(f32(r.torchlight)), inBattle: !!r.inbattle, supplies, tally, heroes,
    known: Object.keys((save.game_knowledge as any)?.combat_skills ?? {}),
    map: mapOf(save),
    // the narrator's log of this trip, one entry per event it spoke over: the only record of a trap sprung or an obstacle cleared by hand
    narrated: Object.values<any>((save.narration as any)?.raid_entry_log ?? {}).map((e) => String(e.entry_type ?? "")),
  }
}

const town = () => outDir()
export const chronicleDir = (key = "") => join(town(), "chronicle", key.replace(/[^\w.-]+/g, "_"))
const sig = (s: Snap) => JSON.stringify({ ...s, at: "" })

/** Keeps a snapshot when the party's state changed since the last one (C39). Returns the file written, or undefined. */
export async function capture(save: Save): Promise<string | undefined> {
  const s = await snapshot(save)
  if (!s) return undefined
  const dir = chronicleDir(s.key)
  mkdirSync(dir, { recursive: true })
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.includes(".raw.")).sort()
  const last = files.length ? ((await Bun.file(join(dir, files[files.length - 1]!)).json()) as Snap) : undefined
  if (last && sig(last) === sig(s)) return undefined
  const n = String(files.filter((x) => !x.includes(".raw.")).length).padStart(4, "0"), f = join(dir, `${n}.json`)
  await Bun.write(f, JSON.stringify(s))
  // the whole record beside the summary, decoded: every entry of the game's tally with its parameters, and the four's full
  // hero records, for what later readings (a knowledge graph of the campaign) will need that the summary does not keep
  const roster = (save.roster as any)?.heroes ?? {}
  await Bun.write(join(dir, `${n}.raw.json`), JSON.stringify({ raid: save.raid, narration: (save.narration as any)?.raid_entry_log, heroes: Object.fromEntries(s.heroes.map((h) => [h.guid, roster[h.guid]])) }))
  return f
}

/** The chronicle of the expedition the coach just brought back: the latest one for that dungeon and those four. */
export async function chronicleFor(back: { dungeon: string; heroes: { guid: number }[] }): Promise<Snap[]> {
  const root = chronicleDir()
  if (!existsSync(root)) return []
  const want = back.heroes.map((h) => h.guid).sort().join(",")
  const dirs = readdirSync(root).map((d) => join(root, d)).filter((d) => statSync(d).isDirectory()).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  for (const d of dirs) {
    const files = readdirSync(d).filter((f) => f.endsWith(".json") && !f.includes(".raw.")).sort()
    if (!files.length) continue
    const first = (await Bun.file(join(d, files[0]!)).json()) as Snap
    if (first.dungeon === back.dungeon && first.heroes.map((h) => h.guid).sort().join(",") === want) return Promise.all(files.map(async (f) => (await Bun.file(join(d, f)).json()) as Snap))
  }
  return []
}

export interface Beat { i: number; kind: "battle" | "ambush" | "curio" | "dark" | "hunger" | "spike" | "affliction" | "virtue" | "deathsdoor" | "fell" | "trap" | "obstacle" | "crit" | "quirk" | "shuffle"; who?: string; text: string; bad: boolean; from?: number }

/** The trip in order, from one snapshot to the next (C40). */
export function beats(snaps: Snap[], fell: string[] = []): Beat[] {
  const out: Beat[] = []
  // the roster keeps the last blow of an earlier trip until a new one lands; a blow already there on the first page is not this road's
  const stale = new Map((snaps[0]?.heroes ?? []).map((h) => [h.guid, h.lastBlow]))
  snaps = snaps.map((s) => ({ ...s, heroes: s.heroes.map((h) => (h.lastBlow && stale.get(h.guid) === h.lastBlow ? { ...h, lastBlow: "" } : h)) }))
  let run: { from: number } | undefined
  for (let i = 1; i < snaps.length; i++) {
    const a = snaps[i - 1]!, b = snaps[i]!, d = (k: string) => (b.tally[k] ?? 0) - (a.tally[k] ?? 0)
    if (d("BATTLE_COMPLETED") > 0) out.push({ i, kind: "battle", text: `${d("BATTLE_COMPLETED") > 1 ? `${d("BATTLE_COMPLETED")} battles` : "a battle"} won`, bad: false })
    if (d("AMBUSHED") > 0) out.push({ i, kind: "ambush", text: "they were ambushed", bad: true })
    if (a.torch >= CHRONICLE_RULE.darkTorch && b.torch < CHRONICLE_RULE.darkTorch) out.push({ i, kind: "dark", text: `the light fell to ${b.torch}`, bad: true })
    if ((a.supplies.food ?? 0) > 0 && !(b.supplies.food ?? 0)) out.push({ i, kind: "hunger", text: "the food ran out", bad: true })
    for (const h of b.heroes) {
      const was = a.heroes.find((x) => x.guid === h.guid)
      if (!was) continue
      if (!was.affliction && h.affliction) out.push({ i, kind: "affliction", who: h.name, text: `${h.name} broke (${h.affliction})`, bad: true })
      if (!was.virtue && h.virtue) out.push({ i, kind: "virtue", who: h.name, text: `${h.name} rose to the occasion (${h.virtue})`, bad: false })
      if (!was.deathsDoor && h.deathsDoor) out.push({ i, kind: "deathsdoor", who: h.name, text: `${h.name} stood at Death's Door${h.lastBlow ? `, struck by a ${h.lastBlow}` : ""}`, bad: true })
      else if (h.stress - was.stress >= CHRONICLE_RULE.stressSpike && !h.affliction) out.push({ i, kind: "spike", who: h.name, text: `${h.name}'s stress leapt to ${h.stress}`, bad: true })
    }
    // C44: the four are kept front to back, so a change of order among those on both pages is a shuffle; a run of shuffled
    // pages within one battle (its knockbacks and moves) is told once, as the net change from before it, and not at all if it undid itself
    const moved = (x: Snap, y: Snap) => { const both = y.heroes.filter((h) => x.heroes.some((o) => o.guid === h.guid)).map((h) => h.guid); return x.heroes.filter((h) => both.includes(h.guid)).map((h) => h.guid).join() !== both.join() }
    if (moved(a, b)) {
      run ??= { from: i - 1 }
      const from = snaps[run.from]!, last = out.findIndex((x) => x.kind === "shuffle" && x.from === run!.from)
      if (last >= 0) out.splice(last, 1)
      // ranks are counted among those still there, so a fallen hero's gap does not read as the others moving up
      const stayed = from.heroes.filter((o) => b.heroes.some((h) => h.guid === o.guid))
      const shifts = b.heroes.map((h, r) => ({ h, r: r + 1, was: stayed.findIndex((o) => o.guid === h.guid) + 1 })).filter((x) => x.was && x.was !== x.r)
      if (shifts.length) out.push({ i, kind: "shuffle", from: run.from, text: shifts.map((x, k) => `${x.h.name} ${k ? "" : "took "}rank ${x.r}`).join(", ").replace(/, ([^,]+)$/, " and $1"), bad: false })
    }
    if (!b.inBattle || d("BATTLE_COMPLETED") > 0) run = undefined
    for (const h of a.heroes) if (!b.heroes.some((x) => x.guid === h.guid) && fell.includes(h.name)) out.push({ i, kind: "fell", who: h.name, text: `${h.name} fell${h.lastBlow ? ` to a ${h.lastBlow}` : ""}`, bad: true })
  }
  // a fall the chronicle missed between saves is still told, from the last blow the roster kept
  for (const n of fell) if (!out.some((x) => x.kind === "fell" && x.who === n)) { const h = snaps.at(-1)?.heroes.find((x) => x.name === n); out.push({ i: snaps.length, kind: "fell", who: n, text: `${n} fell${h?.lastBlow ? ` to a ${h.lastBlow}` : ""}`, bad: true }) }
  return out
}

export interface Lesson { kind: "light" | "food" | "healing" | "retreat" | "worked"; text: string; dungeon: string; difficulty: number; length: number; week: number; trip: string }

/** What went well and what went wrong, tied to what the Hamlet controls (C41). */
export function judge(snaps: Snap[], bs: Beat[], trip: { dungeon: string; dungeonName: string; difficulty: number; length: number; week: number; success: boolean; healer: boolean }): { well: string[]; wrong: string[]; lessons: Lesson[] } {
  const turn = bs.findIndex((b) => b.bad && b.kind !== "ambush" && b.kind !== "spike")
  const before = turn < 0 ? bs : bs.slice(0, turn), after = turn < 0 ? [] : bs.slice(turn)
  const well: string[] = [], wrong: string[] = [], lessons: Lesson[] = []
  const base = { dungeon: trip.dungeon, difficulty: trip.difficulty, length: trip.length, week: trip.week, trip: `${trip.dungeonName}, week ${trip.week}` }
  const won = before.filter((b) => b.kind === "battle").length
  if (won) well.push(`${won === 1 ? "The first battle" : `The first ${won} stretches of fighting`} went their way before anything broke.`)
  for (const b of before.filter((b) => b.kind === "virtue")) well.push(`${b.text}.`)
  // the light: a break or a Death's Door while it was dark
  const darkAt = snaps.findIndex((s) => s.torch < CHRONICLE_RULE.darkTorch)
  const brokeInDark = darkAt >= 0 && after.some((b) => (b.kind === "affliction" || b.kind === "deathsdoor" || b.kind === "spike") && b.i >= darkAt)
  if (brokeInDark) { wrong.push("It went wrong after the light had fallen: they broke in the dark."); lessons.push({ ...base, kind: "light", text: "carry more torches, and keep the light high" }) }
  else if (darkAt < 0 && snaps.length) well.push("The light held the whole way.")
  if (bs.some((b) => b.kind === "hunger")) { wrong.push("The food ran out before the road did."); lessons.push({ ...base, kind: "food", text: "carry more food" }) }
  const doors = bs.filter((b) => b.kind === "deathsdoor").length, falls = bs.filter((b) => b.kind === "fell").length
  if (doors + falls >= 2 || falls) {
    wrong.push(trip.healer ? `Healing did not keep up: ${doors} at Death's Door${falls ? `, ${falls} fell` : ""}.` : `There was no true healer, and ${doors} stood at Death's Door${falls ? `, ${falls} fell` : ""}.`)
    lessons.push({ ...base, kind: "healing", text: trip.healer ? "send a stronger heal, or a second one" : "never go without a true healer" })
  }
  // turning back: a fall that came after two had broken
  const broken = (s: Snap) => s.heroes.filter((h) => h.affliction).length
  const brokeTwo = snaps.findIndex((s) => broken(s) >= 2)
  if (brokeTwo >= 0 && bs.some((b) => b.kind === "fell" && b.i >= brokeTwo)) { wrong.push("Two had broken before the fall, and they pressed on."); lessons.push({ ...base, kind: "retreat", text: "turn back once two have broken" }) }
  if (trip.success && !wrong.length) lessons.push({ ...base, kind: "worked", text: "this preparation brought them home with the work done" })
  return { well, wrong, lessons }
}

// ---------- the ledger (C42) ----------
export const ledgerFile = () => join(town(), "lessons.json")
export async function loadLedger(): Promise<Lesson[]> {
  const f = Bun.file(ledgerFile())
  return (await f.exists()) ? ((await f.json()) as Lesson[]) : []
}
/** Adds a trip's lessons once (a trip is never counted twice). */
export async function remember(lessons: Lesson[]): Promise<Lesson[]> {
  const all = await loadLedger()
  for (const l of lessons) if (!all.some((x) => x.trip === l.trip && x.kind === l.kind)) all.push(l)
  await Bun.write(ledgerFile(), JSON.stringify(all, null, 1))
  return all
}
/** The lessons that bear on a road: same dungeon, learnt at its difficulty or lower, since the dark only grows. */
export function bearing(all: Lesson[], road: { dungeon: string; difficulty: number }): Lesson[] {
  return all.filter((l) => l.dungeon === road.dungeon && l.difficulty <= road.difficulty)
}
/** True when the road is harder than every trip in the ledger: my habits are untried there. */
export function untried(all: Lesson[], road: { difficulty: number }, done: { difficulty: number }[]): boolean {
  const seen = [...all.map((l) => l.difficulty), ...done.map((d) => d.difficulty)]
  return seen.length > 0 && road.difficulty > Math.max(...seen)
}

// ---------- C45: the debrief, everything the chronicle saw on the road ----------
// what struck the four and with which attacks, the damage over time and who laid it, criticals, traps, obstacles cleared,
// what each curio searched gave or took, the quirks caught, and what came home. Read from the pages and their whole
// records; attacks are named only among those the party has witnessed (C5), from each foe's own damage ranges.

const PROVISIONS = new Set(["food", "torch", "bandage", "antivenom", "shovel", "medicinal_herbs", "skeleton_key", "holy_water", "laudanum", "dog_treats"])
export interface FoeRecord { name: string; blows: number; hp: number; crits: number; attacks: Record<string, number>; victims: Record<string, number>; blight: number; bleed: number }
export interface Debrief { foes: FoeRecord[]; beats: Beat[]; loot: Record<string, number> }

const word = (id: string) => (/^\d+$/.test(id) ? "journal page" : id.replace(/_/g, " "))
const an = (w: string) => `${/^[aeiou]/i.test(w) ? "an" : "a"} ${w}`
async function rawPage(s: Snap, i: number): Promise<any> { try { return await Bun.file(join(chronicleDir(s.key), `${String(i).padStart(4, "0")}.raw.json`)).json() } catch { return undefined } }
const quirksOf = (r: any) => new Map<number, { name: string; q: string[] }>(Object.entries<any>(r?.heroes ?? {}).map(([g, h]) => { const d = h?.hero_file_data?.raw_data ?? h; return [Number(g), { name: d?.actor?.name ?? g, q: Object.keys(d?.quirks ?? {}) }] }))

export async function debrief(snaps: Snap[]): Promise<Debrief> {
  const str = await strings(), foes = new Map<string, FoeRecord>(), out: Beat[] = []
  const foe = (n: string) => { if (!foes.has(n)) foes.set(n, { name: n, blows: 0, hp: 0, crits: 0, attacks: {}, victims: {}, blight: 0, bleed: 0 }); return foes.get(n)! }
  const hit = (f: FoeRecord, who: string, n: number) => { f.victims[who] = (f.victims[who] ?? 0) + n }
  const stale = new Map((snaps[0]?.heroes ?? []).map((h) => [h.guid, h.lastBlow]))
  // health and stress each hero lost from one page to the next
  const harmOf = (a: Snap, b: Snap) => b.heroes.flatMap((h) => { const w = a.heroes.find((x) => x.guid === h.guid); return w ? [{ name: h.name, blow: h.lastBlow, hp: Math.round(w.hp) - Math.round(h.hp), st: h.stress - w.stress }] : [] })
  let before = quirksOf(await rawPage(snaps[0]!, 0))
  for (let i = 1; i < snaps.length; i++) {
    const a = snaps[i - 1]!, b = snaps[i]!, known = new Set(b.known ?? []), r = await rawPage(b, i)
    const harm = harmOf(a, b), next = snaps[i + 1] ? harmOf(b, snaps[i + 1]!) : []
    const said = a.narrated && b.narrated ? b.narrated.slice(a.narrated.length) : []
    if (!a.narrated && b.narrated) placeEarlier(snaps, i, b.narrated, out)
    // blows: a loss matching the damage over time carried is that tick, laid by whoever the effect names; any other loss is the last foe's blow
    for (const h of b.heroes) {
      const w = a.heroes.find((x) => x.guid === h.guid)
      if (!w) continue
      const loss = Math.round(w.hp) - Math.round(h.hp)
      if (loss <= 0) continue
      const stacks = (w.effects ?? []).map((x) => x.match(/^(blight|bleed|stat 4|stat 5) (\d+)(?:.*? from (\S+))?/)).filter((m): m is RegExpMatchArray => !!m)
      const one = stacks.find((m) => Number(m[2]) === loss), sum = stacks.reduce((t, m) => t + Number(m[2]), 0)
      const ticked = one ? [one] : stacks.length > 1 && sum === loss ? stacks : []
      if (ticked.length) {
        for (const m of ticked) { const f = foe(m[3] ? await nameOf("monster", m[3]) : "an unknown foe"); f[/blight|4/.test(m[1]!) ? "blight" : "bleed"] += Number(m[2]); hit(f, h.name, Number(m[2])) }
        continue
      }
      // a blow lands only in a fight, from a foe that is in it; a loss outside one (a trap, a bare-handed obstacle, hunger) is no foe's
      const inFight = [...(a.battle?.foes ?? []), ...(b.battle?.foes ?? [])].map((x) => x.name)
      if (!h.lastBlow || !(a.inBattle || b.inBattle) || (inFight.length && !inFight.includes(h.lastBlow)) || (!h.blowCls && stale.get(h.guid) === h.lastBlow)) continue
      const f = foe(h.lastBlow), m = h.blowCls ? await monster(h.blowCls) : undefined
      // the same foe striking two of them on one page points to an attack that strikes several ranks
      const struck = b.heroes.filter((x) => { const y = a.heroes.find((z) => z.guid === x.guid); return y && x.lastBlow === h.lastBlow && Math.round(y.hp) > Math.round(x.hp) }).length
      f.blows++; f.hp += loss; hit(f, h.name, loss)
      if (!m) continue
      let fits = [...m.dmg].filter(([id]) => !b.known || known.has(id)).filter(([, [lo, hi]]) => loss >= lo && loss <= Math.ceil(hi * 1.5))
      const wide = fits.filter(([id]) => m.multi.has(id) === struck > 1)
      if (wide.length) fits = wide
      if (fits.length) { const label = fits.map(([id]) => str.get(`str_monster_skill_${id}`) ?? word(id)).join(" or "); f.attacks[label] = (f.attacks[label] ?? 0) + 1 }
      if (!b.narrated && fits.length && fits.every(([, [, hi]]) => loss > hi)) f.crits++
    }
    // what the narrator spoke over; it often speaks a save before the harm shows, so the harm is looked for on this page and the next
    for (const e of said) {
      const all = [...harm, ...next].filter((x) => x.hp > 0 || x.st > 0)
      const worst = [...all].sort((x, y) => y.st + 3 * y.hp - (x.st + 3 * x.hp))[0]
      const toll = (x: { hp: number; st: number }) => [x.hp > 0 ? `${x.hp} health` : "", x.st > 0 ? `${x.st} stress` : ""].filter(Boolean).join(" and ")
      if (e === "trap") out.push({ i, kind: "trap", who: worst?.name, text: worst ? `a trap was sprung on ${worst.name}, costing ${toll(worst)}` : "a trap was sprung", bad: true })
      else if (e === "obstacle_clear_no_item") {
        const st = harm.reduce((t, x) => t + Math.max(0, x.st), 0)
        out.push({ i, kind: "obstacle", text: `they cleared an obstacle with their bare hands, which cost the four ${st} stress between them and dropped the light from ${a.torch} to ${b.torch}`, bad: true })
      } else if (e === "obstacle") out.push({ i, kind: "obstacle", text: "they cleared an obstacle", bad: false })
      else if (e === "crit_hero") {
        const v = [...harm, ...next].filter((x) => x.hp > 0).sort((x, y) => y.hp - x.hp)[0]
        if (v?.blow) foe(v.blow).crits++
        out.push({ i, kind: "crit", who: v?.name, text: v ? `${v.blow ? an(v.blow) : "a foe"} landed a critical blow on ${v.name} for ${v.hp}` : "a critical blow landed on one of them", bad: true })
      } else if (e === "hunger_starve") out.push({ i, kind: "hunger", text: "they went hungry with nothing to eat", bad: true })
    }
    // each curio searched, with what it left: provisions or riches found, quirks caught or shed, health and stress
    const quirks = quirksOf(r), changed: { who: string; text: string }[] = []
    for (const [g, now] of quirks) {
      const was = before.get(g)
      if (!was) continue
      for (const q of now.q.filter((x) => !was.q.includes(x))) changed.push({ who: now.name, text: `${now.name} took on ${await nameOf("quirk", q)}` })
      for (const q of was.q.filter((x) => !now.q.includes(x))) changed.push({ who: now.name, text: `${now.name} was rid of ${await nameOf("quirk", q)}` })
    }
    if (r) before = quirks
    const searched = (b.tally.CURIO_INVESTIGATED ?? 0) - (a.tally.CURIO_INVESTIGATED ?? 0)
    if (searched > 0) {
      const ids = Object.values<any>(r?.raid?.stat_database?.CURIO_INVESTIGATED?.entries ?? {}).slice(-searched).map((e) => Object.values<any>(e.parameters ?? {}).map((x) => x.data).filter((x) => typeof x === "string").pop()).filter(Boolean)
      // what it gave shows on this page, or on the next when the loot is taken after
      const gains = (x: Snap, y: Snap) => Object.entries(y.supplies).filter(([k, n]) => n > (x.supplies[k] ?? 0)).map(([k, n]) => `${n - (x.supplies[k] ?? 0)} ${word(k)}`)
      const nb = snaps[i + 1], quiet = nb && ["BATTLE_COMPLETED", "CURIO_INVESTIGATED", "ROOM_VISITED"].every((k) => (nb.tally[k] ?? 0) === (b.tally[k] ?? 0))
      const found = [...gains(a, b), ...(quiet ? gains(b, nb!) : [])]
      const tolls = harm.filter((x) => x.hp > 0 || x.st > 0).map((x) => `${x.name} lost ${[x.hp > 0 ? `${x.hp} health` : "", x.st > 0 ? `${x.st} stress` : ""].filter(Boolean).join(" and ")}`)
      const eased = harm.filter((x) => x.st < 0).map((x) => `${x.name} shed ${-x.st} stress`)
      const what = [...found.length ? [`found ${found.join(", ")}`] : [], ...changed.map((c) => c.text), ...tolls, ...eased]
      for (const id of ids) out.push({ i, kind: "curio", text: `they searched ${an(str.get(`str_curio_title_${id}`) ?? word(String(id)))}${what.length ? `: ${what.join("; ")}` : ", and nothing came of it"}`, bad: changed.some((c) => / took on /.test(c.text)) || tolls.length > 0 })
    } else for (const c of changed) out.push({ i, kind: "quirk", who: c.who, text: c.text, bad: / took on /.test(c.text) })
  }
  // what came home: every riche and trophy gained over the road, provisions left aside
  const first = snaps[0]?.supplies ?? {}, last = snaps.at(-1)?.supplies ?? {}
  const loot = Object.fromEntries(Object.entries(last).filter(([k, n]) => !PROVISIONS.has(k) && n > (first[k] ?? 0)).map(([k, n]) => [word(k), n - (first[k] ?? 0)]))
  return { foes: [...foes.values()].sort((x, y) => y.hp + y.blight + y.bleed - (x.hp + x.blight + x.bleed)), beats: out, loot }
}

// the narrator's log was first kept part way through a road: the traps and bare-handed obstacles it already held are placed
// on the page that bears their mark, outside a fight: an obstacle drops the light by a fifth or more and stresses three or more;
// a trap stresses or wounds one hero alone, with nothing searched
function placeEarlier(snaps: Snap[], upto: number, log: string[], out: Beat[]) {
  const used = new Set<number>()
  const pick = (test: (a: Snap, b: Snap) => boolean) => { for (let j = upto - 1; j >= 1; j--) if (!used.has(j) && !snaps[j]!.inBattle && !snaps[j - 1]!.inBattle && test(snaps[j - 1]!, snaps[j]!)) { used.add(j); return j } return -1 }
  const deltas = (a: Snap, b: Snap) => b.heroes.flatMap((h) => { const w = a.heroes.find((x) => x.guid === h.guid); return w ? [{ name: h.name, hp: Math.round(w.hp) - Math.round(h.hp), st: h.stress - w.stress }] : [] })
  for (const e of [...log].reverse()) {
    if (e === "obstacle_clear_no_item") {
      const j = pick((a, b) => a.torch - b.torch >= 15 && deltas(a, b).filter((x) => x.st > 0).length >= 3)
      if (j > 0) { const a = snaps[j - 1]!, b = snaps[j]!, st = deltas(a, b).reduce((t, x) => t + Math.max(0, x.st), 0); out.push({ i: j, kind: "obstacle", text: `they cleared an obstacle with their bare hands, which cost the four ${st} stress between them and dropped the light from ${a.torch} to ${b.torch}`, bad: true }) }
    } else if (e === "trap") {
      const j = pick((a, b) => (b.tally.CURIO_INVESTIGATED ?? 0) === (a.tally.CURIO_INVESTIGATED ?? 0) && deltas(a, b).filter((x) => x.st >= 10 || x.hp > 0).length === 1)
      if (j > 0) { const v = deltas(snaps[j - 1]!, snaps[j]!).find((x) => x.st >= 10 || x.hp > 0)!; out.push({ i: j, kind: "trap", who: v.name, text: `a trap was sprung on ${v.name}, costing ${[v.hp > 0 ? `${v.hp} health` : "", v.st > 0 ? `${v.st} stress` : ""].filter(Boolean).join(" and ")}`, bad: true }) }
    }
  }
}
