// C113: the expeditions as one knowledge graph (Soushi, 2026-10-13: "Ensure you can build a graph knowledge based on all the
// expedition informations"; earlier, "every information from the expeditions helps to feed the strategies"). Derived, never
// edited: every node and edge is read back from the chronicle's pages and their raw records, the lessons ledger and, when it is
// given, the campaign log, through the road's own readings (debrief, beats, fights, slainIn, meetings, teachings). Deleting the
// database and building again gives the same graph. Writes only <outDir()>/graph.db (ISA A1); names only what was witnessed (C5).
// Every node and edge carries the trip it was first seen on (trips are numbered in the order they set out), so a viewer can
// replay the graph trip by trip; each special foe met is an encounter, kept whole as a dossier for the next meeting.
import { Database } from "bun:sqlite"
import { existsSync, readdirSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import { outDir } from "../sources/paths.ts"
import { dungeonMonsters, heroClass, levelOf, levelThresholds, nameOf, quirks as quirkLib, specialFoes as specialOf, strings } from "../sources/game.ts"
import { beats, chronicleDir, CHRONICLE_RULE, debrief, freshEffect, loadLedger, PROVISIONS, type Lesson, type Snap } from "../road/chronicle.ts"
import { fightEnd, fights, meetings } from "../road/foes.ts"
import { slainIn } from "../road/slain.ts"
import { teachings } from "../road/teach.ts"
import { questStatus } from "../world/quest.ts"
import { DIFFICULTY, LENGTH } from "../world/town.ts"
import { RULE } from "../caretaker/advise.ts"
import { effectWords, journalPage, pageTitle } from "../voice/words.ts"

export const graphFile = () => join(outDir(), "graph.db")

export type Kind = "trip" | "hero" | "foe" | "dungeon" | "fight" | "curio" | "quirk" | "item" | "lesson" | "encounter" | "foegroup"
export type Rel = "WENT_ON" | "IN" | "HELD_IN" | "FOUGHT" | "STRUCK" | "BLED" | "BLIGHTED" | "SLEW" | "DEATHS_DOOR" | "AFFLICTED" | "VIRTUE" | "GAINED" | "SEARCHED" | "CARRIED" | "MET_SPECIAL" | "TAUGHT"
  | "OF" | "ON" | "AT" | "DURING" | "LINEUP" | "SEEN_IN" | "FOUGHT_BESIDE"
/** A node; `first` is the ordinal of the trip it was first seen on (null for a ledger lesson of a trip the chronicle never kept). */
export interface Node { id: string; kind: Kind; name: string; first: number | null; props: Record<string, unknown> }
/** An edge as one trip saw it; `ord` is that trip's ordinal. The same link seen again on a later trip is another row. */
export interface Edge { src: string; rel: Rel; dst: string; trip: string; ord: number | null; page: number | null; props: Record<string, unknown> }

export const id = {
  trip: (key: string) => `trip:${key}`, hero: (guid: number) => `hero:${guid}`, foe: (cls: string) => `foe:${cls}`,
  dungeon: (d: string, level: number) => `dungeon:${d}:${level}`, fight: (trip: string, page: number) => `fight:${trip}:${page}`,
  curio: (c: string) => `curio:${c}`, quirk: (q: string) => `quirk:${q}`, item: (k: string) => `item:${k}`,
  lesson: (l: { trip: string; kind: string; foe?: string }) => `lesson:${l.trip}|${l.kind}|${l.foe ?? ""}`,
  encounter: (trip: string, page: number) => `encounter:${trip}:${page}`,
  group: (sortedTypes: string[]) => `group:${sortedTypes.join("+")}`,
}

/** The trips the campaign log saw end, in the order it kept them: the week (its chapter), the dungeon, the four, success and the fallen. */
export interface LogTrip { week: number; dungeon: string; guids: number[]; success: boolean; died: number[] }
export function logTrips(campaignLog: any): LogTrip[] {
  const chapters = Object.entries<any>(campaignLog?.chapters ?? {}).sort((a, b) => Number(a[0]) - Number(b[0]))
  return chapters.flatMap(([week, c]) => Object.values<any>(c ?? {}).filter((x) => x && typeof x === "object" && x.heroes && typeof x.dungeon_type === "string" && x.start === false).map((x) => {
    const hs = Object.values<any>(x.heroes)
    return { week: Number(week), dungeon: String(x.dungeon_type), guids: hs.map((h) => Number(h.guid)).sort((a, b) => a - b), success: !!x.success, died: hs.filter((h) => h.died === true).map((h) => Number(h.guid)) }
  }))
}

/** What a special foe's meeting was, as the pages witnessed it. A field the record does not hold is left out, never guessed. */
export interface Encounter {
  foe: string; name: string; kind: "wanderer" | "boss"; trip: string; tripName: string; dungeon: string; level: number
  pages: { from: number; to: number }
  where?: { area: "room" | "corridor"; name: string }
  context: { four: { hero: string; name: string; cls: string; rank: number; hp: number; maxHp: number; stress: number }[]; torch: number; ambushed: boolean; alongside: string[] }
  challenges: {
    attacks: { name: string; blows: number; health: number }[] // its attacks, named only when witnessed (C5), with the health each took
    struck: { hero: string; name: string; health: number; blows: number; crits: number; bleed: number; blight: number }[]
    effects: { hero: string; name: string; effect: string; page: number }[] // what it laid on the four, as the game records its source
    deathsDoor: string[] // brought to Death's Door in this fight
    // what the fight did to the four that the record does not lay at any one foe: stress, afflictions, stuns
    stress: { name: string; from: number; to: number }[]; afflicted: { name: string; affliction: string; page: number }[]; stunned: { name: string; page: number }[]
    brought: string[] // what it called to its side
    others: { name: string; health: number; bleed: number; blight: number }[] // the harm the rest of its side did in the same fight
  }
  rounds: number; kills: string[]; slain: boolean; outcome: "won" | "fled" | "unfinished" | "wiped"
}

const pageNo = (f: string) => Number(f.match(/^(\d+)\.json$/)![1])
const json = (v: unknown) => JSON.stringify(v)
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
async function rawOf(dir: string, i: number): Promise<any> { try { return await Bun.file(join(dir, `${String(i).padStart(4, "0")}.raw.json`)).json() } catch { return undefined } }
const heroData = (h: any) => h?.hero_file_data?.raw_data ?? h
const curioIds = (raw: any, n: number) => Object.values<any>(raw?.raid?.stat_database?.CURIO_INVESTIGATED?.entries ?? {}).slice(-n).map((e) => Object.values<any>(e.parameters ?? {}).map((x) => x.data).filter((x) => typeof x === "string").pop())

/** An item as the Hamlet names it: the game's inventory title, a journal page by its own title. */
async function itemName(k: string, str: Map<string, string>): Promise<string> {
  // the chronicle's first pages kept a journal page under its bare number (chronicle.ts word())
  const page = journalPage(k) ?? (/^\d+$/.test(k) ? k : undefined)
  if (page) return pageTitle(page)
  if (k === "food") return str.get("str_inventory_title_provision") ?? "Food"
  for (const p of ["supply", "heirloom", "gem", "trinket", "estate", ""]) { const t = str.get(`str_inventory_title_${p}${k}`); if (t) return t }
  return k.replace(/_/g, " ")
}

/** Every node and edge the chronicle under outDir() holds. `campaignLog` (persist.campaign_log) adds the week, success and the fallen. */
export async function derive(opts: { campaignLog?: any } = {}): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const nodes = new Map<string, Node>(), edges: Edge[] = []
  let ord: number | null = null
  const node = (n: Omit<Node, "first">) => {
    const was = nodes.get(n.id)
    nodes.set(n.id, was ? { ...was, name: n.name || was.name, props: { ...was.props, ...n.props } } : { ...n, first: ord })
  }
  const edge = (e: Omit<Edge, "ord">) => edges.push({ ...e, ord })
  const root = chronicleDir()
  const dirs = existsSync(root) ? readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory()) : []
  // the trips in the order they set out, by their first page
  const trips: { key: string; dir: string; snaps: Snap[]; pages: number[] }[] = []
  for (const key of dirs) {
    const dir = join(root, key), files = readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)).sort()
    if (!files.length) continue
    trips.push({ key, dir, pages: files.map(pageNo), snaps: await Promise.all(files.map(async (f) => (await Bun.file(join(dir, f)).json()) as Snap)) })
  }
  trips.sort((a, b) => (a.snaps[0]!.at || "").localeCompare(b.snaps[0]!.at || "") || a.key.localeCompare(b.key))
  const log = opts.campaignLog ? logTrips(opts.campaignLog) : [], used = new Set<number>()
  const thr = await levelThresholds(), qlib = await quirkLib(), str = await strings()
  const ledger = await loadLedger()
  const lessonsSeen = new Set<string>()

  for (const [n, t] of trips.entries()) {
    ord = n + 1
    const { key, dir, snaps } = t, first = snaps[0]!, last = snaps.at(-1)!, tid = id.trip(key)
    const guids = first.heroes.map((h) => h.guid).sort((a, b) => a - b)
    const li = log.findIndex((l, i) => !used.has(i) && l.dungeon === first.dungeon && l.guids.join() === guids.join())
    const lt = li >= 0 ? log[li] : undefined
    if (lt) used.add(li)
    const dungeonName = await nameOf("dungeon", first.dungeon)
    const firstRaw = await rawOf(dir, t.pages[0]!), lastRaw = await rawOf(dir, t.pages.at(-1)!)
    const quest = await questStatus(lastRaw).catch(() => undefined)
    const label = lt ? `${dungeonName}, week ${lt.week}` : `${dungeonName}, road ${ord}`
    node({ id: tid, kind: "trip", name: label, props: {
      ordinal: ord, dungeon: first.dungeon, difficulty: first.difficulty, length: first.length, quest: first.quest, pages: snaps.length, from: first.at, to: last.at,
      ...(lt ? { week: lt.week, outcome: lt.success ? "success" : "failure" } : {}), ...(quest ? { questDone: quest.complete } : {}) } })
    const did = id.dungeon(first.dungeon, first.difficulty)
    node({ id: did, kind: "dungeon", name: `${dungeonName}, ${DIFFICULTY[first.difficulty] ?? `level ${first.difficulty}`}`, props: { dungeon: first.dungeon, level: first.difficulty } })
    edge({ src: tid, rel: "IN", dst: did, trip: key, page: t.pages[0]!, props: {} })

    // the four: where each stood on the first page, their level, health and stress at the start and the end
    const byName = new Map(first.heroes.map((h) => [h.name, h.guid]))
    for (const [r, h] of first.heroes.entries()) {
      const end = last.heroes.find((x) => x.guid === h.guid), xp = heroData(firstRaw?.heroes?.[h.guid])?.resolveXp
      node({ id: id.hero(h.guid), kind: "hero", name: h.name, props: { guid: h.guid, cls: h.cls, className: await nameOf("class", h.cls) } })
      edge({ src: id.hero(h.guid), rel: "WENT_ON", dst: tid, trip: key, page: t.pages[0]!, props: {
        rank: r + 1, ...(typeof xp === "number" ? { level: levelOf(xp, thr) } : {}), hpStart: Math.round(h.hp), maxHp: h.maxHp, stressStart: h.stress,
        ...(end ? { hpEnd: Math.round(end.hp), stressEnd: end.stress } : { gone: true }), ...(lt ? { died: lt.died.includes(h.guid) } : {}) } })
    }

    // what the road told: Death's Door, afflictions and virtues, each on its page
    const fell = lt ? first.heroes.filter((h) => lt.died.includes(h.guid)).map((h) => h.name) : []
    for (const b of beats(snaps, fell)) {
      const g = b.who !== undefined ? byName.get(b.who) : undefined
      if (g === undefined || b.i >= snaps.length) continue
      const h = snaps[b.i]!.heroes.find((x) => x.guid === g)
      if (b.kind === "deathsdoor") edge({ src: id.hero(g), rel: "DEATHS_DOOR", dst: tid, trip: key, page: t.pages[b.i]!, props: { ...(h?.lastBlow ? { blow: h.lastBlow } : {}), ...(h?.blowCls ? { foe: id.foe(h.blowCls) } : {}) } })
      if (b.kind === "affliction" && h?.affliction) edge({ src: id.hero(g), rel: "AFFLICTED", dst: tid, trip: key, page: t.pages[b.i]!, props: { name: h.affliction } })
      if (b.kind === "virtue" && h?.virtue) edge({ src: id.hero(g), rel: "VIRTUE", dst: tid, trip: key, page: t.pages[b.i]!, props: { name: h.virtue } })
    }

    // quirks and diseases caught, page by page from the raw records, and each curio searched with what it gave or took
    const whole = snaps.length > 1 ? await debrief(snaps) : undefined
    const curioBeats = (whole?.beats ?? []).filter((b) => b.kind === "curio")
    let before = new Map<number, string[]>(Object.entries<any>(firstRaw?.heroes ?? {}).map(([g, h]) => [Number(g), Object.keys(heroData(h)?.quirks ?? {})]))
    for (let i = 1; i < snaps.length; i++) {
      const a = snaps[i - 1]!, b = snaps[i]!, raw = await rawOf(dir, t.pages[i]!)
      if (raw) {
        const now = new Map<number, string[]>(Object.entries<any>(raw.heroes ?? {}).map(([g, h]) => [Number(g), Object.keys(heroData(h)?.quirks ?? {})]))
        for (const [g, qs] of now) {
          const was = before.get(g)
          if (!was) continue
          for (const q of qs.filter((x) => !was.includes(x))) {
            const disease = !!qlib.get(q)?.disease
            node({ id: id.quirk(q), kind: "quirk", name: await nameOf("quirk", q), props: { disease, positive: !!qlib.get(q)?.positive } })
            edge({ src: id.hero(g), rel: "GAINED", dst: id.quirk(q), trip: key, page: t.pages[i]!, props: { disease } })
          }
        }
        before = now
      }
      const searched = (b.tally.CURIO_INVESTIGATED ?? 0) - (a.tally.CURIO_INVESTIGATED ?? 0)
      if (searched > 0 && raw) {
        const told = curioBeats.filter((x) => x.i === i)
        const found = Object.fromEntries(Object.entries(b.supplies).filter(([k, n]) => n > (a.supplies[k] ?? 0)).map(([k, n]) => [k, n - (a.supplies[k] ?? 0)]))
        for (const [k, c] of curioIds(raw, searched).entries()) {
          if (typeof c !== "string") continue
          node({ id: id.curio(c), kind: "curio", name: str.get(`str_curio_title_${c}`) ?? c.replace(/_/g, " "), props: {} })
          // the party searched it (the record keeps no searcher); what came of it is the tale's own line for that search
          edge({ src: tid, rel: "SEARCHED", dst: id.curio(c), trip: key, page: t.pages[i]!, props: { ...(k === 0 && Object.keys(found).length ? { found } : {}), ...(told[k] ? { said: told[k]!.text, bad: told[k]!.bad } : {}) } })
        }
      }
    }

    // what they carried: at the start, at the end, used and found between pages
    for (const k of [...new Set(snaps.flatMap((s) => Object.keys(s.supplies)))].sort()) {
      let usedN = 0, foundN = 0
      for (let i = 1; i < snaps.length; i++) { const d = (snaps[i]!.supplies[k] ?? 0) - (snaps[i - 1]!.supplies[k] ?? 0); if (d < 0) usedN -= d; else foundN += d }
      node({ id: id.item(k), kind: "item", name: await itemName(k, str), props: { provision: PROVISIONS.has(k) } })
      edge({ src: tid, rel: "CARRIED", dst: id.item(k), trip: key, page: t.pages[0]!, props: { start: first.supplies[k] ?? 0, end: last.supplies[k] ?? 0, used: usedN, found: foundN } })
    }

    // the special foes of this dungeon and level: a wanderer or a boss its usual halls do not field (C106)
    let special = new Map<string, "wanderer" | "boss">(), usual = new Set<string>()
    try { special = await specialOf(first.dungeon, first.difficulty); usual = new Set(await dungeonMonsters(first.dungeon, first.difficulty, ["hall", "room"])) } catch {}
    const met = meetings(snaps, special, usual)

    // the fights: who stood in each, how it ended, who struck whom with what, and who was slain by whom
    for (const [fi, f] of fights(snaps).entries()) {
      const p0 = f[0]!.page, pl = f.at(-1)!.page, fid = id.fight(key, t.pages[p0]!)
      const foesHere = f.flatMap((x) => x.snap.battle!.foes).filter((x) => x.cls && !/^corpse/i.test(x.cls))
      const before0 = snaps[p0 - 1], after = snaps[pl + 1]
      const ambushed = ((after ?? f.at(-1)!.snap).tally.AMBUSHED ?? 0) > ((before0 ?? f[0]!.snap).tally.AMBUSHED ?? 0)
      const end = fightEnd(snaps, f), rounds = Math.max(...f.map((x) => x.snap.battle!.round))
      node({ id: fid, kind: "fight", name: `${label}, fight ${fi + 1}`, props: {} })
      edge({ src: fid, rel: "HELD_IN", dst: tid, trip: key, page: t.pages[p0]!, props: { pages: f.length, from: t.pages[p0]!, to: t.pages[pl]!, rounds, end, ambushed } })
      const nameToCls = new Map<string, string>()
      for (const cls of [...new Set(foesHere.map((x) => x.cls!))].sort()) {
        const of = foesHere.filter((x) => x.cls === cls), name = of[0]!.name
        if (!nameToCls.has(name)) nameToCls.set(name, cls)
        const count = of.some((x) => x.guid) ? new Set(of.map((x) => x.guid)).size : Math.max(...f.map((x) => x.snap.battle!.foes.filter((y) => y.cls === cls).length))
        node({ id: id.foe(cls), kind: "foe", name, props: {} })
        edge({ src: id.foe(cls), rel: "FOUGHT", dst: fid, trip: key, page: t.pages[p0]!, props: { count } })
      }
      // the fight's blows, read by the debrief over its own pages: the page before it began, and the page after when out of it
      const lo = Math.max(0, p0 - 1), hi = after && !after.inBattle ? pl + 1 : pl
      const db = await debrief(snaps.slice(lo, hi + 1), lo)
      const ranks = new Map(f[0]!.snap.heroes.map((h, r) => [h.name, r + 1]))
      const clsOf = (rec: { cls?: string; name: string }) => (rec.cls && foesHere.some((x) => x.cls === rec.cls) ? rec.cls : nameToCls.get(rec.name))
      for (const rec of db.foes) {
        const cls = clsOf(rec)
        if (!cls) continue // a foe this fight's pages never showed is never named (C5)
        for (const [who, hit] of Object.entries(rec.by ?? {})) {
          const g = byName.get(who)
          if (g === undefined) continue
          const rank = ranks.get(who)
          if (hit.hp > 0 || hit.blows > 0) edge({ src: id.foe(cls), rel: "STRUCK", dst: id.hero(g), trip: key, page: t.pages[p0]!, props: { fight: fid, health: hit.hp, blows: hit.blows, crits: hit.crits, ...(Object.keys(hit.attacks).length ? { attacks: hit.attacks } : {}), ...(rank ? { rank } : {}) } })
          if (hit.bleed > 0) edge({ src: id.foe(cls), rel: "BLED", dst: id.hero(g), trip: key, page: t.pages[p0]!, props: { fight: fid, health: hit.bleed, ...(rank ? { rank } : {}) } })
          if (hit.blight > 0) edge({ src: id.foe(cls), rel: "BLIGHTED", dst: id.hero(g), trip: key, page: t.pages[p0]!, props: { fight: fid, health: hit.blight, ...(rank ? { rank } : {}) } })
        }
      }
      // the slain: each foe gone from the fight between two of its pages, laid at the one hero whose turn came when only one did
      const slain = slainIn(f.map((x) => ({ page: String(x.page), snap: x.snap })))
      const kills = new Map<string, { g: number; cls: string; pages: number[] }>()
      for (const s of slain) {
        const cls = foesHere.find((x) => x.guid === s.guid)?.cls, g = s.by ? byName.get(s.by) : undefined
        if (!cls || g === undefined) continue
        const k = `${g}|${cls}`, was = kills.get(k) ?? { g, cls, pages: [] }
        was.pages.push(t.pages[Number(s.page)]!); kills.set(k, was)
      }
      for (const k of kills.values()) edge({ src: id.hero(k.g), rel: "SLEW", dst: id.foe(k.cls), trip: key, page: k.pages[0]!, props: { fight: fid, count: k.pages.length, pages: k.pages } })

      // what the fight laid on the four, each effect with the foe the game records as its source, and what it did to their stress
      // and minds (the record lays stress, afflictions and stuns at no foe, so those stay the fight's)
      const laid: { cls: string; hero: string; name: string; effect: string; page: number }[] = [], stunned: Encounter["challenges"]["stunned"] = [], afflicted: Encounter["challenges"]["afflicted"] = []
      for (let i = p0; i <= pl; i++) {
        const s = snaps[i]!, prev = snaps[i - 1]
        for (const h of s.heroes) {
          const w = prev?.heroes.find((x) => x.guid === h.guid)
          for (const e of (h.effects ?? []).filter((e) => freshEffect(e, w?.effects ?? []))) {
            const from = e.match(/ from (\S+)$/)?.[1]
            if (from && foesHere.some((x) => x.cls === from)) laid.push({ cls: from, hero: id.hero(h.guid), name: h.name, effect: await effectWords(e), page: t.pages[i]! })
          }
          if (h.stunned && !w?.stunned) stunned.push({ name: h.name, page: t.pages[i]! })
          if (h.affliction && !w?.affliction) afflicted.push({ name: h.name, affliction: h.affliction, page: t.pages[i]! })
        }
      }
      const startSnap = before0 ?? f[0]!.snap, endSnap = after ?? f.at(-1)!.snap
      const stress = f[0]!.snap.heroes.flatMap((h) => {
        const s0 = startSnap.heroes.find((x) => x.guid === h.guid)?.stress ?? h.stress, e = endSnap.heroes.find((x) => x.guid === h.guid)
        return e && e.stress !== s0 ? [{ name: h.name, from: s0, to: e.stress }] : []
      })

      // the lineup: the foe types as they stood, rank 1 to 4, on the fight's first page; the group is the same mix in any order
      const lineup = f[0]!.snap.battle!.foes.filter((x) => x.cls && !/^corpse/i.test(x.cls)).map((x) => x.cls!)
      const types = [...new Set(foesHere.map((x) => x.cls!))].sort()
      if (lineup.length) {
        const mix = [...new Set(lineup)].sort(), gid = id.group(mix)
        const names = await Promise.all(mix.map(async (c) => nodes.get(id.foe(c))?.name ?? (await nameOf("monster", c))))
        node({ id: gid, kind: "foegroup", name: names.join(", "), props: { key: mix.join("+"), foes: mix.map(id.foe) } })
        const harmBy = new Map<string, { health: number; bleed: number; blight: number }>()
        for (const rec of db.foes) {
          if (!clsOf(rec)) continue
          for (const [who, hit] of Object.entries(rec.by ?? {})) { const w = harmBy.get(who) ?? { health: 0, bleed: 0, blight: 0 }; w.health += hit.hp; w.bleed += hit.bleed; w.blight += hit.blight; harmBy.set(who, w) }
        }
        edge({ src: fid, rel: "LINEUP", dst: gid, trip: key, page: t.pages[p0]!, props: {
          order: lineup.map((c) => nodes.get(id.foe(c))?.name ?? c), dungeon: first.dungeon, level: first.difficulty, end, rounds, ambushed,
          harm: [...harmBy].map(([name, v]) => ({ name, ...v })).sort((a, b) => a.name.localeCompare(b.name)),
          stress, effects: laid.map(({ name, effect, page }) => ({ name, effect, page })), stunned, afflicted } })
        edge({ src: gid, rel: "SEEN_IN", dst: did, trip: key, page: t.pages[p0]!, props: {} })
      }
      // every two foe types that stood in the fight together
      for (let a = 0; a < types.length; a++) for (let b = a + 1; b < types.length; b++) edge({ src: id.foe(types[a]!), rel: "FOUGHT_BESIDE", dst: id.foe(types[b]!), trip: key, page: t.pages[p0]!, props: { fight: fid } })

      // a special foe met in this fight: the meeting, and its encounter kept whole
      const m = met.find((x) => x.page === p0)
      if (!m || !nodes.has(id.foe(m.cls))) continue
      edge({ src: tid, rel: "MET_SPECIAL", dst: id.foe(m.cls), trip: key, page: t.pages[p0]!, props: { kind: m.kind, outcome: m.outcome, rounds: m.rounds, brought: m.brought, brink: m.brink } })
      const parts = new Set(foesHere.filter((x) => special.has(x.cls!)).map((x) => x.cls!))
      const mine = db.foes.filter((rec) => { const c = clsOf(rec); return !!c && parts.has(c) })
      const attacks = new Map<string, { blows: number; health: number }>()
      for (const rec of mine) for (const hit of Object.values(rec.by ?? {})) for (const [a, nb] of Object.entries(hit.attacks)) { const w = attacks.get(a) ?? { blows: 0, health: 0 }; w.blows += nb; w.health += hit.attackHp?.[a] ?? 0; attacks.set(a, w) }
      const struck = first.heroes.flatMap((h) => {
        const hits = mine.map((rec) => rec.by?.[h.name]).filter((x) => !!x)
        if (!hits.length) return []
        return [{ hero: id.hero(h.guid), name: h.name, health: sum(hits.map((x) => x!.hp)), blows: sum(hits.map((x) => x!.blows)), crits: sum(hits.map((x) => x!.crits)), bleed: sum(hits.map((x) => x!.bleed)), blight: sum(hits.map((x) => x!.blight)) }]
      }).filter((x) => x.health + x.bleed + x.blight > 0 || x.blows > 0)
      const effects = laid.filter((x) => parts.has(x.cls)).map(({ hero, name, effect, page }) => ({ hero, name, effect, page }))
      const at = f[0]!.snap, here = at.map?.here, area = here ? at.map!.areas.find((x) => x.id === here.area) : undefined
      const wiped = m.outcome !== "won" && !!lt && first.heroes.every((h) => lt.died.includes(h.guid)) && !snaps.slice(pl + 1).some((s) => s.battle)
      const enc: Encounter = {
        foe: id.foe(m.cls), name: m.name, kind: m.kind, trip: tid, tripName: label, dungeon: first.dungeon, level: first.difficulty,
        pages: { from: t.pages[p0]!, to: t.pages[pl]! },
        ...(area ? { where: { area: area.room ? "room" : "corridor", name: area.name } } : {}),
        context: {
          four: await Promise.all(at.heroes.map(async (h, r) => ({ hero: id.hero(h.guid), name: h.name, cls: await nameOf("class", h.cls), rank: r + 1, hp: Math.round(h.hp), maxHp: h.maxHp, stress: h.stress }))),
          torch: (before0 ?? at).torch, ambushed, alongside: [...new Set(at.battle!.foes.filter((x) => x.cls && !parts.has(x.cls) && !/^corpse/i.test(x.cls)).map((x) => x.name))],
        },
        challenges: {
          attacks: [...attacks].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.health - a.health || a.name.localeCompare(b.name)),
          struck, effects, deathsDoor: m.brink,
          others: db.foes.filter((rec) => { const c = clsOf(rec); return !!c && !parts.has(c) }).map((rec) => ({ name: rec.name, health: rec.hp, bleed: rec.bleed, blight: rec.blight })).filter((x) => x.health + x.bleed + x.blight > 0).sort((a, b) => b.health + b.bleed + b.blight - (a.health + a.bleed + a.blight) || a.name.localeCompare(b.name)),
          stress, afflicted, stunned, brought: m.brought,
        },
        rounds, kills: slain.map((s) => s.name), slain: slain.some((s) => parts.has(foesHere.find((x) => x.guid === s.guid)?.cls ?? "")), outcome: wiped ? "wiped" : m.outcome,
      }
      const eid = id.encounter(key, t.pages[p0]!)
      node({ id: eid, kind: "encounter", name: `${m.name}, ${label}`, props: enc as unknown as Record<string, unknown> })
      edge({ src: eid, rel: "OF", dst: id.foe(m.cls), trip: key, page: t.pages[p0]!, props: {} })
      edge({ src: eid, rel: "ON", dst: tid, trip: key, page: t.pages[p0]!, props: {} })
      edge({ src: eid, rel: "AT", dst: did, trip: key, page: t.pages[p0]!, props: {} })
      edge({ src: eid, rel: "DURING", dst: fid, trip: key, page: t.pages[p0]!, props: { from: t.pages[p0]!, to: t.pages[pl]! } })
    }

    // what the road taught: the ledger's lessons for this trip, and what teachings() reads from the pages
    const kept = lt ? ledger.filter((l) => l.dungeon === first.dungeon && l.week === lt.week) : []
    const healers = (await Promise.all(first.heroes.map(async (h) => {
      const sk = (await heroClass(h.cls)).skills, mine = Object.keys(heroData(firstRaw?.heroes?.[h.guid])?.skills?.selected_combat_skills ?? {})
      return mine.some((s) => sk.get(s)?.heal && sk.get(s)!.targetsAllies && sk.get(s)!.healAvg >= RULE.realHeal) ? h.name : ""
    }))).filter(Boolean)
    const base = { dungeon: first.dungeon, difficulty: first.difficulty, length: first.length, week: lt?.week ?? 0, trip: label }
    const taught = teachings(snaps, beats(snaps, fell), whole, base, healers, met, `the ${dungeonName}`).lessons
    for (const l of [...kept, ...taught]) {
      const lid = id.lesson(l)
      if (lessonsSeen.has(lid)) continue
      lessonsSeen.add(lid)
      lessonNode(node, l)
      edge({ src: tid, rel: "TAUGHT", dst: lid, trip: key, page: null, props: { from: kept.includes(l) ? "ledger" : "teachings" } })
    }
  }
  // the ledger's lessons from trips the chronicle never kept stand on their own, seen on no trip of the chronicle
  ord = null
  for (const l of ledger) if (!lessonsSeen.has(id.lesson(l))) { lessonsSeen.add(id.lesson(l)); lessonNode(node, l) }
  return { nodes: [...nodes.values()], edges }
}

function lessonNode(node: (n: Omit<Node, "first">) => void, l: Lesson) {
  node({ id: id.lesson(l), kind: "lesson", name: l.text, props: { kind: l.kind, dungeon: l.dungeon, difficulty: l.difficulty, length: l.length, week: l.week, trip: l.trip, ...(l.foe ? { foe: l.foe } : {}) } })
}

const SCHEMA = `
CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, first_trip INTEGER, props TEXT NOT NULL);
CREATE TABLE edges (src TEXT NOT NULL, rel TEXT NOT NULL, dst TEXT NOT NULL, trip TEXT NOT NULL, ord INTEGER, page INTEGER, props TEXT NOT NULL);
CREATE INDEX edges_rel ON edges (rel);
CREATE INDEX edges_src ON edges (src);
CREATE INDEX edges_dst ON edges (dst);
CREATE INDEX nodes_kind ON nodes (kind);
-- each link once: the trip it was first seen on, every trip that saw it again, and how many times it was seen
CREATE VIEW links AS SELECT src, rel, dst, MIN(ord) first_trip, json_group_array(DISTINCT ord) trips, COUNT(*) weight FROM edges GROUP BY src, rel, dst;`

/** Builds the graph afresh at `file` (default <outDir()>/graph.db): the old one is removed first, so a rebuild is the same graph. */
export async function build(opts: { campaignLog?: any; file?: string } = {}): Promise<{ file: string; nodes: Record<string, number>; edges: Record<string, number> }> {
  const { nodes, edges } = await derive(opts), file = opts.file ?? graphFile()
  for (const x of ["", "-wal", "-shm", "-journal"]) rmSync(file + x, { force: true })
  const db = new Database(file, { create: true })
  db.exec(SCHEMA)
  const n = db.prepare("INSERT INTO nodes VALUES (?, ?, ?, ?, ?)"), e = db.prepare("INSERT INTO edges VALUES (?, ?, ?, ?, ?, ?, ?)")
  const rows = edges.map((x) => [x.src, x.rel, x.dst, x.trip, x.ord, x.page, json(x.props)] as const).sort((a, b) => a.join("\u0000").localeCompare(b.join("\u0000")))
  db.transaction(() => {
    for (const x of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) n.run(x.id, x.kind, x.name, x.first, json(x.props))
    for (const r of rows) e.run(...r)
  })()
  const s = stats(db)
  db.close()
  return { file, ...s }
}

export const open = (file = graphFile()) => new Database(file, { readonly: true })

export function stats(db: Database): { nodes: Record<string, number>; edges: Record<string, number> } {
  const nodes = Object.fromEntries(db.query<{ kind: string; n: number }, []>("SELECT kind, COUNT(*) n FROM nodes GROUP BY kind ORDER BY kind").all().map((r) => [r.kind, r.n]))
  const edges = Object.fromEntries(db.query<{ rel: string; n: number }, []>("SELECT rel, COUNT(*) n FROM edges GROUP BY rel ORDER BY rel").all().map((r) => [r.rel, r.n]))
  return { nodes, edges }
}

// ---------- the export, for a viewer that replays the graph trip by trip ----------

export interface GraphExport {
  trips: { id: string; ordinal: number; label: string; dungeon: string; level: string; length: string; outcome?: string }[]
  nodes: { id: string; kind: string; label: string; firstTrip: number | null }[]
  edges: { from: string; to: string; kind: string; firstTrip: number | null; trips: number[]; weight: number }[]
  groups: (Omit<FoeGroup, "dungeons"> & { dungeons: { dungeon: string; times: number }[] })[]
}

/** The whole graph as one document: labels are the Hamlet's own names, every node and edge with the trip it was first seen on,
 *  every edge with each trip that saw it and how many times. The same graph always gives the same text. */
export function exportGraph(db: Database): GraphExport {
  const trips = db.query<{ id: string; name: string; props: string }, []>("SELECT id, name, props FROM nodes WHERE kind = 'trip' ORDER BY first_trip, id").all().map((r) => {
    const p = JSON.parse(r.props), dn = db.query<{ name: string }, [string]>("SELECT n.name FROM edges e JOIN nodes n ON n.id = e.dst WHERE e.rel = 'IN' AND e.src = ?").get(r.id)?.name ?? ""
    return { id: r.id, ordinal: p.ordinal, label: r.name, dungeon: dn.split(", ")[0]!, level: DIFFICULTY[p.difficulty] ?? String(p.difficulty), length: LENGTH[p.length] ?? String(p.length),
      ...(p.outcome ? { outcome: p.outcome } : p.questDone !== undefined ? { outcome: p.questDone ? "quest done" : "quest not done" } : {}) }
  })
  const nodes = db.query<{ id: string; kind: string; name: string; first_trip: number | null }, []>("SELECT id, kind, name, first_trip FROM nodes ORDER BY COALESCE(first_trip, 0), kind, id").all()
    .map((n) => ({ id: n.id, kind: n.kind, label: n.name, firstTrip: n.first_trip }))
  const edges = db.query<{ src: string; rel: string; dst: string; first_trip: number | null; trips: string; weight: number }, []>("SELECT * FROM links ORDER BY COALESCE(first_trip, 0), rel, src, dst").all()
    .map((e) => ({ from: e.src, to: e.dst, kind: e.rel, firstTrip: e.first_trip, trips: (JSON.parse(e.trips) as (number | null)[]).filter((x): x is number => x !== null).sort((a, b) => a - b), weight: e.weight }))
  // the lineups with what they did, their dungeons by the Hamlet's name; who fights beside whom is the FOUGHT_BESIDE edges
  const place = (d: string, l: number) => db.query<{ name: string }, [string]>("SELECT name FROM nodes WHERE id = ?").get(id.dungeon(d, l))?.name ?? ""
  const groups = foeGroups(db).mostSeen.map(({ dungeons, ...g }) => ({ ...g, dungeons: dungeons.map((d) => ({ dungeon: place(d.dungeon, d.level), times: d.times })) }))
  return { trips, nodes, edges, groups }
}

// ---------- queries: plain SQL over the graph, each returning plain objects ----------

const tripsIn = `SELECT e.trip FROM edges e JOIN nodes d ON d.id = e.dst WHERE e.rel = 'IN' AND (?1 IS NULL OR json_extract(d.props, '$.dungeon') = ?1) AND (?2 IS NULL OR json_extract(d.props, '$.level') = ?2)`

export interface FoeThreat { foe: string; name: string; fights: number; met: number; health: number; healthPerFight: number; blows: number; crits: number; critRate: number; bleed: number; blight: number
  heroes: { hero: string; name: string; health: number }[]; ranks: { rank: number; health: number }[]; attacks: Record<string, number> }

/** Per foe met in a dungeon at a level (either may be left out): fights it stood in, the health it took in each, its criticals,
 *  bleed and blight, and whom and which ranks it went for. `foe` narrows to one foe node. */
export function foeThreat(db: Database, dungeon?: string | null, level?: number | null, foe?: string): FoeThreat[] {
  const args = [dungeon ?? null, level ?? null] as const
  const fought = db.query<{ foe: string; name: string; fights: number; met: number }, [string | null, number | null]>(`
    SELECT e.src foe, n.name, COUNT(DISTINCT e.dst) fights, SUM(json_extract(e.props, '$.count')) met FROM edges e JOIN nodes n ON n.id = e.src
    WHERE e.rel = 'FOUGHT' AND e.trip IN (${tripsIn}) GROUP BY e.src ORDER BY e.src`).all(...args)
  const harm = db.query<{ foe: string; rel: string; hero: string; name: string; rank: number | null; health: number; blows: number; crits: number }, [string | null, number | null]>(`
    SELECT e.src foe, e.rel, e.dst hero, n.name, json_extract(e.props, '$.rank') rank, SUM(json_extract(e.props, '$.health')) health,
      SUM(COALESCE(json_extract(e.props, '$.blows'), 0)) blows, SUM(COALESCE(json_extract(e.props, '$.crits'), 0)) crits
    FROM edges e JOIN nodes n ON n.id = e.dst WHERE e.rel IN ('STRUCK', 'BLED', 'BLIGHTED') AND e.trip IN (${tripsIn})
    GROUP BY e.src, e.rel, e.dst, rank ORDER BY e.src, e.rel, e.dst, rank`).all(...args)
  const attacks = db.query<{ foe: string; attack: string; n: number }, [string | null, number | null]>(`
    SELECT e.src foe, a.key attack, SUM(a.value) n FROM edges e, json_each(e.props, '$.attacks') a
    WHERE e.rel = 'STRUCK' AND e.trip IN (${tripsIn}) GROUP BY e.src, a.key ORDER BY e.src, a.key`).all(...args)
  return fought.filter((f) => !foe || f.foe === foe).map((f) => {
    const mine = harm.filter((h) => h.foe === f.foe), struck = mine.filter((h) => h.rel === "STRUCK")
    const health = sum(mine.map((h) => h.health)), blows = sum(struck.map((h) => h.blows)), crits = sum(struck.map((h) => h.crits))
    const heroes = new Map<string, { hero: string; name: string; health: number }>(), ranks = new Map<number, number>()
    for (const h of mine) {
      heroes.set(h.hero, { hero: h.hero, name: h.name, health: (heroes.get(h.hero)?.health ?? 0) + h.health })
      if (h.rank) ranks.set(h.rank, (ranks.get(h.rank) ?? 0) + h.health)
    }
    return { foe: f.foe, name: f.name, fights: f.fights, met: f.met, health, healthPerFight: Math.round((health / f.fights) * 10) / 10, blows, crits, critRate: blows ? Math.round((crits / blows) * 100) / 100 : 0,
      bleed: sum(mine.filter((h) => h.rel === "BLED").map((h) => h.health)), blight: sum(mine.filter((h) => h.rel === "BLIGHTED").map((h) => h.health)),
      heroes: [...heroes.values()].sort((a, b) => b.health - a.health || a.hero.localeCompare(b.hero)), ranks: [...ranks].map(([rank, health]) => ({ rank, health })).sort((a, b) => a.rank - b.rank),
      attacks: Object.fromEntries(attacks.filter((a) => a.foe === f.foe).map((a) => [a.attack, a.n])) }
  }).sort((a, b) => b.health - a.health || a.foe.localeCompare(b.foe))
}

export interface HeroRecord { hero: string; name: string; cls: string; trips: { trip: string; name: string; rank: number; level?: number; died?: boolean }[]; kills: number; healthLost: number; deathsDoor: number
  afflictions: { trip: string; name: string; page: number }[]; virtues: { trip: string; name: string; page: number }[]; quirks: { quirk: string; name: string; disease: boolean; trip: string; page: number }[] }

/** One hero's road: trips, kills, health lost to foes, Death's Door, afflictions and virtues, quirks and diseases caught. */
export function heroRecord(db: Database, guid: number): HeroRecord | undefined {
  const hid = id.hero(guid), h = db.query<{ name: string; props: string }, [string]>("SELECT name, props FROM nodes WHERE id = ?").get(hid)
  if (!h) return undefined
  const trips = db.query<{ trip: string; name: string; rank: number; level: number | null; died: number | null }, [string]>(`
    SELECT e.dst trip, n.name, json_extract(e.props, '$.rank') rank, json_extract(e.props, '$.level') level, json_extract(e.props, '$.died') died
    FROM edges e JOIN nodes n ON n.id = e.dst WHERE e.rel = 'WENT_ON' AND e.src = ? ORDER BY n.first_trip, e.dst`).all(hid)
  const one = (sql: string) => Number(db.query<{ n: number | null }, [string]>(sql).get(hid)?.n ?? 0)
  const named = (rel: string) => db.query<{ trip: string; name: string; page: number }, [string]>(`SELECT dst trip, json_extract(props, '$.name') name, page FROM edges WHERE rel = '${rel}' AND src = ? ORDER BY ord, page`).all(hid)
  return {
    hero: hid, name: h.name, cls: String(JSON.parse(h.props).className ?? ""),
    trips: trips.map((t) => ({ trip: t.trip, name: t.name, rank: t.rank, ...(t.level !== null ? { level: t.level } : {}), ...(t.died !== null ? { died: !!t.died } : {}) })),
    kills: one("SELECT SUM(json_extract(props, '$.count')) n FROM edges WHERE rel = 'SLEW' AND src = ?"),
    healthLost: one("SELECT SUM(json_extract(props, '$.health')) n FROM edges WHERE rel IN ('STRUCK', 'BLED', 'BLIGHTED') AND dst = ?"),
    deathsDoor: one("SELECT COUNT(*) n FROM edges WHERE rel = 'DEATHS_DOOR' AND src = ?"),
    afflictions: named("AFFLICTED"), virtues: named("VIRTUE"),
    quirks: db.query<{ quirk: string; name: string; disease: number; trip: string; page: number }, [string]>(`
      SELECT e.dst quirk, n.name, json_extract(e.props, '$.disease') disease, e.trip, e.page FROM edges e JOIN nodes n ON n.id = e.dst
      WHERE e.rel = 'GAINED' AND e.src = ? ORDER BY e.ord, e.page, e.dst`).all(hid).map((q) => ({ ...q, disease: !!q.disease })),
  }
}

/** Heroes by name, any case. */
export const heroesNamed = (db: Database, name: string) => db.query<{ id: string; name: string }, [string]>("SELECT id, name FROM nodes WHERE kind = 'hero' AND lower(name) = lower(?) ORDER BY id").all(name)
/** Foes by display name or variant, any case. */
export const foesNamed = (db: Database, name: string) => db.query<{ id: string; name: string }, [string]>("SELECT id, name FROM nodes WHERE kind = 'foe' AND (lower(name) = lower(?1) OR lower(id) = lower('foe:' || ?1) OR lower(id) = lower(?1)) ORDER BY id").all(name)

export interface PartyOutcome { trip: string; name: string; dungeon: string; level: number; length: number; quest: string; outcome?: string; questDone?: boolean
  four: { hero: string; name: string; cls: string; rank: number; died?: boolean }[] }

/** Each trip's four by class and rank, with how it ended. */
export function partyOutcomes(db: Database, dungeon?: string | null): PartyOutcome[] {
  const rows = db.query<{ id: string; name: string; props: string }, [string | null]>(`SELECT id, name, props FROM nodes WHERE kind = 'trip' AND (?1 IS NULL OR json_extract(props, '$.dungeon') = ?1) ORDER BY first_trip, id`).all(dungeon ?? null)
  const four = db.query<{ hero: string; name: string; props: string; rank: number; died: number | null }, [string]>(`
    SELECT e.src hero, n.name, n.props, json_extract(e.props, '$.rank') rank, json_extract(e.props, '$.died') died FROM edges e JOIN nodes n ON n.id = e.src
    WHERE e.rel = 'WENT_ON' AND e.dst = ? ORDER BY rank`)
  return rows.map((r) => {
    const p = JSON.parse(r.props)
    return { trip: r.id, name: r.name, dungeon: p.dungeon, level: p.difficulty, length: p.length, quest: p.quest, ...(p.outcome ? { outcome: p.outcome } : {}), ...(p.questDone !== undefined ? { questDone: p.questDone } : {}),
      four: four.all(r.id).map((h) => ({ hero: h.hero, name: h.name, cls: String(JSON.parse(h.props).className ?? ""), rank: h.rank, ...(h.died !== null ? { died: !!h.died } : {}) })) }
  })
}

export interface SupplyUse { item: string; name: string; provision: boolean; trips: number; carried: number; used: number; found: number; ranOut: number; low: number
  per: { trip: string; start: number; end: number; used: number; found: number }[] }

/** Per item on the roads to a dungeon of a length: what was carried, used and found, and how often it ran out or came home low
 *  (CHRONICLE_RULE.lowLeft or fewer, my habit). */
export function supplyUse(db: Database, dungeon: string, length?: number | null): SupplyUse[] {
  const rows = db.query<{ item: string; name: string; iprops: string; trip: string; start: number; end: number; used: number; found: number }, [string, number | null]>(`
    SELECT e.dst item, n.name, n.props iprops, e.trip, json_extract(e.props, '$.start') start, json_extract(e.props, '$.end') end,
      json_extract(e.props, '$.used') used, json_extract(e.props, '$.found') found
    FROM edges e JOIN nodes n ON n.id = e.dst JOIN nodes t ON t.id = e.src
    WHERE e.rel = 'CARRIED' AND json_extract(t.props, '$.dungeon') = ?1 AND (?2 IS NULL OR json_extract(t.props, '$.length') = ?2)
    ORDER BY e.dst, t.first_trip`).all(dungeon, length ?? null)
  const by = new Map<string, SupplyUse>()
  for (const r of rows) {
    const u = by.get(r.item) ?? { item: r.item, name: r.name, provision: !!JSON.parse(r.iprops).provision, trips: 0, carried: 0, used: 0, found: 0, ranOut: 0, low: 0, per: [] }
    u.trips++; u.carried += r.start; u.used += r.used; u.found += r.found
    if (r.start > 0 && r.end === 0) u.ranOut++
    if (r.start > 0 && r.end <= CHRONICLE_RULE.lowLeft) u.low++
    u.per.push({ trip: r.trip, start: r.start, end: r.end, used: r.used, found: r.found })
    by.set(r.item, u)
  }
  return [...by.values()]
}

export interface SpecialMeeting { trip: string; tripName: string; dungeon: string; level: number; foe: string; name: string; page: number; kind: string; outcome: string; rounds: number; brought: string[]; brink: string[] }

/** The special foes met (C106), with how each meeting ended. */
export function specialFoes(db: Database, dungeon?: string | null): SpecialMeeting[] {
  return db.query<{ trip: string; tripName: string; tprops: string; foe: string; name: string; page: number; props: string }, [string | null]>(`
    SELECT e.src trip, t.name tripName, t.props tprops, e.dst foe, n.name, e.page, e.props FROM edges e JOIN nodes n ON n.id = e.dst JOIN nodes t ON t.id = e.src
    WHERE e.rel = 'MET_SPECIAL' AND (?1 IS NULL OR json_extract(t.props, '$.dungeon') = ?1) ORDER BY t.first_trip, e.page`).all(dungeon ?? null).map((r) => {
    const p = JSON.parse(r.props), tp = JSON.parse(r.tprops)
    return { trip: r.trip, tripName: r.tripName, dungeon: tp.dungeon, level: tp.difficulty, foe: r.foe, name: r.name, page: r.page, kind: p.kind, outcome: p.outcome, rounds: p.rounds, brought: p.brought, brink: p.brink }
  })
}

export interface Dossier { foe: string; name: string; meetings: Encounter[]
  tally: { met: number; outcomes: Record<string, number>; hardestAttack?: { name: string; blows: number; health: number; perBlow: number }; hurtMost: { name: string; health: number }[] } }

/** Every meeting with a special foe, each its whole encounter, and a tally across them, so the next meeting is prepared. */
export function encounterDossier(db: Database, foe: string): Dossier | undefined {
  const f = foesNamed(db, foe)[0]
  if (!f) return undefined
  const meetings = db.query<{ props: string }, [string]>(`SELECT n.props FROM edges e JOIN nodes n ON n.id = e.src WHERE e.rel = 'OF' AND e.dst = ? ORDER BY n.first_trip, e.page`).all(f.id).map((r) => JSON.parse(r.props) as Encounter)
  const outcomes: Record<string, number> = {}, attacks = new Map<string, { blows: number; health: number }>(), hurt = new Map<string, number>()
  for (const m of meetings) {
    outcomes[m.outcome] = (outcomes[m.outcome] ?? 0) + 1
    for (const a of m.challenges.attacks) { const w = attacks.get(a.name) ?? { blows: 0, health: 0 }; w.blows += a.blows; w.health += a.health; attacks.set(a.name, w) }
    for (const s of m.challenges.struck) hurt.set(s.name, (hurt.get(s.name) ?? 0) + s.health + s.bleed + s.blight)
  }
  const hardest = [...attacks].map(([name, v]) => ({ name, ...v, perBlow: v.blows ? Math.round((v.health / v.blows) * 10) / 10 : 0 })).sort((a, b) => b.perBlow - a.perBlow || b.health - a.health || a.name.localeCompare(b.name))[0]
  return { foe: f.id, name: f.name, meetings, tally: { met: meetings.length, outcomes, ...(hardest ? { hardestAttack: hardest } : {}), hurtMost: [...hurt].map(([name, health]) => ({ name, health })).sort((a, b) => b.health - a.health || a.name.localeCompare(b.name)) } }
}

export interface FoeGroup { group: string; label: string; foes: string[]; met: number; outcomes: Record<string, number>; orders: { order: string[]; times: number }[]
  dungeons: { dungeon: string; level: number; times: number }[]; health: number; bleed: number; blight: number; perHero: { name: string; health: number }[]
  stress: number; stressPerHero: { name: string; stress: number }[]; effects: Record<string, number>; ambushed: number; rounds: number; firstTrip: number | null; trips: number[] }

/** The lineups met, as witnessed: how often, how each fight ended, the health they took in all and from whom, the stress the
 *  four gained in those fights (the record lays stress at no one foe), the effects they laid, the ambushes and the rounds. */
export function foeGroups(db: Database, dungeon?: string | null, level?: number | null): { mostSeen: FoeGroup[]; hurtMost: FoeGroup[] } {
  const rows = db.query<{ grp: string; label: string; gprops: string; ord: number | null; props: string }, [string | null, number | null]>(`
    SELECT e.dst grp, n.name label, n.props gprops, e.ord, e.props FROM edges e JOIN nodes n ON n.id = e.dst
    WHERE e.rel = 'LINEUP' AND (?1 IS NULL OR json_extract(e.props, '$.dungeon') = ?1) AND (?2 IS NULL OR json_extract(e.props, '$.level') = ?2)
    ORDER BY e.dst, e.ord, e.src`).all(dungeon ?? null, level ?? null)
  const by = new Map<string, FoeGroup>()
  for (const r of rows) {
    const p = JSON.parse(r.props)
    const g: FoeGroup = by.get(r.grp) ?? { group: r.grp, label: r.label, foes: JSON.parse(r.gprops).foes, met: 0, outcomes: {}, orders: [], dungeons: [], health: 0, bleed: 0, blight: 0, perHero: [], stress: 0, stressPerHero: [], effects: {}, ambushed: 0, rounds: 0, firstTrip: r.ord, trips: [] }
    g.met++; g.outcomes[p.end] = (g.outcomes[p.end] ?? 0) + 1; g.rounds += p.rounds; if (p.ambushed) g.ambushed++
    if (r.ord !== null && !g.trips.includes(r.ord)) g.trips.push(r.ord)
    const o = g.orders.find((x) => x.order.join() === p.order.join()); if (o) o.times++; else g.orders.push({ order: p.order, times: 1 })
    const d = g.dungeons.find((x) => x.dungeon === p.dungeon && x.level === p.level); if (d) d.times++; else g.dungeons.push({ dungeon: p.dungeon, level: p.level, times: 1 })
    for (const h of p.harm) {
      g.health += h.health; g.bleed += h.bleed; g.blight += h.blight
      const w = g.perHero.find((x) => x.name === h.name); if (w) w.health += h.health + h.bleed + h.blight; else g.perHero.push({ name: h.name, health: h.health + h.bleed + h.blight })
    }
    for (const s of p.stress) { const gain = s.to - s.from; if (gain <= 0) continue; g.stress += gain; const w = g.stressPerHero.find((x) => x.name === s.name); if (w) w.stress += gain; else g.stressPerHero.push({ name: s.name, stress: gain }) }
    for (const e of p.effects) { const k = String(e.effect).replace(/ for \d+ rounds?/, ""); g.effects[k] = (g.effects[k] ?? 0) + 1 }
    by.set(r.grp, g)
  }
  const all = [...by.values()].map((g) => ({ ...g, perHero: g.perHero.sort((a, b) => b.health - a.health || a.name.localeCompare(b.name)), stressPerHero: g.stressPerHero.sort((a, b) => b.stress - a.stress || a.name.localeCompare(b.name)), orders: g.orders.sort((a, b) => b.times - a.times || a.order.join().localeCompare(b.order.join())) }))
  const total = (g: FoeGroup) => g.health + g.bleed + g.blight
  return { mostSeen: [...all].sort((a, b) => b.met - a.met || total(b) - total(a) || a.group.localeCompare(b.group)), hurtMost: [...all].sort((a, b) => total(b) - total(a) || b.met - a.met || a.group.localeCompare(b.group)) }
}

/** Who a foe fights beside: every foe type seen in a fight with it, with how many fights and on which trips. */
export function companions(db: Database, foe: string): { foe: string; name: string; beside: { foe: string; name: string; fights: number; firstTrip: number | null; trips: number[] }[] } | undefined {
  const f = foesNamed(db, foe)[0]
  if (!f) return undefined
  const rows = db.query<{ other: string; name: string; fights: number; first_trip: number | null; trips: string }, [string]>(`
    SELECT CASE WHEN l.src = ?1 THEN l.dst ELSE l.src END other, n.name, l.weight fights, l.first_trip, l.trips FROM links l
    JOIN nodes n ON n.id = CASE WHEN l.src = ?1 THEN l.dst ELSE l.src END
    WHERE l.rel = 'FOUGHT_BESIDE' AND (l.src = ?1 OR l.dst = ?1) ORDER BY l.weight DESC, other`).all(f.id)
  return { foe: f.id, name: f.name, beside: rows.map((r) => ({ foe: r.other, name: r.name, fights: r.fights, firstTrip: r.first_trip, trips: (JSON.parse(r.trips) as (number | null)[]).filter((x): x is number => x !== null).sort((a, b) => a - b) })) }
}
