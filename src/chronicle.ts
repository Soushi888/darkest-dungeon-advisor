// The expedition's chronicle (C39 to C42): what the party lived through, kept from each save made in a dungeon, because the
// game deletes its own record (persist.raid.json) when the coach comes home. From it: the survivors' tale, what went well and
// what went wrong, and a ledger of lessons that outlives the trip. Writes only under .local/town (ISA A1).
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { outDir } from "./board.ts"
import { nameOf, text } from "./game.ts"
import type { Save } from "./read.ts"

// RULE: my own reading of a trip, not the game's numbers (ISA A2)
export const CHRONICLE_RULE = {
  darkTorch: 50, // RULE: below this light I count the party as walking in the dark
  stressSpike: 25, // RULE: this much stress between two saves is a blow worth telling
  lessonTorches: 2, // RULE: torches a light lesson adds on its dungeon
  lessonFood: 2, // RULE: food a hunger lesson adds on its dungeon
  untriedMargin: 1, // RULE: one more torch and food on a road harder than any in the ledger
}

export interface SnapHero { guid: number; name: string; cls: string; hp: number; maxHp: number; stress: number; affliction: string; virtue: string; deathsDoor: boolean; lastBlow: string }
export interface Snap {
  at: string; dungeon: string; difficulty: number; length: number; quest: string; key: string
  torch: number; inBattle: boolean; supplies: Record<string, number>
  tally: Record<string, number> // the game's own counts: ROOM_VISITED, BATTLE_COMPLETED, AMBUSHED, CURIO_INVESTIGATED, ...
  heroes: SnapHero[]
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
  for (const it of Object.values<any>(r.party?.inventory?.items ?? {})) { const k = it.type === "provision" ? "food" : it.id || it.type; supplies[k] = (supplies[k] ?? 0) + (it.amount ?? 0) }
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
    })
  }
  return {
    at: new Date().toISOString(), dungeon: ri.dungeon, difficulty: Number(ri.difficulty ?? 0), length: Number(ri.length ?? 0), quest: String(ri.type ?? ""),
    key: `${ri.id}:${r.start_elapsed_time ?? ""}`, torch: Math.round(f32(r.torchlight)), inBattle: !!r.inbattle, supplies, tally, heroes,
  }
}

// read at call time, so a test that sets DD_TOWN_OUT after its imports never writes into the live board's folder
const town = () => process.env.DD_TOWN_OUT ?? outDir
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
  await Bun.write(join(dir, `${n}.raw.json`), JSON.stringify({ raid: save.raid, heroes: Object.fromEntries(s.heroes.map((h) => [h.guid, roster[h.guid]])) }))
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

export interface Beat { i: number; kind: "battle" | "ambush" | "curio" | "dark" | "hunger" | "spike" | "affliction" | "virtue" | "deathsdoor" | "fell"; who?: string; text: string; bad: boolean }

/** The trip in order, from one snapshot to the next (C40). */
export function beats(snaps: Snap[], fell: string[] = []): Beat[] {
  const out: Beat[] = []
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
