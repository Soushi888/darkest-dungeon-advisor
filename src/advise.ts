// The Caretaker's reading of a Town: who rests where, which expedition, which party, who stays, what to buy.
// Figures come from the Town (save + game files). Thresholds marked RULE are the Caretaker's own judgement,
// stated as such on the board, never presented as the game's numbers (ISA A2).
import { heroClass, heroTrees, nameOf, quirks, supplyPrices, type Skill } from "./game.ts"
import { bearing, CHRONICLE_RULE, untried } from "./chronicle.ts"
import type { Activity, HeroView, Quest, QuirkView, Town, Upgrade } from "./town.ts"

export const RULE_FOOD = [0, 8, 12, 16] // RULE: food and torches by expedition length

export interface RoadItem { id: string; label: string; count: number; price: number; why?: string }
/** What the road to a quest asks of the Provisioner (counts are RULE), priced from the game's list with this week's event applied (C22). */
export function road(t: Town, p: Party | undefined, prices: Map<string, number>): RoadItem[] {
  if (!p) return []
  const q = p.quest, len = Math.max(1, Math.min(3, q.length))
  const change = (id: string) => (t.event?.provisions ?? []).filter((v) => v.item === (id === "provision" ? "provision" : "supply")).reduce((x, v) => x + v.cost, 0)
  const item = (id: string, label: string, count: number): RoadItem => ({ id, label, count, price: Math.max(0, Math.round((prices.get(id) ?? 0) * (1 + change(id)))) })
  const out = [item("provision", "Food", RULE_FOOD[len]!), item("torch", "Torches", RULE_FOOD[len]!), item("shovel", "Shovels", len)]
  if (q.bleeders.length) out.push(item("bandage", "Bandages", len + 1))
  if (q.blighters.length) out.push(item("antivenom", "Antivenom", len + 1))
  // C42: what past trips on this dungeon taught, at this difficulty or lower; and a margin on a road harder than any yet
  const taught = bearing(t.ledger ?? [], q)
  const add = (id: string, n: number, why: string) => { const it = out.find((x) => x.id === id); if (it && n) { it.count += n; it.why = [it.why, why].filter(Boolean).join("; ") } }
  for (const [kind, id, n] of [["light", "torch", CHRONICLE_RULE.lessonTorches], ["food", "provision", CHRONICLE_RULE.lessonFood]] as const) {
    const trips = [...new Set(taught.filter((l) => l.kind === kind).map((l) => l.trip))]
    if (trips.length) add(id, n, `+${n}: ${kind === "light" ? "they broke in the dark" : "the food ran out"} (${trips.join(", ")})`)
  }
  if (untried(t.ledger ?? [], q, t.trips)) for (const id of ["torch", "provision"]) add(id, CHRONICLE_RULE.untriedMargin, `+${CHRONICLE_RULE.untriedMargin}: no expedition this hard yet`)
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
  // how I weigh a party's fighting shape (Soushi, 2026-10-10: "take into account heroes' positions and their abilities")
  reachPerRank: 1, // RULE: each enemy rank the four can strike from their seats (C32)
  shufflePerSide: 0.5, // RULE: each neighbouring rank a hero can still attack from, if knocked out of their seat (C33)
  moveWorth: 0.5, // RULE: a skill that moves its user, to win a seat back (C33)
  markPair: 3, // RULE: a mark carried with a hand that strikes the marked harder (C35)
  dotWorth: 1.5, // RULE: a bleed or blight, times the share the road's known foes fail to resist (C36)
  // how I weigh a camping skill (the Survivalist): stress healed counts by how many it reaches, health healed in tenths of
  // the bar, a cure or a guard on the camp a fixed worth, a boon for the next fight a little, stress dealt to the others against
  campStress: 1, campHealth: 10, campCure: 4, campGuard: 6, campBoon: 2,
  frontHp: 1.5, // RULE: per hit point above the four's average, at the front; rank 1 counts twice, rank 4 twice against (Soushi, 2026-10-11: "an occultist on front line? he is not really resistant")
  lessonHeal: 4, // RULE: a true healer's extra weight on a road where healing failed before (C42)
  youngRoster: 0.6, // RULE: when this share of the roster is level 1 or lower, the heirlooms go to the Stage Coach's seasoned recruits first (Soushi, 2026-10-11)
  healerWorth: 8, lightHealWorth: 2, stunWorth: 3, sameClass: 2, levelWorth: 3, stressWeight: 0.1, // RULE: a party's healer, light heal, stun, a doubled class against, each level, each point of stress against
}

/** What a skill is worth from rank r on road q, by my habits: an attack by how many ranks it reaches, a heal by what it
 *  restores, a bleed or blight by what the foes you have met fail to resist. Zero when it cannot be used from r. */
export function skillWorth(k: Skill | undefined, r: number, q: Quest): number {
  if (!k || !k.launch.includes(r)) return 0
  let v = k.target.length ? 1.5 + 0.25 * k.target.length : k.heal && k.targetsAllies ? k.healAvg / 2 : 0.5
  const f = q.foeResist
  if (f?.foes && k.bleed) v += RULE.dotWorth * (1 - f.bleed)
  if (f?.foes && k.blight) v += RULE.dotWorth * (1 - f.blight)
  if (k.stun) v += 1
  if (k.marks) v += 0.5
  return v
}

// quirk ids carry the dungeon they concern; the crypts are "ruins" in quirk names, the warrens "warren"
const DUNGEON_TOKEN: Record<string, string[]> = { weald: ["weald"], cove: ["cove"], warrens: ["warren"], crypts: ["ruins", "crypt"], darkestdungeon: ["darkest"] }

export interface Relief { hero: HeroView; why: string[]; options: { activity: Activity; note: string }[] }
export interface Seat {
  hero: HeroView; rank: number; skills: string[]; notes: string[]
  // the four skills I would have them carry from this seat, the swaps that takes, and a skill worth learning (C34)
  carry?: string[]; swaps?: { equip: string; for: string }[]; learn?: { skill: string; gold: number }
}
/** The strongest heal on another hero the four can cast from where they stand (C30). */
export interface Heal { by: string; skill: string; avg: number }
export interface Party {
  quest: Quest; seats: Seat[]; score: number; healer: boolean; heal?: Heal; stunner: boolean; notes: string[]; left?: number; green?: boolean
  reach?: number[]; pair?: { marker: string; mark: string; striker: string; strike: string }
}
export interface Advice {
  relief: Relief[]; disease: HeroView[]; afflicted: HeroView[]
  ready: HeroView[]; parties: Party[]; best?: Party
  dismiss: { hero: HeroView; why: string }[]; recruits: Recruit[]
  buys: Upgrade[]; blocked: Upgrade[]; heirlooms: Upgrade[]
  // the Stage Coach's next upgrade in each tree, bought or not yet affordable, and whether the roster is young by my habit
  coach: Upgrade[]; young: { low: number; of: number } | undefined
  // every living hero who has learned a true heal, by what it restores (C37: what a fallen healer leaves behind)
  healers: { name: string; skill: string; avg: number }[]; lostHealers: string[]
  trinkets: { trinket: string; to: string; why: string }[]
  treat: Treat[]
  spend: number
}
/** A hero at the coach, with the true heal and the stun they bring: carried now (`own`), or in their class to learn (C43). */
export interface Recruit { hero: HeroView; why: string; heal?: { skill: string; avg: number; own: boolean }; stun?: { skill: string; own: boolean } }
export interface Fill { gap: "healer" | "stun"; text: string }
/** What the four lack that a recruit brings (C43): a true healer, then a stun. Each gap goes to the first recruit, in the
 *  order given, who brings it; a recruit who carries it beats one who would have to learn it. */
export function fills(p: Party | undefined, recruits: Recruit[]): Map<number, Fill> {
  const out = new Map<number, Fill>()
  if (!p) return out
  const pick = <T extends { own: boolean }>(get: (r: Recruit) => T | undefined) => [...recruits].filter((r) => get(r) && !out.has(r.hero.guid)).sort((x, y) => Number(get(y)!.own) - Number(get(x)!.own))[0]
  const has = (r: Recruit, skill: string, own: boolean) => own ? `${r.hero.name} carries ${skill}` : `${r.hero.name} could learn ${skill} at the Guild`
  if (!p.healer) { const r = pick((r) => r.heal); if (r) out.set(r.hero.guid, { gap: "healer", text: `the four have no true healer, and ${has(r, r.heal!.skill, r.heal!.own)}, about ${r.heal!.avg} hit points a cast` }) }
  if (!p.stunner) { const r = pick((r) => r.stun); if (r) out.set(r.hero.guid, { gap: "stun", text: `the four have no stun, and ${has(r, r.stun!.skill, r.stun!.own)}` }) }
  return out
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

  // the four skills each hero would carry from rank r: their learned skills, best for that seat first (C34)
  const kits = new Map<string, { id: string; name: string; k: Skill | undefined }[]>()
  const kit = (h: HeroView, r: number) => {
    const key = `${h.guid}:${r}`
    if (!kits.has(key)) {
      const sk = info.get(h.guid)!.skills, worn = new Set(h.skills.map((s) => s.id))
      kits.set(key, (h.learned ?? h.skills).map((s) => ({ id: s.id, name: s.name, k: sk.get(s.id) }))
        .sort((x, y) => skillWorth(y.k, r, q) - skillWorth(x.k, r, q) || Number(worn.has(y.id)) - Number(worn.has(x.id))).slice(0, 4))
    }
    return kits.get(key)!
  }
  // which ranks each hero can fight from: at least two of the skills they would carry there launch there, and one of them
  // strikes a foe (Wissant at rank 1 had only Transform and Absolution: Soushi, 2026-10-11, "really not good at rank 1")
  const ranksFor = (h: HeroView) => [1, 2, 3, 4].filter((r) => { const here = kit(h, r).filter((s) => s.k?.launch.includes(r)); return here.length >= 2 && here.some((s) => s.k!.target.length) })
  const usable = (h: HeroView, r: number) => kit(h, r).filter((s) => s.k?.launch.includes(r)).map((s) => s.name)
  // the best heal on an ally each hero can cast from rank r, by the hit points it restores
  const healAt = (h: HeroView, r: number): Heal | undefined => kit(h, r).filter(({ k }) => k?.heal && k.targetsAllies && k.launch.includes(r)).map(({ name, k }) => ({ by: h.name, skill: name, avg: k!.healAvg })).sort((x, y) => y.avg - x.avg)[0]
  const stuns = (h: HeroView, r: number) => kit(h, r).some((s) => s.k?.stun && s.k.launch.includes(r))

  let best: Party | undefined
  const n = pool.length
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) {
    const four = [pool[a]!, pool[b]!, pool[c]!, pool[d]!]
    // try every order; rank 1 is the front
    const meanHp = four.reduce((t, h) => t + info.get(h.guid)!.hp, 0) / 4
    for (const order of permutations(four)) {
      if (!order.every((h, i) => ranksFor(h).includes(i + 1))) continue
      const heal = order.map((h, i) => healAt(h, i + 1)).filter((x): x is Heal => !!x).sort((x, y) => y.avg - x.avg)[0]
      const healer = !!heal && heal.avg >= RULE.realHeal, stunner = order.some((h, i) => stuns(h, i + 1))
      let score = 0
      const reach = new Set<number>()
      let pair: Party["pair"], marker: { h: HeroView; name: string } | undefined, striker: { h: HeroView; name: string } | undefined
      order.forEach((h, i) => {
        const r = i + 1, cls = info.get(h.guid)!, mine = kit(h, r)
        // a seat is worth what its skills are worth from there, and the front wants hit points
        for (const s of mine) score += skillWorth(s.k, r, q)
        score += [2, 1, -1, -2][i]! * (cls.hp - meanHp) * RULE.frontHp
        score += h.level * RULE.levelWorth - h.stress * RULE.stressWeight + fit.get(h.guid)!.score
        // C32: the enemy ranks this seat can strike
        for (const s of mine) if (s.k?.launch.includes(r)) for (const e of s.k.target) reach.add(e)
        // C33: still able to attack one rank off the seat, or to move back into it
        for (const n of [r - 1, r + 1]) if (n >= 1 && n <= 4 && mine.some((s) => s.k?.target.length && s.k.launch.includes(n))) score += RULE.shufflePerSide
        if (mine.some((s) => s.k && (s.k.move[0] || s.k.move[1]))) score += RULE.moveWorth
        // C35: a mark, and a hand that strikes the marked harder
        marker ??= ((s) => (s ? { h, name: s.name } : undefined))(mine.find((s) => s.k?.marks && s.k.launch.includes(r)))
        striker ??= ((s) => (s ? { h, name: s.name } : undefined))(mine.find((s) => s.k?.onMarked && s.k.launch.includes(r)))
      })
      score += RULE.reachPerRank * reach.size
      if (marker && striker) { score += RULE.markPair; pair = { marker: marker.h.name, mark: marker.name, striker: striker.h.name, strike: striker.name } }
      // a true healer is what brings a party home; a light heal helps, but does not stand in for one
      if (healer) score += RULE.healerWorth
      else if (heal) score += RULE.lightHealWorth
      if (stunner) score += RULE.stunWorth
      if (new Set(order.map((h) => h.cls)).size < 4) score -= RULE.sameClass
      if (!best || score > best.score) {
        best = {
          quest: q, score, healer, heal, stunner, notes: [], reach: [...reach].sort(), pair,
          seats: order.map((h, i) => ({ hero: h, rank: i + 1, skills: usable(h, i + 1), notes: fit.get(h.guid)!.notes, carry: kit(h, i + 1).map((s) => s.name) })),
        }
      }
    }
  }
  if (best) {
    // C34: the swaps each seat takes, and a skill not yet learned that would serve the seat better than one carried
    for (const seat of best.seats) {
      const h = seat.hero, r = seat.rank, mine = kit(h, r), worn = h.skills
      seat.swaps = mine.filter((s) => !worn.some((w) => w.id === s.id)).map((s, i) => ({ equip: s.name, for: worn.filter((w) => !mine.some((m) => m.id === w.id))[i]?.name ?? "" }))
      const learned = new Set((h.learned ?? h.skills).map((s) => s.id)), sk = info.get(h.guid)!.skills
      const weakest = Math.min(...mine.map((s) => skillWorth(s.k, r, q)))
      const cand = [...sk.values()].filter((k) => !learned.has(k.id) && skillWorth(k, r, q) > weakest).sort((x, y) => skillWorth(y, r, q) - skillWorth(x, r, q))[0]
      if (cand) {
        const gold = (await heroTrees(h.cls)).get(`${h.cls}.${cand.id}`)?.find((x) => x.code === "0")?.cost.find((c) => c.type === "gold")?.amount
        if (gold) seat.learn = { skill: await nameOf("skill", cand.id, h.cls), gold }
      }
    }
    const blind = [1, 2, 3, 4].filter((e) => !best!.reach!.includes(e))
    if (blind.length) best.notes.push(`none of them can strike enemy rank${blind.length > 1 ? "s" : ""} ${blind.join(" and ")} from these seats`)
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
  // C42: a road where a past trip lacked healing weighs a true healer more, and says why
  for (const p of parties) {
    const hurt = [...new Set(bearing(t.ledger ?? [], p.quest).filter((l) => l.kind === "healing").map((l) => l.trip))]
    if (hurt.length && p.healer) p.score += RULE.lessonHeal
    if (hurt.length) p.notes.push(`healing failed on this road before (${hurt.join(", ")})`)
  }
  parties.sort((a, b) => b.score - a.score)
  const best = parties[0]

  // roster: level 0 heroes heavy with negative quirks and outside the best party
  const inParty = new Set(best?.seats.map((s) => s.hero.guid))
  const dismiss = free.filter((h) => h.level === 0 && !inParty.has(h.guid) && negatives(h).length >= RULE.dismissNegatives)
    .map((h) => ({ hero: h, why: `level 0 with ${negatives(h).length} negative quirks: ${negatives(h).map((q) => q.name).join(", ")}` }))
  const room = t.rosterCap - t.rosterSize
  const recruits: Recruit[] = []
  for (const h of t.recruits) {
    const pos = h.quirks.filter((q) => q.positive).map((q) => q.name), neg = negatives(h).map((q) => q.name)
    // C43: the true heal and the stun they bring, from the class file: one they carry first, else one they could learn
    const sk = (await heroClass(h.cls)).skills, mine = new Set((h.learned ?? h.skills).map((s) => s.id))
    const carriedFirst = (x: Skill, y: Skill) => Number(mine.has(y.id)) - Number(mine.has(x.id))
    const heal = [...sk.values()].filter((k) => k.heal && k.targetsAllies && k.healAvg >= RULE.realHeal).sort((x, y) => carriedFirst(x, y) || y.healAvg - x.healAvg)[0]
    const stun = [...sk.values()].filter((k) => k.stun).sort(carriedFirst)[0]
    recruits.push({
      hero: h, why: `${h.from ? `came with the ${h.from}; ` : ""}${pos.length ? `good: ${pos.join(", ")}` : "no good quirk"}; ${neg.length ? `bad: ${neg.join(", ")}` : "no bad quirk"}${room <= 0 ? "; the roster is full" : ""}`,
      heal: heal && { skill: await nameOf("skill", heal.id, h.cls), avg: heal.healAvg, own: mine.has(heal.id) },
      stun: stun && { skill: await nameOf("skill", stun.id, h.cls), own: mine.has(stun.id) },
    })
  }

  // what to buy for the party first: affordable, unblocked, cheapest first
  const partyNames = new Set(best?.seats.map((s) => s.hero.name))
  const forParty = t.heroUpgrades.filter((u) => partyNames.has(u.hero ?? ""))
  const gold = (u: Upgrade) => u.cost.find((c) => c.type === "gold")?.amount ?? 0
  const buys = forParty.filter((u) => u.affordable && !u.blockedBy).sort((a, b) => gold(a) - gold(b))
  const blocked = forParty.filter((u) => u.blockedBy)
  const heirlooms = t.buildingUpgrades.filter((u) => u.affordable)
  const coach = t.buildingUpgrades.filter((u) => u.tree.startsWith("stage_coach."))
  const low = t.heroes.filter((h) => h.level <= 1).length
  const young = t.heroes.length && low / t.heroes.length >= RULE.youngRoster ? { low, of: t.heroes.length } : undefined

  // trinkets in the estate that a party member may wear
  // a trinket goes to an open slot, or replaces a worn one only when it is rarer by the game's own list; class trinkets
  // first, rarest first; listed by hero, back rank first like the party (Soushi, 2026-10-10: "propose only if it is worth the switch")
  const wear = new Map((best?.seats ?? []).map((s) => [s.hero.guid, [...(t.worn[s.hero.guid] ?? [])]]))
  const placed = [...t.estateTrinkets].sort((x, z) => z.classes.length - x.classes.length || x.rank - z.rank).flatMap((tr) => {
    // a hero already wearing this very trinket is not offered a second: nothing in the game's files says one hero may wear two
    // of the same (a trinket's `limit` follows its rarity, not who wears it), so I do not lean on it (U23, the second Stalwart Buckle)
    const could = (best?.seats ?? []).filter((s) => !tr.classes.length || tr.classes.includes(s.hero.cls))
    const fit = could.filter((s) => !wear.get(s.hero.guid)!.some((w) => w.id === tr.id))
    const open = fit.filter((s) => wear.get(s.hero.guid)!.length < t.trinketSlots).sort((x, z) => wear.get(x.hero.guid)!.length - wear.get(z.hero.guid)!.length)[0]
    const who = open ?? fit.map((s) => ({ s, worst: [...wear.get(s.hero.guid)!].sort((x, z) => z.rank - x.rank)[0] })).filter((c) => c.worst && c.worst.rank > tr.rank).sort((x, z) => z.worst!.rank - x.worst!.rank)[0]?.s
    if (!who) {
      const twin = could.filter((s) => !fit.includes(s))
      if (!twin.length) return []
      const cls = tr.classes.length ? twin[0]!.hero.clsName : "hero"
      return [{ rank: 0, trinket: tr.name, to: "", why: `${twin.map((s) => s.hero.name).join(" and ")} already ${twin.length > 1 ? "wear" : "wears"} one, and I do not know that a hero may wear two of the same; it waits for another ${cls}` }]
    }
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

  const healers: Advice["healers"] = [], lostHealers: string[] = []
  const fellNow = new Set((t.back?.heroes ?? []).filter((h) => h.died).map((h) => h.guid))
  for (const h of t.fallen.filter((h) => fellNow.has(h.guid))) {
    const sk = (await heroClass(h.cls)).skills
    if ((h.learned ?? h.skills).some((s) => sk.get(s.id)?.targetsAllies && sk.get(s.id)!.healAvg >= RULE.realHeal)) lostHealers.push(h.name)
  }
  for (const h of t.heroes) {
    const sk = (await heroClass(h.cls)).skills
    const top = (h.learned ?? h.skills).map((s) => ({ name: h.name, skill: s.name, avg: sk.get(s.id)?.targetsAllies ? sk.get(s.id)!.healAvg : 0 })).sort((x, y) => y.avg - x.avg)[0]
    if (top && top.avg >= RULE.realHeal) healers.push(top)
  }
  return { relief, disease, afflicted, ready, parties, best, dismiss, recruits, buys, blocked, heirlooms, coach, young, trinkets, treat, healers, lostHealers, spend: t.wallet.gold ?? 0 }
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
  // each hero with a quirk against this road, the quirk named with what it does (Soushi, 2026-10-11: "what about this?")
  const against = p.seats.filter((s) => s.notes.some((n) => n.startsWith("−"))).map((s) => {
    const said = s.notes.filter((n) => n.startsWith("−")).map((n) => n.slice(2)).map((n) => { const d = s.hero.quirks.find((x) => x.name === n)?.description; return d ? `${n} (${d})` : n })
    return `${s.hero.name} carries ${said.join(" and ")}`
  })
  const checks = [
    { label: "The road is paid for", met: gold >= reserve, why: gold >= reserve ? `the provisions cost ${n(reserve)} of your ${n(gold)} gold` : `the provisions cost ${n(reserve)} and you have ${n(gold)}` },
    { label: "Rested", met: !tired.length, why: tired.length ? `${tired.join(", ")} at ${RULE.sendBelow} stress or more` : `all four under ${RULE.sendBelow} stress` },
    { label: "Sound in mind and body", met: !unfit.length, why: unfit.length ? `${unfit.join(", ")} afflicted, ill or still in a building` : "nobody afflicted, ill or held in town" },
    { label: "A healer goes with them", met: p.healer, why: p.healer ? `${p.heal!.by}'s ${p.heal!.skill}, about ${p.heal!.avg} hit points a cast` : p.heal ? `only ${p.heal.by}'s ${p.heal.skill}, about ${p.heal.avg} hit points a cast: a light heal, not a healer` : "nobody in the four heals another from where they stand" },
    { label: "A stun goes with them", met: p.stunner, why: p.stunner ? "someone can stop a foe's turn" : "nobody can stun from the seat I gave them" },
    { label: "Every rank can fight", met: !short.length, why: short.length ? `${short.join(", ")} with fewer than two skills that reach from their rank` : "each has at least two skills that reach from their rank" },
    { label: "A road you have walked", met: p.quest.walked, why: p.quest.walked ? `${p.quest.known.length} foes there you know` : "you have never walked it" },
    { label: "No quirk turns against them there", met: !against.length, why: against.length ? `${against.join("; ")}` : "no quirk in the four works against this road" },
    { label: "Seasoned enough for its length", met: !(p.green && p.quest.length > 1), why: p.green && p.quest.length > 1 ? "most of them untried, on a road longer than short" : p.green ? "untried, but the road is short" : "enough of them have seen the dark" },
  ]
  const met = checks.filter((c) => c.met).length, pct = Math.round((met / checks.length) * 100)
  // RULE: my words for how ready they are
  const verdict = pct >= 85 ? "I would send them." : pct >= 65 ? "Nearly ready; see what is left below." : "Not yet: I would not send them like this."
  return { met, of: checks.length, pct, verdict, checks }
}

