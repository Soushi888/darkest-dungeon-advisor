// The Caretaker's reading of a Town: who rests where, which expedition, which party, who stays, what to buy.
// Figures come from the Town (save + game files). Thresholds marked RULE are the Caretaker's own judgement,
// stated as such on the board, never presented as the game's numbers (ISA A2).
import { heroClass, quirks } from "./game.ts"
import type { Activity, HeroView, Quest, QuirkView, Town, Upgrade } from "./town.ts"

export const RULE = {
  restAbove: 45, // RULE: stress at which I want a hero relieved before going out again
  sendBelow: 45, // RULE: I only send heroes below this stress
  dismissNegatives: 3, // RULE: a level 0 hero with this many negative quirks is a candidate to let go
  turnBackBroken: 2, // RULE: when this many of the four have broken, I bring them home
}

// quirk ids carry the dungeon they concern; the crypts are "ruins" in quirk names, the warrens "warren"
const DUNGEON_TOKEN: Record<string, string[]> = { weald: ["weald"], cove: ["cove"], warrens: ["warren"], crypts: ["ruins", "crypt"], darkestdungeon: ["darkest"] }

export interface Relief { hero: HeroView; why: string[]; options: { activity: Activity; note: string }[] }
export interface Seat { hero: HeroView; rank: number; skills: string[]; notes: string[] }
export interface Party { quest: Quest; seats: Seat[]; score: number; healer: boolean; stunner: boolean; notes: string[] }
export interface Advice {
  relief: Relief[]; disease: HeroView[]; afflicted: HeroView[]
  ready: HeroView[]; parties: Party[]; best?: Party
  dismiss: { hero: HeroView; why: string }[]; recruits: { hero: HeroView; why: string }[]
  buys: Upgrade[]; blocked: Upgrade[]; heirlooms: Upgrade[]
  trinkets: { trinket: string; to: string; why: string }[]
  treat: Treat[]
  spend: number
}
/** A quirk worth the Treatment Ward by my habit (C25): one per hero, the worst by the order in RULE_TREAT. */
export interface Treat { hero: HeroView; quirk: QuirkView; why: string; cost: number; inParty: boolean }

const negatives = (h: HeroView) => h.quirks.filter((q) => !q.positive && !q.disease)
const diseases = (h: HeroView) => h.quirks.filter((q) => q.disease)

function allowed(a: Activity, h: HeroView): boolean {
  return !h.quirks.some((q) => a.barred.includes(q.id))
}

/** How a hero's quirks bear on one quest: dungeon affinities and fears of the foes I know are there. */
async function quirkFit(h: HeroView, q: Quest): Promise<{ score: number; notes: string[] }> {
  const lib = await quirks()
  const tokens = DUNGEON_TOKEN[q.dungeon] ?? [q.dungeon]
  let score = 0
  const notes: string[] = []
  for (const qu of h.quirks) {
    const pos = lib.get(qu.id)?.positive ?? qu.positive
    // whole words of the quirk id: "man" must match hatred_of_man, never photomania
    const words = qu.id.split("_")
    const hitsDungeon = tokens.some((t) => words.includes(t) || words.includes(`${t}s`))
    const hitsFoe = q.types.some((t) => t && words.includes(t))
    if (hitsDungeon || hitsFoe) { score += pos ? 2 : -3; notes.push(`${pos ? "+" : "−"} ${qu.name}`) }
  }
  return { score, notes }
}

async function bestParty(pool: HeroView[], q: Quest): Promise<Party | undefined> {
  const info = new Map<number, Awaited<ReturnType<typeof heroClass>>>()
  for (const h of pool) info.set(h.guid, await heroClass(h.cls))
  const fit = new Map<number, Awaited<ReturnType<typeof quirkFit>>>()
  for (const h of pool) fit.set(h.guid, await quirkFit(h, q))

  // which ranks each hero can fight from: at least two of their equipped skills launch there
  const ranksFor = (h: HeroView) => [1, 2, 3, 4].filter((r) => h.skills.filter((s) => info.get(h.guid)!.skills.get(s.id)?.launch.includes(r)).length >= 2)
  const usable = (h: HeroView, r: number) => h.skills.filter((s) => info.get(h.guid)!.skills.get(s.id)?.launch.includes(r)).map((s) => s.name)
  const heals = (h: HeroView) => h.skills.some((s) => { const k = info.get(h.guid)!.skills.get(s.id); return k?.heal && k.targetsAllies })
  const stuns = (h: HeroView) => h.skills.some((s) => info.get(h.guid)!.skills.get(s.id)?.stun)

  let best: Party | undefined
  const n = pool.length
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) {
    const four = [pool[a]!, pool[b]!, pool[c]!, pool[d]!]
    // try every order; rank 1 is the front
    for (const order of permutations(four)) {
      if (!order.every((h, i) => ranksFor(h).includes(i + 1))) continue
      const healer = order.some(heals), stunner = order.some(stuns)
      let score = 0
      order.forEach((h, i) => {
        const r = i + 1, cls = info.get(h.guid)!
        // a seat is worth its usable attacks more than its usable support, and the front wants hit points
        for (const s of h.skills) {
          const k = cls.skills.get(s.id)
          if (k?.launch.includes(r)) score += k.type === "melee" || k.type === "ranged" ? 1.5 : 0.5
        }
        score += (r <= 2 ? 1 : -1) * (cls.hp - 25) / 3
        score += h.level * 3 - h.stress / 10 + fit.get(h.guid)!.score
      })
      if (healer) score += 6
      if (stunner) score += 3
      if (new Set(order.map((h) => h.cls)).size < 4) score -= 2
      if (!best || score > best.score) {
        best = {
          quest: q, score, healer, stunner, notes: [],
          seats: order.map((h, i) => ({ hero: h, rank: i + 1, skills: usable(h, i + 1), notes: fit.get(h.guid)!.notes })),
        }
      }
    }
  }
  if (best) {
    if (!best.healer) best.notes.push("no healer in this four")
    if (!best.stunner) best.notes.push("no stun in this four")
  }
  return best
}

function* permutations<T>(xs: T[]): Generator<T[]> {
  if (xs.length <= 1) { yield xs; return }
  for (let i = 0; i < xs.length; i++) for (const p of permutations([...xs.slice(0, i), ...xs.slice(i + 1)])) yield [xs[i]!, ...p]
}

export async function advise(t: Town): Promise<Advice> {
  const free = t.heroes.filter((h) => !h.busy)
  const afflicted = free.filter((h) => h.affliction)
  const disease = free.filter((h) => diseases(h).length)

  // relief: everyone over my threshold or afflicted, with the activities their quirks allow and slots left
  const relief: Relief[] = []
  for (const h of free.filter((h) => h.affliction || h.stress >= RULE.restAbove).sort((x, y) => y.stress - x.stress)) {
    const why = [h.affliction ? `afflicted (${h.affliction})` : "", `${h.stress} stress`].filter(Boolean)
    const allowedHere = t.activities.filter((a) => a.heal > 0 && !a.locked && allowed(a, h))
    const full = allowedHere.filter((a) => a.slots <= a.used)
    if (full.length && allowedHere.every((a) => a.slots <= a.used)) why.push(`every place they accept is full (${full.map((a) => a.name).join(", ")})`)
    const options = allowedHere.filter((a) => a.slots > a.used)
      .sort((x, y) => x.cost - y.cost)
      .map((a) => ({ activity: a, note: `${a.cost ? `${a.cost} gold` : "free"}${a.cost !== a.baseCost ? ` this week (${a.baseCost} as a rule)` : ""}, relieves ${a.heal}` }))
    relief.push({ hero: h, why, options })
  }

  // who can go: free, not afflicted, under my stress line, not diseased
  const ready = free.filter((h) => !h.affliction && h.stress < RULE.sendBelow && !diseases(h).length)
  const parties: Party[] = []
  for (const q of t.quests.filter((q) => !q.plot)) {
    const p = await bestParty(ready, q)
    if (p) parties.push(p)
  }
  // RULE: while the roster is young, a walked dungeon and a short expedition break ties
  for (const p of parties) p.score += (p.quest.walked ? 1 : 0) + (p.quest.length === 1 ? 0.5 : 0)
  parties.sort((a, b) => b.score - a.score)
  const best = parties[0]

  // roster: level 0 heroes heavy with negative quirks and outside the best party
  const inParty = new Set(best?.seats.map((s) => s.hero.guid))
  const dismiss = free.filter((h) => h.level === 0 && !inParty.has(h.guid) && negatives(h).length >= RULE.dismissNegatives)
    .map((h) => ({ hero: h, why: `level 0 with ${negatives(h).length} negative quirks: ${negatives(h).map((q) => q.name).join(", ")}` }))
  const room = t.rosterCap - t.rosterSize
  const recruits = t.recruits.map((h) => {
    const pos = h.quirks.filter((q) => q.positive).map((q) => q.name), neg = negatives(h).map((q) => q.name)
    return { hero: h, why: `${h.from ? `came with the ${h.from}; ` : ""}${pos.length ? `good: ${pos.join(", ")}` : "no good quirk"}; ${neg.length ? `bad: ${neg.join(", ")}` : "no bad quirk"}${room <= 0 ? "; the roster is full" : ""}` }
  })

  // what to buy for the party first: affordable, unblocked, cheapest first
  const partyNames = new Set(best?.seats.map((s) => s.hero.name))
  const forParty = t.heroUpgrades.filter((u) => partyNames.has(u.hero ?? ""))
  const gold = (u: Upgrade) => u.cost.find((c) => c.type === "gold")?.amount ?? 0
  const buys = forParty.filter((u) => u.affordable && !u.blockedBy).sort((a, b) => gold(a) - gold(b))
  const blocked = forParty.filter((u) => u.blockedBy)
  const heirlooms = t.buildingUpgrades.filter((u) => u.affordable)

  // trinkets in the estate that a party member may wear
  const trinkets = t.estateTrinkets.flatMap((tr) => {
    const who = best?.seats.find((s) => !tr.classes.length || tr.classes.includes(s.hero.cls))
    return who ? [{ trinket: tr.name, to: who.hero.name, why: tr.classes.length ? `only a ${who.hero.clsName} may wear it` : "anyone may wear it" }] : []
  })

  // the Treatment Ward (C25), by my habit (RULE): a quirk that steals the party's loot first, then one that shuts a hero out of
  // a place of relief, then one that turns against the road the party takes next. Others I do not rank, so I do not name them.
  // Heroes I would rather let go (level 0, outside the party) are left to Who stays, who goes.
  const ward = t.activities.find((x) => x.activity === "treatment")
  const barring = new Set(t.activities.filter((x) => x.heal > 0).flatMap((x) => x.barred))
  const treat: Treat[] = []
  for (const h of free) {
    const inPartyNow = inParty.has(h.guid)
    if (!ward || (h.level === 0 && !inPartyNow)) continue
    const bad = h.quirks.filter((q) => !q.positive && !q.disease && q.treatable)
    const road = best ? (await quirkFit(h, best.quest)).notes.filter((n) => n.startsWith("−")).map((n) => n.slice(2)) : []
    const pick: [QuirkView | undefined, string][] = [
      [bad.find((q) => q.thief), "they keep for themselves what the party finds"],
      [bad.find((q) => barring.has(q.id)), "it shuts them out of a place of relief"],
      [bad.find((q) => road.includes(q.name)), `it turns against them on the road to the ${best?.quest.dungeonName}`],
    ]
    const hit = pick.find(([q]) => q)
    if (!hit) continue
    const q = hit[0]!
    treat.push({ hero: h, quirk: q, why: hit[1], cost: q.locked ? ward.lockedQuirkCost ?? ward.cost : ward.cost, inParty: inPartyNow })
  }
  treat.sort((x, y) => Number(y.inParty) - Number(x.inParty) || y.hero.level - x.hero.level)
  // a thief I would not pay to cure is a thief I would let go, if they are not needed on the road
  for (const h of free.filter((h) => h.level === 0 && !inParty.has(h.guid) && h.quirks.some((q) => q.thief && !q.positive))) {
    if (!dismiss.some((d) => d.hero.guid === h.guid)) dismiss.push({ hero: h, why: `level 0, and ${h.quirks.find((q) => q.thief)!.name}: they keep for themselves what the party finds` })
  }

  return { relief, disease, afflicted, ready, parties, best, dismiss, recruits, buys, blocked, heirlooms, trinkets, treat, spend: t.wallet.gold ?? 0 }
}

/** Seats a party Soushi named, front to back, and says what is wrong with it rather than refusing it. */
export async function seatParty(order: HeroView[], q: Quest): Promise<Party> {
  const seats: Seat[] = []
  const notes: string[] = []
  let healer = false, stunner = false
  for (const [i, h] of order.entries()) {
    const cls = await heroClass(h.cls)
    const r = i + 1
    const usable = h.skills.filter((s) => cls.skills.get(s.id)?.launch.includes(r))
    if (h.skills.some((s) => { const k = cls.skills.get(s.id); return k?.heal && k.targetsAllies })) healer = true
    if (h.skills.some((s) => cls.skills.get(s.id)?.stun)) stunner = true
    const fit = await quirkFit(h, q)
    const warn = [
      usable.length < 2 ? `only ${usable.length} equipped skill${usable.length === 1 ? "" : "s"} reach from rank ${r}` : "",
      h.stress >= RULE.sendBelow ? `${h.stress} stress` : "", h.affliction ? `afflicted (${h.affliction})` : "",
      h.quirks.some((x) => x.disease) ? "ill" : "", h.busy ? `still in the ${h.busy}` : "",
    ].filter(Boolean)
    if (warn.length) notes.push(`${h.name}: ${warn.join(", ")}`)
    seats.push({ hero: h, rank: r, skills: usable.map((s) => s.name), notes: fit.notes })
  }
  if (!healer) notes.push("no healer in this four")
  if (!stunner) notes.push("no stun in this four")
  return { quest: q, seats, score: 0, healer, stunner, notes }
}
