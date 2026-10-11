// The Caretaker's reading of a Town: who rests where, which expedition, which party, who stays, what to buy.
// Figures come from the Town (save + game files). Thresholds marked RULE are the Caretaker's own judgement,
// stated as such on the board, never presented as the game's numbers (ISA A2).
import { heroClass, quirks, supplyPrices } from "./game.ts"
import type { Activity, HeroView, Quest, QuirkView, Town, Upgrade } from "./town.ts"

export const RULE_FOOD = [0, 8, 12, 16] // RULE: food and torches by expedition length

export interface RoadItem { id: string; label: string; count: number; price: number }
/** What the road to a quest asks of the Provisioner (counts are RULE), priced from the game's list with this week's event applied (C22). */
export function road(t: Town, p: Party | undefined, prices: Map<string, number>): RoadItem[] {
  if (!p) return []
  const q = p.quest, len = Math.max(1, Math.min(3, q.length))
  const change = (id: string) => (t.event?.provisions ?? []).filter((v) => v.item === (id === "provision" ? "provision" : "supply")).reduce((x, v) => x + v.cost, 0)
  const item = (id: string, label: string, count: number): RoadItem => ({ id, label, count, price: Math.max(0, Math.round((prices.get(id) ?? 0) * (1 + change(id)))) })
  const out = [item("provision", "Food", RULE_FOOD[len]!), item("torch", "Torches", RULE_FOOD[len]!), item("shovel", "Shovels", len)]
  if (q.bleeders.length) out.push(item("bandage", "Bandages", len + 1))
  if (q.blighters.length) out.push(item("antivenom", "Antivenom", len + 1))
  return out
}

export const RULE = {
  restAbove: 45, // RULE: stress at which I want a hero relieved before going out again
  sendBelow: 45, // RULE: I only send heroes below this stress
  dismissNegatives: 3, // RULE: a level 0 hero with this many negative quirks is a candidate to let go
  realHeal: 4, // RULE: a heal restoring this many hit points on average, at its first level, makes a healer; less is a light heal (Soushi, 2026-10-10)
  greenParty: 3, // RULE: when this many of the four are level 0, a longer road counts against itself
  greenPerStep: 6, // RULE: how much, per step beyond a short road
  goldPerPoint: 500, // RULE: every 500 gold the road leaves in the coffers counts for one point, up to goldCap
  goldCap: 4,
  brokeRoad: 20, // RULE: a road the coffers cannot provision counts this much against itself
  turnBackBroken: 2, // RULE: when this many of the four have broken, I bring them home
}

// quirk ids carry the dungeon they concern; the crypts are "ruins" in quirk names, the warrens "warren"
const DUNGEON_TOKEN: Record<string, string[]> = { weald: ["weald"], cove: ["cove"], warrens: ["warren"], crypts: ["ruins", "crypt"], darkestdungeon: ["darkest"] }

export interface Relief { hero: HeroView; why: string[]; options: { activity: Activity; note: string }[] }
export interface Seat { hero: HeroView; rank: number; skills: string[]; notes: string[] }
/** The strongest heal on another hero the four can cast from where they stand (C30). */
export interface Heal { by: string; skill: string; avg: number }
export interface Party { quest: Quest; seats: Seat[]; score: number; healer: boolean; heal?: Heal; stunner: boolean; notes: string[]; left?: number; green?: boolean }
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
  // the best heal on an ally each hero can cast from rank r, by the hit points it restores
  const healAt = (h: HeroView, r: number): Heal | undefined => h.skills.map((s) => ({ s, k: info.get(h.guid)!.skills.get(s.id) })).filter(({ k }) => k?.heal && k.targetsAllies && k.launch.includes(r)).map(({ s, k }) => ({ by: h.name, skill: s.name, avg: k!.healAvg })).sort((x, y) => y.avg - x.avg)[0]
  const stuns = (h: HeroView) => h.skills.some((s) => info.get(h.guid)!.skills.get(s.id)?.stun)

  let best: Party | undefined
  const n = pool.length
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) {
    const four = [pool[a]!, pool[b]!, pool[c]!, pool[d]!]
    // try every order; rank 1 is the front
    for (const order of permutations(four)) {
      if (!order.every((h, i) => ranksFor(h).includes(i + 1))) continue
      const heal = order.map((h, i) => healAt(h, i + 1)).filter((x): x is Heal => !!x).sort((x, y) => y.avg - x.avg)[0]
      const healer = !!heal && heal.avg >= RULE.realHeal, stunner = order.some(stuns)
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
      // a true healer is what brings a party home; a light heal helps, but does not stand in for one
      if (healer) score += 8
      else if (heal) score += 2
      if (stunner) score += 3
      if (new Set(order.map((h) => h.cls)).size < 4) score -= 2
      if (!best || score > best.score) {
        best = {
          quest: q, score, healer, heal, stunner, notes: [],
          seats: order.map((h, i) => ({ hero: h, rank: i + 1, skills: usable(h, i + 1), notes: fit.get(h.guid)!.notes })),
        }
      }
    }
  }
  if (best) {
    if (!best.healer) best.notes.push(best.heal ? `only a light heal in this four: ${best.heal.by}'s ${best.heal.skill}` : "no healer in this four")
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
  // RULE (Soushi, 2026-10-10): count the gold the road leaves, and keep a green party on short roads
  const prices = await supplyPrices(), coffers = t.wallet.gold ?? 0
  for (const p of parties) {
    const cost = road(t, p, prices).reduce((x, i) => x + i.count * i.price, 0)
    p.left = coffers - cost
    p.score += p.left < 0 ? -RULE.brokeRoad : Math.min(RULE.goldCap, p.left / RULE.goldPerPoint)
    p.green = p.seats.filter((s) => s.hero.level === 0).length >= RULE.greenParty
    if (p.green) p.score -= RULE.greenPerStep * Math.max(0, p.quest.length - 1)
  }
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
  // a trinket goes to an open slot, or replaces a worn one only when it is rarer by the game's own list; class trinkets
  // first, rarest first; listed by hero, back rank first like the party (Soushi, 2026-10-10: "propose only if it is worth the switch")
  const wear = new Map((best?.seats ?? []).map((s) => [s.hero.guid, [...(t.worn[s.hero.guid] ?? [])]]))
  const placed = [...t.estateTrinkets].sort((x, z) => z.classes.length - x.classes.length || x.rank - z.rank).flatMap((tr) => {
    const fit = (best?.seats ?? []).filter((s) => !tr.classes.length || tr.classes.includes(s.hero.cls))
    const open = fit.filter((s) => wear.get(s.hero.guid)!.length < t.trinketSlots).sort((x, z) => wear.get(x.hero.guid)!.length - wear.get(z.hero.guid)!.length)[0]
    const who = open ?? fit.map((s) => ({ s, worst: [...wear.get(s.hero.guid)!].sort((x, z) => z.rank - x.rank)[0] })).filter((c) => c.worst && c.worst.rank > tr.rank).sort((x, z) => z.worst!.rank - x.worst!.rank)[0]?.s
    if (!who) return []
    const mine = wear.get(who.hero.guid)!, out = open ? undefined : [...mine].sort((x, z) => z.rank - x.rank)[0]!
    if (out) mine.splice(mine.indexOf(out), 1)
    mine.push({ id: tr.id, name: tr.name, rank: tr.rank })
    const may = tr.classes.length ? `only a ${who.hero.clsName} may wear it` : "anyone may wear it"
    return [{ rank: who.rank, trinket: tr.name, to: who.hero.name, why: out ? `in place of their ${out.name}, which is commoner; ${may}` : `a slot is free; ${may}` }]
  })
  const trinkets = placed.sort((x, z) => z.rank - x.rank).map(({ rank: _r, ...tr }) => tr)

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
  // the four I would send are on the road this week, so the ward's seats go first to those who stay home
  treat.sort((x, y) => Number(x.inParty) - Number(y.inParty) || y.hero.level - x.hero.level)
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
  let stunner = false, heal: Heal | undefined
  for (const [i, h] of order.entries()) {
    const cls = await heroClass(h.cls)
    const r = i + 1
    const usable = h.skills.filter((s) => cls.skills.get(s.id)?.launch.includes(r))
    for (const s of h.skills) { const k = cls.skills.get(s.id); if (k?.heal && k.targetsAllies && k.launch.includes(r) && (!heal || k.healAvg > heal.avg)) heal = { by: h.name, skill: s.name, avg: k.healAvg } }
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
  const healer = !!heal && heal.avg >= RULE.realHeal
  if (!healer) notes.push(heal ? `only a light heal in this four: ${heal.by}'s ${heal.skill}` : "no healer in this four")
  if (!stunner) notes.push("no stun in this four")
  return { quest: q, seats, score: 0, healer, heal, stunner, notes }
}

/** How ready a party is for its road, by my conditions for sending one (C28). Not odds of success: nothing in the save
 *  measures those. Each condition is read from the save or the game's files, so the share rises as the Hamlet prepares. */
export interface Readiness { met: number; of: number; pct: number; verdict: string; checks: { label: string; met: boolean; why: string }[] }
export function readiness(t: Town, p: Party, reserve: number): Readiness {
  const gold = t.wallet.gold ?? 0, n = (x: number) => x.toLocaleString("en-US")
  const tired = p.seats.filter((s) => s.hero.stress >= RULE.sendBelow).map((s) => s.hero.name)
  const unfit = p.seats.filter((s) => s.hero.affliction || s.hero.quirks.some((q) => q.disease) || s.hero.busy).map((s) => s.hero.name)
  const short = p.seats.filter((s) => s.skills.length < 2).map((s) => s.hero.name)
  const against = p.seats.filter((s) => s.notes.some((n) => n.startsWith("−"))).map((s) => s.hero.name)
  const checks = [
    { label: "The road is paid for", met: gold >= reserve, why: gold >= reserve ? `the provisions cost ${n(reserve)} of your ${n(gold)} gold` : `the provisions cost ${n(reserve)} and you have ${n(gold)}` },
    { label: "Rested", met: !tired.length, why: tired.length ? `${tired.join(", ")} at ${RULE.sendBelow} stress or more` : `all four under ${RULE.sendBelow} stress` },
    { label: "Sound in mind and body", met: !unfit.length, why: unfit.length ? `${unfit.join(", ")} afflicted, ill or still in a building` : "nobody afflicted, ill or held in town" },
    { label: "A healer goes with them", met: p.healer, why: p.healer ? `${p.heal!.by}'s ${p.heal!.skill}, about ${p.heal!.avg} hit points a cast` : p.heal ? `only ${p.heal.by}'s ${p.heal.skill}, about ${p.heal.avg} hit points a cast: a light heal, not a healer` : "nobody in the four heals another from where they stand" },
    { label: "A stun goes with them", met: p.stunner, why: p.stunner ? "someone can stop a foe's turn" : "nobody in the four can stun" },
    { label: "Every rank can fight", met: !short.length, why: short.length ? `${short.join(", ")} with fewer than two skills that reach from their rank` : "each has at least two skills that reach from their rank" },
    { label: "A road you have walked", met: p.quest.walked, why: p.quest.walked ? `${p.quest.known.length} foes there you know` : "you have never walked it" },
    { label: "No quirk turns against them there", met: !against.length, why: against.length ? `${against.join(", ")} carry a quirk that works against this road` : "no quirk in the four works against this road" },
    { label: "Seasoned enough for its length", met: !(p.green && p.quest.length > 1), why: p.green && p.quest.length > 1 ? "most of them untried, on a road longer than short" : p.green ? "untried, but the road is short" : "enough of them have seen the dark" },
  ]
  const met = checks.filter((c) => c.met).length, pct = Math.round((met / checks.length) * 100)
  // RULE: my words for how ready they are
  const verdict = pct >= 85 ? "I would send them." : pct >= 65 ? "Nearly ready; see what is left below." : "Not yet: I would not send them like this."
  return { met, of: checks.length, pct, verdict, checks }
}

