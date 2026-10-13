// C113: the expeditions form one knowledge graph (Soushi, 2026-10-13: "Ensure you can build a graph knowledge based on all the
// expedition informations"). A synthetic chronicle of two trips, written under .dd-runtime for the test only, and the live
// chronicle read where it lies when there is one (DD_GRAPH_LIVE, else .local/town), its graph built under .dd-runtime.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { root } from "../src/sources/paths.ts"
import type { Snap } from "../src/road/chronicle.ts"
import { build, companions, encounterDossier, exportGraph, foeGroups, foeThreat, heroRecord, open, partyOutcomes, specialFoes, supplyUse } from "../src/memory/graph.ts"

const out = join(root, ".dd-runtime", "test-graph")
const hero = (name: string, guid: number, cls: string, hp: number, o: Partial<Snap["heroes"][number]> = {}) => ({ guid, name, cls, hp, maxHp: 40, stress: 10, affliction: "", virtue: "", deathsDoor: false, lastBlow: "", turns: 0, ...o })
type F = { name: string; cls: string; guid: number }
const page = (key: string, at: string, o: { foes?: F[]; round?: number; heroes: Snap["heroes"]; tally?: Record<string, number>; narrated?: string[]; supplies?: Record<string, number> }): Snap => ({
  at, dungeon: "warrens", difficulty: 1, length: 1, quest: "explore", key, torch: 90, inBattle: !!o.foes, supplies: o.supplies ?? { torch: 4, food: 4 }, tally: o.tally ?? {}, narrated: o.narrated ?? [], known: [], heroes: o.heroes,
  ...(o.foes ? { battle: { round: o.round ?? 1, foes: o.foes.map((f) => ({ ...f, hp: 10, hitBy: "" })) } } : {}) }) as Snap
const webber = { name: "Webber", cls: "spider_webber_A" }, spitter = { name: "Spitter", cls: "spider_spitter_A" }
const collector = { name: "The Collector", cls: "collector_A", guid: 301 }, head = { name: "Collected Vestal", cls: "collector_shaman_A", guid: 302 }

async function writeTrip(dir: string, snaps: Snap[], raws: Record<number, unknown>) {
  mkdirSync(dir, { recursive: true })
  for (const [i, s] of snaps.entries()) await Bun.write(join(dir, `${String(i).padStart(4, "0")}.json`), JSON.stringify(s))
  for (const [i, r] of Object.entries(raws)) await Bun.write(join(dir, `${String(i).padStart(4, "0")}.raw.json`), JSON.stringify(r))
}

// trip 1: a fight won (the Spitter slain by Herbert, Guernon brought to Death's Door by the Webber), then a curio searched
const k1 = "test_g1", t1 = "2026-01-01T00:00:0"
const trip1 = [
  page(k1, `${t1}0Z`, { heroes: [hero("Herbert", 25, "crusader", 40), hero("Guernon", 19, "occultist", 19)] }),
  page(k1, `${t1}1Z`, { foes: [{ ...webber, guid: 101 }, { ...spitter, guid: 102 }], heroes: [hero("Herbert", 25, "crusader", 30, { lastBlow: "Webber", blowCls: "spider_webber_A" }), hero("Guernon", 19, "occultist", 19)] }),
  page(k1, `${t1}2Z`, { foes: [{ ...webber, guid: 101 }], tally: { MONSTER_DEFEATED: 1 }, heroes: [hero("Herbert", 25, "crusader", 30, { lastBlow: "Webber", blowCls: "spider_webber_A", turns: 1 }), hero("Guernon", 19, "occultist", 0, { deathsDoor: true, lastBlow: "Webber", blowCls: "spider_webber_A" })] }),
  page(k1, `${t1}3Z`, { tally: { MONSTER_DEFEATED: 2, BATTLE_COMPLETED: 1 }, narrated: ["victory"], heroes: [hero("Herbert", 25, "crusader", 30), hero("Guernon", 19, "occultist", 5, { deathsDoor: true })] }),
  page(k1, `${t1}4Z`, { tally: { MONSTER_DEFEATED: 2, BATTLE_COMPLETED: 1, CURIO_INVESTIGATED: 1 }, narrated: ["victory"], supplies: { torch: 3, food: 4, gold: 500 }, heroes: [hero("Herbert", 25, "crusader", 30), hero("Guernon", 19, "occultist", 5, { deathsDoor: true })] }),
]
const rawHeroes = (q: string[]) => ({ 25: { actor: { name: "Herbert" }, resolveXp: 0, quirks: Object.fromEntries(q.map((x) => [x, {}])) }, 19: { actor: { name: "Guernon" }, resolveXp: 0, quirks: {} } })
const raws1 = { 0: { raid: {}, heroes: rawHeroes([]) }, 4: { raid: { stat_database: { CURIO_INVESTIGATED: { entries: { 0: { parameters: { 0: { data: "moonshine_barrel" } } } } } } }, heroes: rawHeroes(["nocturnal"]) } }

// trip 2: the same two spiders in the other order, won; then the Collector, who drives them out at Death's Door
const k2 = "test_g2", t2 = "2026-01-02T00:00:0"
const four2 = (hp = 40, o: Partial<Snap["heroes"][number]> = {}) => [hero("Herbert", 25, "crusader", hp, o), hero("Guernon", 19, "occultist", 19)]
const trip2 = [
  page(k2, `${t2}0Z`, { heroes: four2() }),
  page(k2, `${t2}1Z`, { foes: [{ ...spitter, guid: 201 }, { ...webber, guid: 202 }], heroes: four2() }),
  page(k2, `${t2}2Z`, { tally: { BATTLE_COMPLETED: 1 }, narrated: ["victory"], heroes: four2() }),
  page(k2, `${t2}3Z`, { foes: [collector], tally: { BATTLE_COMPLETED: 1 }, narrated: ["victory", "combat_start"], heroes: four2(30, { lastBlow: "The Collector", blowCls: "collector_A" }) }),
  page(k2, `${t2}4Z`, { foes: [collector, head], round: 2, tally: { BATTLE_COMPLETED: 1 }, narrated: ["victory", "combat_start"], heroes: four2(0, { deathsDoor: true, lastBlow: "The Collector", blowCls: "collector_A" }) }),
  page(k2, `${t2}5Z`, { tally: { BATTLE_COMPLETED: 1 }, narrated: ["victory", "combat_start", "battle_retreat"], heroes: four2(0, { deathsDoor: true }) }),
]
const campaignLog = { chapters: {
  1: { 0: { heroes: { 0: { guid: 25, died: false }, 1: { guid: 19, died: false } }, dungeon_type: "warrens", start: false, success: true } },
  2: { 0: { heroes: { 0: { guid: 25, died: false }, 1: { guid: 19, died: false } }, dungeon_type: "warrens", start: false, success: false } },
} }
const ledger = [
  { dungeon: "warrens", difficulty: 1, length: 1, week: 1, trip: "Warrens, week 1", kind: "worked", text: "this held: a true healer" },
  { dungeon: "cove", difficulty: 1, length: 1, week: 9, trip: "Cove, week 9", kind: "food", text: "carry more food" },
]

let was: string | undefined
beforeAll(async () => {
  was = process.env.DD_TOWN_OUT
  process.env.DD_TOWN_OUT = out
  rmSync(out, { recursive: true, force: true })
  await writeTrip(join(out, "chronicle", k1), trip1, raws1)
  await writeTrip(join(out, "chronicle", k2), trip2, {})
  await Bun.write(join(out, "lessons.json"), JSON.stringify(ledger))
})
afterAll(() => { process.env.DD_TOWN_OUT = was; rmSync(out, { recursive: true, force: true }) })

describe("C113: the expeditions form one knowledge graph", () => {
  test("a synthetic chronicle gives its nodes, edges and query results", async () => {
    const r = await build({ campaignLog })
    expect(r.file).toBe(join(out, "graph.db"))
    expect(r.nodes).toMatchObject({ trip: 2, hero: 2, dungeon: 1, fight: 3, encounter: 1, foegroup: 2, curio: 1, quirk: 1 })
    expect(r.nodes.foe).toBe(4)
    const db = open()
    const edges = (rel: string) => db.query<{ src: string; dst: string; trip: string; ord: number; page: number; props: string }, [string]>("SELECT src, dst, trip, ord, page, props FROM edges WHERE rel = ? ORDER BY ord, page, src, dst").all(rel).map((e) => ({ ...e, props: JSON.parse(e.props) }))
    // a fight won, a retreat
    expect(edges("HELD_IN").map((e) => [e.trip, e.props.from, e.props.end])).toEqual([[k1, 1, "won"], [k2, 1, "won"], [k2, 3, "fled"]])
    // a kill: the Spitter fell on Herbert's turn
    expect(edges("SLEW")).toMatchObject([{ src: "hero:25", dst: "foe:spider_spitter_A", trip: k1, props: { count: 1, pages: [2] } }])
    // a Death's Door, laid at the foe whose blow it was
    expect(edges("DEATHS_DOOR").map((e) => [e.src, e.trip, e.page, e.props.foe])).toEqual([["hero:19", k1, 2, "foe:spider_webber_A"], ["hero:25", k2, 4, "foe:collector_A"]])
    expect(edges("STRUCK").filter((e) => e.trip === k1).map((e) => [e.src, e.dst, e.props.health, e.props.rank])).toEqual([["foe:spider_webber_A", "hero:19", 19, 2], ["foe:spider_webber_A", "hero:25", 10, 1]])
    // a curio searched, kept on the page it was searched, with what it gave
    expect(edges("SEARCHED")).toMatchObject([{ src: `trip:${k1}`, dst: "curio:moonshine_barrel", page: 4, props: { found: { gold: 500 } } }])
    expect(edges("GAINED")).toMatchObject([{ src: "hero:25", dst: "quirk:nocturnal", page: 4 }])
    expect(edges("MET_SPECIAL")).toMatchObject([{ src: `trip:${k2}`, dst: "foe:collector_A", props: { outcome: "fled", kind: "wanderer", brought: ["Collected Vestal"], brink: ["Herbert"] } }])
    expect(edges("TAUGHT").some((e) => e.trip === k1 && e.dst === "lesson:Warrens, week 1|worked|")).toBe(true)
    expect(edges("CARRIED").find((e) => e.trip === k1 && e.dst === "item:torch")!.props).toEqual({ start: 4, end: 3, used: 1, found: 0 })

    // the queries
    const threat = foeThreat(db, "warrens", 1)
    expect(threat.find((f) => f.foe === "foe:spider_webber_A")).toMatchObject({ foe: "foe:spider_webber_A", fights: 2, health: 29, healthPerFight: 14.5, ranks: [{ rank: 1, health: 10 }, { rank: 2, health: 19 }] })
    const rec = heroRecord(db, 25)!
    expect(rec).toMatchObject({ name: "Herbert", kills: 1, deathsDoor: 1, healthLost: 50, trips: [{ name: "Warrens, week 1", rank: 1, level: 0, died: false }, { name: "Warrens, week 2", rank: 1 }] })
    expect(rec.quirks.map((q) => q.quirk)).toEqual(["quirk:nocturnal"])
    expect(partyOutcomes(db, "warrens").map((p) => [p.name, p.outcome, p.four.map((h) => `${h.rank} ${h.name}`).join()])).toEqual([["Warrens, week 1", "success", "1 Herbert,2 Guernon"], ["Warrens, week 2", "failure", "1 Herbert,2 Guernon"]])
    expect(supplyUse(db, "warrens", 1).find((s) => s.item === "item:torch")).toMatchObject({ trips: 2, carried: 8, used: 1 })
    expect(specialFoes(db)).toMatchObject([{ foe: "foe:collector_A", name: "The Collector", outcome: "fled", rounds: 2 }])

    // the encounter, kept whole as a dossier
    const d = encounterDossier(db, "The Collector")!
    expect(d.tally).toMatchObject({ met: 1, outcomes: { fled: 1 }, hurtMost: [{ name: "Herbert", health: 40 }] })
    expect(d.meetings[0]).toMatchObject({ tripName: "Warrens, week 2", pages: { from: 3, to: 4 }, rounds: 2, outcome: "fled", slain: false,
      context: { torch: 90, ambushed: false, alongside: [], four: [{ name: "Herbert", rank: 1, hp: 30 }, { name: "Guernon", rank: 2, hp: 19 }] },
      challenges: { deathsDoor: ["Herbert"], brought: ["Collected Vestal"], struck: [{ name: "Herbert", health: 40, blows: 2 }] } })
    expect(d.meetings[0]!.where).toBeUndefined() // the synthetic pages keep no map: where it was is left out, not guessed

    // the lineups: the two spiders in either order are one group, met twice; who fights beside whom
    const g = foeGroups(db, "warrens", 1)
    expect(g.mostSeen[0]).toMatchObject({ group: "group:spider_spitter_A+spider_webber_A", label: "Spitter, Webber", met: 2, outcomes: { won: 2 }, health: 29, firstTrip: 1, trips: [1, 2] })
    expect(g.mostSeen[0]!.orders.map((o) => o.order.join())).toEqual(["Spitter,Webber", "Webber,Spitter"])
    expect(g.hurtMost[0]!.group).toBe("group:collector_A")
    expect(companions(db, "Webber")!.beside).toEqual([{ foe: "foe:spider_spitter_A", name: "Spitter", fights: 2, firstTrip: 1, trips: [1, 2] }])
    expect(companions(db, "The Collector")!.beside.map((b) => b.name)).toEqual(["Collected Vestal"])

    // the boundary: no foe that never stood in a fight page, no curio without the page it was searched on
    expect(db.query("SELECT id FROM nodes WHERE kind = 'foe' AND id NOT IN (SELECT src FROM edges WHERE rel = 'FOUGHT')").all()).toEqual([])
    expect(db.query("SELECT id FROM nodes WHERE kind = 'curio' AND id NOT IN (SELECT dst FROM edges WHERE rel = 'SEARCHED' AND page IS NOT NULL)").all()).toEqual([])
    db.close()
  })

  test("the export: every node and edge with its first trip, labels in the Hamlet's words, the same text every time", async () => {
    await build({ campaignLog })
    const a = JSON.stringify(exportGraph(open()))
    rmSync(join(out, "graph.db"))
    await build({ campaignLog })
    await build({ campaignLog })
    const db = open(), x = exportGraph(db), b = JSON.stringify(x)
    expect(b).toBe(a)
    expect(Object.keys(x)).toEqual(["trips", "nodes", "edges", "groups"])
    expect(x.trips).toEqual([
      { id: `trip:${k1}`, ordinal: 1, label: "Warrens, week 1", dungeon: "Warrens", level: "Apprentice", length: "Short", outcome: "success" },
      { id: `trip:${k2}`, ordinal: 2, label: "Warrens, week 2", dungeon: "Warrens", level: "Apprentice", length: "Short", outcome: "failure" },
    ])
    const n = (nid: string) => x.nodes.find((y) => y.id === nid)!
    expect([n("foe:spider_webber_A").firstTrip, n("foe:collector_A").firstTrip, n(`encounter:${k2}:3`).firstTrip, n("lesson:Cove, week 9|food|").firstTrip]).toEqual([1, 2, 2, null])
    expect(x.nodes.map((y) => y.firstTrip ?? 0)).toEqual([...x.nodes.map((y) => y.firstTrip ?? 0)].sort((p, q) => p - q))
    expect(x.edges.find((e) => e.kind === "FOUGHT_BESIDE" && e.from === "foe:spider_spitter_A")).toEqual({ from: "foe:spider_spitter_A", to: "foe:spider_webber_A", kind: "FOUGHT_BESIDE", firstTrip: 1, trips: [1, 2], weight: 2 })
    expect(x.edges.find((e) => e.kind === "SEEN_IN" && e.from === "group:spider_spitter_A+spider_webber_A")).toMatchObject({ firstTrip: 1, trips: [1, 2], weight: 2 })
    for (const e of x.edges) expect(e.trips[0] ?? null).toBe(e.firstTrip)
    // labels are names, never a file, a field or a variant id
    for (const y of x.nodes) expect(y.label).not.toMatch(/_[A-Z]\b|test_g|\.json|^\w+_\w+$/)
    expect(n("item:gold").label).toBe("Gold")
    expect(n("curio:moonshine_barrel").label).not.toContain("_")
    expect(x.groups.map((y) => y.label)).toContain("Spitter, Webber")
    db.close()
  })
})

// the live chronicle, read where it lies and never written: its graph is built under .dd-runtime
const live = process.env.DD_GRAPH_LIVE ?? join(root, ".local", "town")
describe.skipIf(!existsSync(join(live, "chronicle")))("C113 on the live chronicle", () => {
  test("every trip is in a dungeon with its four, the Collector's meeting is a retreat, and nothing unwitnessed is named", async () => {
    const before = process.env.DD_TOWN_OUT, file = join(root, ".dd-runtime", "test-graph-live.db")
    process.env.DD_TOWN_OUT = live
    try {
      const r = await build({ file })
      const dirs = readdirSync(join(live, "chronicle")).filter((d) => readdirSync(join(live, "chronicle", d)).some((f) => /^\d+\.json$/.test(f)))
      expect(r.nodes.trip).toBe(dirs.length)
      const db = open(file)
      expect(db.query("SELECT id FROM nodes WHERE kind = 'trip' AND id NOT IN (SELECT src FROM edges WHERE rel = 'IN')").all()).toEqual([])
      expect(db.query("SELECT id FROM nodes WHERE kind = 'trip' AND id NOT IN (SELECT dst FROM edges WHERE rel = 'WENT_ON')").all()).toEqual([])
      const met = specialFoes(db, "warrens").filter((m) => m.trip.startsWith("trip:plot_kill_swine_prince_1_") && m.foe === "foe:collector_A")
      expect(met.length).toBeGreaterThan(0)
      expect(met[0]!.outcome).toBe("fled")
      const d = encounterDossier(db, "collector_A")!
      expect(d.meetings[0]).toMatchObject({ outcome: "fled", challenges: { brought: expect.arrayContaining(["Collected Vestal"]) } })
      expect(d.meetings[0]!.challenges.deathsDoor.length).toBeGreaterThan(0)
      // the boundary: no foe node that never stood in a fight page, no curio searched without a page whose count went up
      expect(db.query("SELECT id FROM nodes WHERE kind = 'foe' AND id NOT IN (SELECT src FROM edges WHERE rel = 'FOUGHT')").all()).toEqual([])
      for (const s of db.query<{ trip: string; page: number }, []>("SELECT trip, page FROM edges WHERE rel = 'SEARCHED'").all()) {
        const p = (n: number) => Bun.file(join(live, "chronicle", s.trip, `${String(n).padStart(4, "0")}.json`)).json() as Promise<Snap>
        expect(((await p(s.page)).tally.CURIO_INVESTIGATED ?? 0)).toBeGreaterThan((await p(s.page - 1)).tally.CURIO_INVESTIGATED ?? 0)
      }
      db.close()
    } finally { process.env.DD_TOWN_OUT = before; rmSync(file, { force: true }) }
  })
})
