// C111: the board renders one plan. Every decision the town board and the farewell show is made here, in the order the gold is
// spent (the road's reserve, the heal lesson held back, relief, the Medical Ward, the Treatment Ward, the heal lesson given back,
// the Guild and the Blacksmith, the Survivalist), and returned as one Plan value: the decided values and the facts they rest on.
// The words stay in voice/; voice/board.ts reads this Plan and renders it, and reads no habit of its own.
import { advise, bears, fills, learners, readiness, road, seatParty, RULE, type Advice, type Fill, type Party, type Readiness, type Recruit, type Relief, type RoadItem, type Treat } from "./advise.ts"
import { campWorth } from "./camp.ts"
import { asPack, slotsOf, trims, type PackRules } from "./pack.ts"
import { upkeep, type UpItem, type UpLine } from "./upkeep.ts"
import { untried } from "../road/chronicle.ts"
import { heroClass, type CampSkill, type Cost } from "../sources/game.ts"
import { questLabel, type Activity, type HeroView, type Town, type Upgrade } from "../world/town.ts"
import { newcomersThisWeek, placedThisWeek, planView, rosterLedger, type RosterLedger, type WeekStart } from "../world/week.ts"

/** The habit figures the board's words quote ("anyone at 45 stress or more rests"); the decisions that use them are made here. */
export const HABIT_WORDS = {
  restAbove: RULE.restAbove, sendBelow: RULE.sendBelow, dismissNegatives: RULE.dismissNegatives, packFree: RULE.packFree, turnBackBroken: RULE.turnBackBroken,
}

/** What the reader told the board: the road picked, and the skills preferred at the Guild. */
export interface PlanAnswers { expedition?: string; partyNames?: string[]; preferred?: string[] }

/** The road the reader picked on the board, else the one I lean to (decision 1). */
type Ranked = Pick<Advice, "parties" | "best">
export function pickedRoad(a: Ranked, answers: PlanAnswers): Party | undefined {
  return (answers.expedition && a.parties.find((p) => questLabel(p) === answers.expedition)) || a.best
}
/** Whether the reader's pick matched a road on offer this week. */
export const roadWasPicked = (a: Ranked, answers: PlanAnswers) => !!(answers.expedition && a.parties.some((p) => questLabel(p) === answers.expedition))

/** The four Soushi named in a note, seated for the road picked: four names that are all on the roster, or the note is not a party. */
export async function ownParty(t: Town, a: Ranked, answers: PlanAnswers): Promise<Party | undefined> {
  const quest = pickedRoad(a, answers)?.quest
  if (!answers.partyNames?.length || !quest) return undefined
  const heroes = answers.partyNames.map((n) => t.heroes.find((h) => h.name.toLowerCase() === n.toLowerCase())).filter((h): h is HeroView => !!h)
  return heroes.length === 4 ? seatParty(heroes, quest) : undefined
}

/** The week's advice and the four it is built for: my reading of the Hamlet, the four Soushi named if he named four, and the road.
 *  C112: the advice is made for that one four, so every decision on the board follows the four the board sends. */
export async function prepare(t: Town, answers: PlanAnswers): Promise<{ a: Advice; own?: Party; chosen?: Party; picked: boolean }> {
  let own: Party | undefined
  const a = await advise(t, async (parties, best) => {
    own = await ownParty(t, { parties, best }, answers)
    return own ?? pickedRoad({ parties, best }, answers)
  })
  return { a, own, chosen: a.four, picked: roadWasPicked(a, answers) }
}

/** The heroes who joined within `weeks` (my habit, RULE.settleWeeks), never let go while they settle (decision 33). */
export const settling = (l: RosterLedger, week: number, weeks: number = RULE.settleWeeks) => new Set(Object.entries(l.joined).filter(([, w]) => w > 0 && week - w < weeks).map(([g]) => Number(g)))

/** The week the plan is made for (C90, C92): the save as it stands (`real`, for what was done and for the seats, the beds and the
 *  gold), the Hamlet as the week found it (`planned`, for choosing the four, so following one pick never moves the others), the
 *  heroes placed since the week began (their seats already paid), the newcomers, and the roster ledger with who still settles. */
export interface Week { real: Town; planned: Town; placed: Map<number, string>; newcomers?: Set<number>; ledger: RosterLedger }
export function theWeek(t: Town, start: WeekStart | undefined, prevLedger: RosterLedger | undefined): Week {
  const ledger = rosterLedger(prevLedger, t, start)
  const real: Town = { ...t, settling: settling(ledger, t.week) }
  return { real, planned: planView(real, start), placed: placedThisWeek(real, start), newcomers: newcomersThisWeek(real, start), ledger }
}

/** The heroes of the road just walked whose learned skills hold a true heal, by my habit (RULE.realHeal). */
export async function taleHealers(t: Town): Promise<string[]> {
  if (!t.back) return []
  return (await Promise.all(t.back.heroes.map(async (bh) => {
    const h = [...t.heroes, ...t.fallen].find((x) => x.guid === bh.guid), sk = h ? (await heroClass(h.cls)).skills : undefined
    return !!h && h.skills.some((s) => sk?.get(s.id)?.targetsAllies && sk.get(s.id)!.healAvg >= RULE.realHeal) ? h.name : ""
  }))).filter(Boolean)
}

/** One spending step and the gold left after it, in the order the gold goes (the reserve first). */
export interface Spend { step: "reserve" | "heal-held" | "relief" | "ward" | "treatment" | "upkeep" | "heal-back" | "train" | "survivalist"; gold: number; left: number; who?: string }

export type ReliefWhy = { kind: "dismiss" } | { kind: "paid"; place: string } | { kind: "cheapest"; note: string } | { kind: "taken"; places: string[] } | { kind: "broke" }
/** `left`: the gold still free when the card was decided, in the order the gold is spent (B3: what a lean short of gold quotes) */
export interface ReliefCard { relief: Relief; lean: number; why: ReliefWhy; filedUnder: string; left: number }

export type WardWhy = "paid" | "going" | "bed" | "green" | "broke" | "worth"
export interface WardCard { hero: HeroView; lean: number; why: WardWhy; filedUnder: string; left: number }
export interface WardPlan { ward: Activity; freeBeds: number; cards: WardCard[] }

export type TreatWhy = "paid" | "inParty" | "broke" | "worth"
export interface TreatCard { treat: Treat; lean: number; why: TreatWhy; filedUnder: string; left: number }
export interface TreatmentPlan { ward: Activity; freeSeats: number; cards: TreatCard[]; waiting: Treat[]; inWard: string[] }

export type HealerWhy = { kind: "busy"; where: string } | { kind: "afflicted" } | { kind: "ill" } | { kind: "worn"; stress: number } | undefined
export interface BackPlan {
  home: { hero: HeroView; worn: boolean }[]
  resting: string[]
  lostHealers: string[]
  healers: { name: string; skill: string; avg: number; going: boolean; why: HealerWhy }[]
}

export type Mix = { kind: "with"; vet: HeroView; green: string[] } | { kind: "suggest"; seasoned: HeroView } | undefined
export interface ExpeditionPlan {
  untried: Party[]
  roads: { party: Party; bears: boolean; meanLevel: number }[]
  lean: number
  learners: string[]
  greenKeptShort: boolean
  /** B6: card 2 leans to the four only when the coffers pay for the road and the four can bear it (doctrine rungs 2 and 3) */
  partyLean: number
  partyWhy: { unpaid: boolean; beyond: boolean; meanLevel: number; danger: number; busy: { name: string; where: string }[]; unmet: { label: string; why: string }[] }
  mix: Mix
  learnPrice: Map<string, number>
}

export interface ProvisionsPlan { firewood: boolean; pack?: { slots: number; used: number; free: number; enough: boolean; cut: { key: string; n: number }[] } }
export interface UpkeepPlan { free: number; lines: UpLine[]; spent: number; left: number }
export type TrainWhy = "liked" | "heal" | "cheap" | "broke"
export interface TrainPlan { shown: Upgrade[]; lean: number; why: TrainWhy; liked?: Upgrade; left: number }
export interface CampSeat { hero: HeroView; known: string[]; open?: CampSkill; price: number }
/** B7: the camping skills a hero knows, for the upkeep and the Survivalist alike: every one learned (which holds the ones taken to
 *  the fire), else the ones taken to the fire when the save says nothing more */
const knownAtFire = (h: HeroView) => h.campKnown ?? h.campEquipped ?? []
export type CampWhy = "worth" | "broke" | "no-camp"
export interface CampPlan { camps: boolean; seats: CampSeat[]; best: { hero: HeroView; k: CampSkill; price: number }[]; lean: number; why: CampWhy; left: number }

export interface RecruitCard { recruit: Recruit; take: boolean; held?: HeroView; fill?: Fill; worth: number }
export interface Dismissal { hero: HeroView; why?: string; swap?: { recruit: Recruit; fill?: Fill; bad: number; good: number } }
export interface RosterPlan { free: number; places: number; dismiss: Dismissal[]; recruits: RecruitCard[]; taken: Recruit[]; fill: Map<number, Fill> }

export type HeirloomWhy =
  | { kind: "young-seasoned" } | { kind: "young-step"; step: number } | { kind: "young-waits" } | { kind: "young-short" }
  | { kind: "opens"; most: number } | { kind: "sanitarium" } | { kind: "relief"; place: string } | { kind: "cut"; guild: boolean } | { kind: "none" }
export interface HeirloomPlan { coachOut: Upgrade[]; card: boolean; opens: Upgrade[][]; lean: number; why: HeirloomWhy; young?: { low: number; of: number }; seasoned?: Upgrade; saving?: Saving }

export interface Saving {
  target: Upgrade
  /** every upgrade on the road to the target, in an order the Hamlet allows, with what the estate lacks for each */
  chain: { tree: string; code: string; label: string; cost: Cost[]; ready: boolean; waits: string[]; missing: [string, number][] }[]
  /** what the whole road costs, against what the estate holds */
  need: { type: string; n: number; held: number }[]
  shorts: { type: string; short: number; roads: { dungeonName: string; length: number; goal: string; pays: string }[]; rate?: { trips: number; got: number }; perTrip: number; trips: number }[]
  /** the heirlooms the target does not need */
  spare: [string, number][]
  /** what those can buy now without delaying the target */
  free: Upgrade[]
}

export interface Plan {
  /** the road and the four everything is built for (decision 1) */
  chosen?: Party
  gold: number
  /** C22: the road's provisions and what they hold back (decision 2) */
  roadItems: RoadItem[]
  reserve: number
  /** the gold free once the road is paid: max(0, gold - reserve) */
  free: number
  roadPaid: boolean
  /** how much the coffers lack for the road, when they do */
  short: number
  /** the road is longer than short, so a shorter one is wiser when the coffers cannot pay (decision 7) */
  shorterRoad: boolean
  /** C93: the new heal lesson's price, held back before rest and the wards (decision 3) */
  healHeld: number
  spends: Spend[]
  back?: BackPlan
  readiness?: Readiness
  expedition: ExpeditionPlan
  relief: ReliefCard[]
  stuck: Relief[]
  ward?: WardPlan
  treatment?: TreatmentPlan
  provisions?: ProvisionsPlan
  upkeep?: UpkeepPlan
  train?: TrainPlan
  camp?: CampPlan
  roster: RosterPlan
  alike: { swap: Advice["alike"]; wait: Advice["alike"] }
  heirlooms?: HeirloomPlan
  words: typeof HABIT_WORDS
}

export interface PlanInputs {
  /** the save as it stands, when the plan is made on the Hamlet as the week found it (C90): its seats and beds are the ones handed out */
  real?: Town
  answers: PlanAnswers; own?: Party; prices?: Map<string, number>; placed?: Map<number, string>; newcomers?: Set<number>
  camp?: Map<string, CampSkill>; pack?: PackRules; rates?: Record<string, { trips: number; got: number }>
}

const goldOf = (u: Upgrade) => u.cost.find((c) => c.type === "gold")?.amount ?? 0
const HEAL = /medicine|reconstruction|grace|comfort|heal/i

/** The week's plan: every decision the town board shows, in the order the gold is spent. */
export function plan(t: Town, a: Advice, inp: PlanInputs): Plan {
  const chosen = inp.own ?? pickedRoad(a, inp.answers)
  // C112: one four drives the whole plan; advice made for another four (my best beside a road or four the reader chose) would
  // split the board between two parties, so it is refused: make it with prepare()
  if (chosen !== a.four) throw new Error("the advice was made for another four than the plan's: make it with prepare()")
  const gold = t.wallet.gold ?? 0
  // C22: the road is paid for first; every spending lean below draws only on what is left after it
  const roadItems = road(t, chosen, inp.prices ?? new Map())
  const reserve = roadItems.reduce((x, i) => x + i.count * i.price, 0)
  let left = Math.max(0, gold - reserve)
  const free = left
  const spends: Spend[] = [{ step: "reserve", gold: Math.min(gold, reserve), left }]
  const spend = (step: Spend["step"], n: number, who?: string) => { left -= n; spends.push({ step, gold: n, left, ...(who ? { who } : {}) }) }
  // C93: the four's new heal lesson is set aside right after the road, before any rest or ward is paid (doctrine: the healer first)
  const healLesson = a.buys.find((u) => u.learn)
  const healPrice = healLesson ? goldOf(healLesson) : 0
  const healHeld = healLesson && healPrice <= left ? healPrice : 0
  if (healHeld) spend("heal-held", healHeld, healLesson!.hero)

  // C37: the coach is back
  let back: BackPlan | undefined
  if (t.back) {
    const b = t.back, here = (g: number) => t.heroes.find((h) => h.guid === g)
    const fell = b.heroes.filter((h) => h.died), home = b.heroes.filter((h) => !h.died).map((h) => here(h.guid)).filter((h): h is HeroView => !!h)
    back = {
      home: home.map((h) => ({ hero: h, worn: !!h.affliction || h.stress >= RULE.restAbove })),
      resting: home.filter((h) => h.affliction || h.stress >= RULE.restAbove || h.quirks.some((q) => q.disease)).map((h) => h.name),
      lostHealers: fell.filter((h) => a.lostHealers.includes(h.name)).map((h) => h.name),
      healers: a.healers.map((x) => {
        const h = t.heroes.find((z) => z.name === x.name), going = !!chosen?.seats.some((s) => s.hero.name === x.name)
        const why: HealerWhy = !h || going ? undefined : h.busy ? { kind: "busy", where: h.busy } : h.affliction ? { kind: "afflicted" } : h.quirks.some((q) => q.disease) ? { kind: "ill" } : h.stress >= RULE.sendBelow ? { kind: "worn", stress: h.stress } : undefined
        return { ...x, going, why }
      }),
    }
  }

  // C28: how ready the party is, with the board's reserve
  const ready = chosen ? readiness(t, chosen, reserve) : undefined

  // review 1: a hero of the four who is in a building this week in the save (the four are chosen as the week began, C90) cannot
  // board the coach until they are out
  const busyFour = (chosen?.seats ?? []).map((s) => ({ name: s.hero.name, where: (inp.real ?? t).heroes.find((h) => h.guid === s.hero.guid)?.busy ?? "" })).filter((x) => x.where)

  const unmet = (ready?.checks ?? []).filter((c) => !c.met && c.label !== "The road is paid for").map((c) => ({ label: c.label, why: c.why }))

  // the expedition
  const leanIdx = chosen ? a.parties.indexOf(chosen) : 0
  const expedition: ExpeditionPlan = {
    untried: a.parties.filter((p) => untried(t.ledger ?? [], p.quest, t.trips)),
    roads: a.parties.map((p) => ({ party: p, bears: bears(p), meanLevel: p.seats.reduce((x, s) => x + s.hero.level, 0) / p.seats.length })),
    lean: Math.max(0, leanIdx),
    learners: chosen && learners(chosen) ? chosen.seats.filter((x) => x.hero.level === 0).slice(0, RULE.learners).map((x) => x.hero.name) : [],
    // only said of a short road chosen over longer ones that a green party would have taken
    greenKeptShort: (chosen?.quest.length === 1 ? a.parties.filter((p) => p !== chosen && p.quest.length > 1 && p.green).length : 0) > 0,
    // review 2 (Soushi, 2026-10-13): any of my readiness conditions unmet turns it to No, as well as a road beyond them or one of
    // them in a building; the road's purse is said as how short it is
    partyLean: chosen && (gold < reserve || !bears(chosen) || busyFour.length || unmet.length) ? 1 : 0,
    partyWhy: { unpaid: !!chosen && gold < reserve, beyond: !!chosen && !bears(chosen), meanLevel: chosen ? chosen.seats.reduce((x, s) => x + s.hero.level, 0) / chosen.seats.length : 0, danger: chosen?.quest.difficulty ?? 0, busy: busyFour, unmet },
    mix: chosen ? mix(chosen, t) : undefined,
    learnPrice: new Map((chosen?.seats ?? []).filter((s) => s.learn).map((s) => [s.hero.name, Math.round(s.learn!.gold * (1 - t.skillDiscount))])),
  }

  // C90: the four are chosen on the Hamlet as the week found it, but the seats and the beds handed out are the save's. A hero
  // placed since the week began holds the seat they took (the save counts it as used), paid for already, before anyone else is
  // leaned anywhere; nobody else is leaned into it, and they are never charged again
  const live = inp.real ?? t, placed = inp.placed ?? new Map<number, string>()

  // relief: each lean takes its seat, so no two cards lean to the same last seat (U11)
  const seatsLeft = new Map(live.activities.map((x) => [x.activity, x.slots - x.used]))
  // C97: the relief activities leaned this week, for the heirlooms to improve; B10: known by the upgrade tree the game files them
  // under ("<building>.<activity>"), never by their name inside an upgrade's label
  const reliefUsed: { tree: string; name: string }[] = []
  const used = (x: Activity) => reliefUsed.push({ tree: `${x.building}.${x.activity}`, name: x.name })
  const relief: ReliefCard[] = []
  for (const r of a.relief) {
    if (!r.options.length) continue
    const now = left
    if (a.dismiss.some((d) => d.hero.guid === r.hero.guid)) { relief.push({ relief: r, lean: r.options.length, why: { kind: "dismiss" }, filedUnder: "", left: now }); continue }
    // a hero already placed this week has been paid for out of the coffers: lean where they are (or to staying there, when it is
    // not a place of relief), and charge nothing again
    const paid = placed.get(r.hero.guid)
    if (paid) {
      const at = r.options.findIndex((o) => o.activity.name === paid)
      if (at >= 0) used(r.options[at]!.activity)
      relief.push({ relief: r, lean: at >= 0 ? at : r.options.length, why: { kind: "paid", place: paid }, filedUnder: at >= 0 ? r.options[at]!.activity.buildingName : "", left: now })
      continue
    }
    const best = r.options.find((o) => o.activity.cost <= left && (seatsLeft.get(o.activity.activity) ?? 0) > 0)
    const taken = r.options.filter((o) => o.activity.cost <= left && !((seatsLeft.get(o.activity.activity) ?? 0) > 0))
    if (best) {
      spend("relief", best.activity.cost, r.hero.name)
      used(best.activity)
      seatsLeft.set(best.activity.activity, (seatsLeft.get(best.activity.activity) ?? 1) - 1)
      relief.push({ relief: r, lean: r.options.indexOf(best), why: { kind: "cheapest", note: best.note }, filedUnder: best.activity.buildingName, left: now })
    } else if (taken.length) relief.push({ relief: r, lean: r.options.length, why: { kind: "taken", places: taken.map((o) => o.activity.name) }, filedUnder: "", left: now })
    else relief.push({ relief: r, lean: r.options.length, why: { kind: "broke" }, filedUnder: "", left: now })
  }

  // the Medical Ward: the free beds go to the most experienced first; C86: an ill true healer takes the first bed
  const wardAct = live.activities.find((x) => x.activity === "disease_treatment")
  let ward: WardPlan | undefined
  if (wardAct) {
    let beds = wardAct.slots - wardAct.used
    const cards: WardCard[] = []
    for (const h of [...a.disease].sort((x, z) => Number(a.trueHealer.has(z.guid)) - Number(a.trueHealer.has(x.guid)) || z.level - x.level || z.xp - x.xp)) {
      // C90: placed in the ward since the week began, in a bed the save already counts: kept there, at no further charge
      if (placed.get(h.guid) === wardAct.name) { cards.push({ hero: h, lean: 0, why: "paid", filedUnder: wardAct.buildingName, left }); continue }
      // C89: a hero I seat in this week's four goes on the road, not to the ward
      const going = !!chosen?.seats.some((x) => x.hero.guid === h.guid)
      const gets = !going && beds > 0
      if (gets) beds--
      const purse = wardAct.cost <= left, now = left
      const lean = !going && gets && h.level >= 1 && purse ? 0 : 1
      if (lean === 0) spend("ward", wardAct.cost, h.name)
      const why: WardWhy = going ? "going" : !gets ? "bed" : h.level < 1 ? "green" : !purse ? "broke" : "worth"
      cards.push({ hero: h, lean, why, filedUnder: lean === 0 ? wardAct.buildingName : "", left: now })
    }
    ward = { ward: wardAct, freeBeds: wardAct.slots - wardAct.used, cards }
  }

  // the Treatment Ward (C25): one quirk per hero, by my habit; seats to the party first, then the most experienced
  const tw = live.activities.find((x) => x.activity === "treatment")
  let treatment: TreatmentPlan | undefined
  if (tw) {
    let seats = tw.slots - tw.used
    const cards: TreatCard[] = [], waiting: Treat[] = []
    // C90: a hero placed in the ward since the week began keeps the seat the save counts, paid for, ahead of the line
    const there = (tr: Treat) => placed.get(tr.hero.guid) === tw.name
    for (const tr of a.treat.filter(there)) cards.push({ treat: tr, lean: 0, why: "paid", filedUnder: tw.buildingName, left })
    for (const tr of a.treat.filter((x) => !there(x))) {
      // a card only while a seat is free; the rest wait in line. Only a card that leans to the ward takes the seat: one leaned
      // Not this week (one of the four, or short of gold) passes it to the next in line, in the line's order (C103: a thief
      // first) (Soushi, 2026-10-13)
      if (seats <= 0) { waiting.push(tr); continue }
      const purse = tr.cost <= left, now = left
      // a hero in the ward cannot board the coach: never lean on treating one of the four I would send (Soushi, 2026-10-10)
      const lean = purse && !tr.inParty ? 0 : 1
      if (lean === 0) { seats--; spend("treatment", tr.cost, tr.hero.name) }
      const why: TreatWhy = tr.inParty ? "inParty" : !purse ? "broke" : "worth"
      cards.push({ treat: tr, lean, why, filedUnder: lean === 0 ? tw.buildingName : "", left: now })
    }
    treatment = { ward: tw, freeSeats: tw.slots - tw.used, cards, waiting, inWard: live.heroes.filter((h) => h.busy === tw.name).map((h) => h.name) }
  }

  // provisions: firewood for a road with a camp; C79: the pack's slots against what stays free
  let provisions: ProvisionsPlan | undefined
  if (chosen) {
    const q = chosen.quest
    provisions = { firewood: q.length >= 2 }
    if (inp.pack?.slots) {
      const buy = asPack({ ...Object.fromEntries(roadItems.map((i) => [i.id, i.count])), ...(q.length >= 2 ? { firewood: 1 } : {}) }), used = slotsOf(buy, inp.pack), slack = inp.pack.slots - used
      provisions.pack = { slots: inp.pack.slots, used, free: slack, enough: slack >= RULE.packFree, cut: slack < RULE.packFree ? trims(buy, inp.pack) : [] }
    }
  }

  // C78: the upkeep of the four who leave, from the gold free at this point: after the road, the rest and the wards, with the
  // heal lesson still held (the healer first), and before the Guild's and the Survivalist's leans, which draw on what it leaves
  let up: UpkeepPlan | undefined
  const upBuys = new Set<string>()
  if (chosen) {
    const seated = new Map(chosen.seats.map((s) => [s.hero.name, s]))
    const items: UpItem[] = t.heroUpgrades.filter((u) => seated.has(u.hero ?? "")).map((u) => {
      const kind = /\.weapon$/.test(u.tree) ? "weapon" : /\.armour$/.test(u.tree) ? "armour" : "skill", s = seated.get(u.hero!)!
      return { hero: u.hero!, what: `${u.label} to level ${u.toLevel}`, kind, gold: goldOf(u),
        heal: kind === "skill" && HEAL.test(u.label), used: kind !== "skill" || (s.carry ?? s.skills).some((k) => k.toLowerCase() === u.label.toLowerCase()),
        ...(u.blockedBy ? { blockedBy: u.blockedBy } : {}) } as UpItem
    })
    // the camping skill most worth learning for each, by the same habit as the Survivalist's card (C47)
    if (inp.camp) for (const s of chosen.seats) {
      const known = knownAtFire(s.hero)
      const k = [...inp.camp.values()].filter((x) => x.classes.includes(s.hero.cls) && !known.includes(x.id) && x.gold > 0).sort((x, z) => campWorth(z, RULE) - campWorth(x, RULE) || x.gold - z.gold)[0]
      if (k) items.push({ hero: s.hero.name, what: `${k.name} at the Survivalist`, kind: "camp", gold: Math.round(k.gold * (1 - t.campDiscount)) })
    }
    const p = upkeep(items, left, { camps: chosen.quest.length >= 2, dismiss: new Map(a.dismiss.map((d) => [d.hero.name, d.why])) })
    up = { free: left, ...p }
    if (p.spent) spend("upkeep", p.spent)
    for (const l of p.lines) if (l.status === "buy") upBuys.add(`${l.item.hero}|${l.item.what}`)
  }
  // what the Guild or the Survivalist leans to that the upkeep already buys is paid once, by the upkeep
  const extra = (hero: string | undefined, what: string, gold: number) => (upBuys.has(`${hero}|${what}`) ? 0 : gold)

  // the Guild and the Blacksmith: a skill you named comes first, then healing, then the cheapest step (#4)
  let train: TrainPlan | undefined
  if (a.buys.length) {
    const preferred = inp.answers.preferred ?? []
    const named = (u: Upgrade) => u.where === "Guild" && preferred.some((n) => n.toLowerCase() === u.label.toLowerCase())
    // the five cheapest lessons, and every piece of the smith's work the coffers can pay for, and every lesson you named
    const shown = [...a.buys.filter(named), ...a.buys.filter((u) => u.where !== "Blacksmith" && !named(u)).slice(0, 5), ...a.buys.filter((u) => u.where === "Blacksmith")]
    const price = (u: Upgrade) => (u.learn ? goldOf(u) : extra(u.hero, `${u.label} to level ${u.toLevel}`, goldOf(u)))
    const liked = shown.findIndex((u) => u.where === "Guild" && price(u) <= left && preferred.some((n) => n.toLowerCase() === u.label.toLowerCase()))
    if (healHeld) spend("heal-back", -healHeld, healLesson!.hero)
    const heal = [shown.findIndex((u) => !!u.learn && price(u) <= left), shown.findIndex((u) => HEAL.test(u.label) && price(u) <= left)].find((i) => i >= 0) ?? -1
    const cheap = shown.findIndex((u) => price(u) <= left), now = left
    const pick = liked >= 0 ? liked : heal >= 0 ? heal : cheap
    if (pick >= 0) spend("train", price(shown[pick]!), shown[pick]!.hero)
    train = { shown, lean: pick >= 0 ? pick : shown.length, why: liked >= 0 ? "liked" : heal >= 0 ? "heal" : cheap >= 0 ? "cheap" : "broke", ...(liked >= 0 ? { liked: shown[liked]! } : {}), left: now }
  }

  // C47: the Survivalist, the most worth at the fire for this road within the gold left
  let camp: CampPlan | undefined
  if (inp.camp && chosen) {
    const lib = inp.camp, price = (k: CampSkill) => Math.round(k.gold * (1 - t.campDiscount)), worth = (k: CampSkill) => campWorth(k, RULE)
    const camps = chosen.quest.length >= 2
    const seats: CampSeat[] = [], best: CampPlan["best"] = []
    for (const s of chosen.seats) {
      const h = s.hero, known = knownAtFire(h)
      const open = [...lib.values()].filter((k) => k.classes.includes(h.cls) && !known.includes(k.id) && k.gold > 0).sort((x, z) => worth(z) - worth(x) || price(x) - price(z))
      if (open[0]) best.push({ hero: h, k: open[0], price: price(open[0]) })
      seats.push({ hero: h, known, ...(open[0] ? { open: open[0] } : {}), price: open[0] ? price(open[0]) : 0 })
    }
    let lean = best.length, why: CampWhy = camps ? "broke" : "no-camp"
    const now = left
    if (best.length) {
      const cost = (b: CampPlan["best"][number]) => extra(b.hero.name, `${b.k.name} at the Survivalist`, b.price)
      const pick = camps ? best.map((b, i) => ({ b, i })).filter(({ b }) => cost(b) <= left).sort((x, z) => worth(z.b.k) - worth(x.b.k))[0] : undefined
      if (pick) { spend("survivalist", cost(pick.b), pick.b.hero.name); lean = pick.i; why = "worth" }
    }
    camp = { camps, seats, best, lean, why, left: now }
  }

  // who stays, who goes. C29: recruits share the places the roster has, counting the ones my dismissals would free
  const worth = (h: HeroView) => h.quirks.filter((q) => q.positive).length - h.quirks.filter((q) => !q.positive && !q.disease).length
  const byWorth = [...a.recruits].sort((x, z) => worth(z.hero) - worth(x.hero) || z.hero.level - x.hero.level)
  // C43: a recruit who brings what the four lack (a true healer, a stun) comes first, whatever their quirks
  const fill = fills(chosen, byWorth), fillOf = (r: { hero: HeroView }) => fill.get(r.hero.guid)
  const ranked = [...byWorth].sort((x, z) => Number(!!fillOf(z)) - Number(!!fillOf(x)))
  // a full roster still has choices: a recruit clearly better than a level 0 hero outside the party is worth the swap (by 2 or more)
  const sendingNow = new Set(chosen?.seats.map((x) => x.hero.guid))
  const named = new Set(a.dismiss.map((d) => d.hero.guid))
  // a hero this board sends to the Abbey, the Tavern or the Sanitarium is not one it lets go
  const tended = new Set([...a.relief.map((r) => r.hero.guid), ...a.treat.map((x) => x.hero.guid), ...a.disease.map((h) => h.guid)])
  // C88: a hero who joined this week is never let go for another recruit the same week
  const weak = t.heroes.filter((h) => h.level === 0 && !h.busy && !sendingNow.has(h.guid) && !named.has(h.guid) && !tended.has(h.guid) && !inp.newcomers?.has(h.guid) && !t.settling?.has(h.guid)).sort((x, z) => worth(x) - worth(z))
  // C88: a recruit of a class the roster already holds is never taken, except a true healer (C86)
  const held = (r: Recruit) => r.heal ? undefined : t.heroes.find((h) => h.cls === r.hero.cls)
  let open = Math.max(0, t.rosterCap - t.rosterSize) + a.dismiss.length
  const dismiss: Dismissal[] = a.dismiss.map((d) => ({ hero: d.hero, why: d.why }))
  for (const r of ranked.filter((r) => !held(r) && (fillOf(r) || worth(r.hero) > 0))) {
    if (open > 0) { open--; continue }
    const w = weak.shift()
    if (!w || (!fillOf(r) && worth(r.hero) - worth(w) < 2)) break
    dismiss.push({ hero: w, swap: { recruit: r, ...(fillOf(r) ? { fill: fillOf(r)! } : {}), bad: w.quirks.filter((q) => !q.positive && !q.disease).length, good: w.quirks.filter((q) => q.positive).length } })
  }
  const places = Math.max(0, t.rosterCap - t.rosterSize) + dismiss.length
  const taken = ranked.filter((r) => !held(r) && (fillOf(r) || worth(r.hero) >= 0)).slice(0, places)
  const roster: RosterPlan = {
    free: t.rosterCap - t.rosterSize, places, dismiss, taken, fill,
    recruits: ranked.map((r) => ({ recruit: r, take: taken.includes(r), ...(held(r) ? { held: held(r)! } : {}), ...(fillOf(r) ? { fill: fillOf(r)! } : {}), worth: worth(r.hero) })),
  }

  // heirlooms (decision 31)
  let heirlooms: HeirloomPlan | undefined
  if (a.heirlooms.length || a.trinkets.length) {
    const coachOut = a.coach.filter((u) => !u.affordable)
    const card = !!(a.heirlooms.length || coachOut.length)
    // an affordable building upgrade that opens the party's own waiting upgrades comes first (Soushi, 2026-10-10)
    const opens = a.heirlooms.map((u) => a.blocked.filter((b) => b.blockedBy.includes(`${u.tree} ${u.code}`)))
    const most = opens.reduce((best, o, i) => (o.length > (opens[best]?.length ?? 0) ? i : best), -1)
    const san = a.heirlooms.findIndex((u) => u.tree === "sanitarium.disease_quirk_cost" || u.tree === "sanitarium.cost")
    // my habit: a roster mostly at level 1 or lower wants seasoned recruits before anything else the heirlooms can buy
    const seasoned = a.coach.find((u) => u.tree === "stage_coach.upgraded_recruits"), si = seasoned ? a.heirlooms.indexOf(seasoned) : -1
    // C97: the habit buys the first tier of seasoned recruits; once that is bought, the heirlooms go to what they can build now
    const young = !!(a.young && seasoned && seasoned.code === "a")
    // U40: on the road to the seasoned recruits, a step the estate can buy tonight is bought, not saved for
    const onRoad = (seasoned?.chain ?? []).filter((x) => x.ready).map((x) => a.heirlooms.findIndex((u) => u.tree === x.tree && u.code === x.code)).filter((i) => i >= 0)
    const step = onRoad.find((i) => (opens[i]?.length ?? 0) > 0) ?? onRoad[0] ?? -1
    // C97: after the young habit, the doctrine's order: what opens the four's waiting upgrades, the Sanitarium, the relief the
    // heroes use this week (stress), then a lower price where the party's gold goes (the Guild if it trains this week, else the smith)
    const reliefAt = a.heirlooms.findIndex((u) => reliefUsed.some((x) => x.tree === u.tree))
    const guild = a.buys.some((b) => b.where === "Guild")
    const cut = a.heirlooms.findIndex((u) => u.label === (guild ? "Guild: lower prices" : "Blacksmith: lower prices"))
    const lean = young ? (si >= 0 ? si : step >= 0 ? step : a.heirlooms.length) : most >= 0 ? most : san >= 0 ? san : reliefAt >= 0 ? reliefAt : cut >= 0 ? cut : a.heirlooms.length
    const why: HeirloomWhy = young ? (si >= 0 ? { kind: "young-seasoned" } : step >= 0 ? { kind: "young-step", step } : seasoned!.blockedBy ? { kind: "young-waits" } : { kind: "young-short" })
      : most >= 0 ? { kind: "opens", most } : san >= 0 ? { kind: "sanitarium" } : reliefAt >= 0 ? { kind: "relief", place: reliefUsed.find((x) => x.tree === a.heirlooms[reliefAt]!.tree)!.name } : cut >= 0 ? { kind: "cut", guild } : { kind: "none" }
    heirlooms = {
      coachOut, card, opens, lean, why, ...(a.young ? { young: a.young } : {}), ...(seasoned ? { seasoned } : {}),
      // U22: saving is a plan, not a wait
      ...(card && young && si < 0 && seasoned ? { saving: saving(t, a, seasoned, inp.rates ?? {}) } : {}),
    }
  }

  return {
    chosen, gold, roadItems, reserve, free, roadPaid: gold >= reserve, short: Math.max(0, reserve - gold), shorterRoad: !!chosen && chosen.quest.length > 1, healHeld, spends,
    back, readiness: ready, expedition, relief, stuck: a.relief.filter((r) => !r.options.length), ward, treatment, provisions, upkeep: up, train, camp, roster,
    alike: { swap: a.alike.filter((p) => p.recruit), wait: a.alike.filter((p) => !p.recruit) }, heirlooms, words: HABIT_WORDS,
  }
}

/** The four's experience (C85, my habit): a seasoned hero beside newcomers steadies them, so a party of newcomers is told who
 *  of the roster could go with them (decision 12). */
function mix(p: Party, t: Town): Mix {
  const lv = p.seats.map((s) => s.hero.level), top = Math.max(...lv)
  const vet = p.seats.find((s) => s.hero.level === top)!.hero, green = p.seats.filter((s) => s.hero.level <= 1 && s.hero.guid !== vet.guid).map((s) => s.hero.name)
  if (top >= 2 && green.length) return { kind: "with", vet, green }
  const seasoned = t.heroes.filter((h) => h.level >= 2 && !p.seats.some((s) => s.hero.guid === h.guid)).sort((a, b) => b.level - a.level)[0]
  return top <= 1 && seasoned ? { kind: "suggest", seasoned } : undefined
}

/** The plan behind a lean to keep the heirlooms (U22, decision 32): the whole road to the target, what is short, which of this
 *  week's roads pay it, the rate the recorded trips brought it home at, and what the other heirlooms can buy without delaying it. */
export function saving(t: Town, a: Pick<Advice, "heirlooms">, target: Upgrade, rates: Record<string, { trips: number; got: number }>): Saving {
  const held = (k: string) => t.wallet[k] ?? 0
  const steps = target.chain?.length ? target.chain : [{ tree: target.tree, code: target.code, label: target.label, cost: target.cost, ready: target.affordable, waits: [] as string[] }]
  const chain = steps.map((x) => ({ ...x, missing: x.cost.filter((c) => c.amount > held(c.type)).map((c): [string, number] => [c.type, c.amount - held(c.type)]) }))
  const need = new Map<string, number>()
  for (const x of chain) for (const c of x.cost) need.set(c.type, (need.get(c.type) ?? 0) + c.amount)
  const pays = (k: string) => (r: string) => new RegExp(`^\\d+ ${k}s?$`).test(r)
  const shorts = [...need].filter(([k, n]) => n > held(k)).map(([k, n]) => {
    const short = n - held(k), r = rates[k], perTrip = r && r.trips ? r.got / r.trips : 0
    const roads = t.quests.filter((q) => !q.plot && q.rewards.some(pays(k))).map((q) => ({ dungeonName: q.dungeonName, length: q.length, goal: q.goal, pays: q.rewards.find(pays(k))! }))
    return { type: k, short, roads, ...(r ? { rate: r } : {}), perTrip, trips: perTrip > 0 ? Math.ceil(short / perTrip) : 0 }
  })
  // what the rest can buy without touching what the target needs
  const keep = Object.fromEntries([...need].map(([k, n]) => [k, Math.min(n, held(k))]))
  const spare = (k: string) => held(k) - (keep[k] ?? 0)
  const free = a.heirlooms.filter((u) => u !== target && !chain.some((x) => x.tree === u.tree && x.code === u.code) && u.cost.every((c) => c.amount <= spare(c.type)))
  return {
    target, chain, need: [...need].map(([type, n]) => ({ type, n, held: held(type) })), shorts,
    spare: Object.keys(t.wallet).filter((k) => ["crest", "bust", "portrait", "deed"].includes(k) && spare(k) > 0).map((k): [string, number] => [k, spare(k)]), free,
  }
}

/** The farewell's decisions (decisions 36 to 38): the proposal it judges against, how the departure matches it, who to watch,
 *  and the packs against my habit. */
export interface FarewellPlan {
  proposal?: { week: number; dungeon: string; length: number; party: number[]; own: boolean }
  sameFour: boolean; sameOrder: boolean; sameRoad: boolean
  who: { hero: HeroView; worry: { worn: boolean; affliction?: string; ill: string[] }; placedInstead?: string | null }[]
  carry: { item: RoadItem; has: number; enough: boolean }[]
  others: [string, number][]
  pack?: { used: number; slots: number; free: number }
  words: typeof HABIT_WORDS
}
export function farewellPlan<P extends { week: number; dungeon: string; length: number; party: number[]; own: boolean }>(t: Town, r: NonNullable<Town["raid"]>, opts: { proposal?: P; prices: Map<string, number>; pack?: PackRules }): FarewellPlan & { proposal?: P } {
  const q = r.quest
  const who = r.party.map((g) => t.heroes.find((h) => h.guid === g)).filter((h): h is HeroView => !!h)
  const p = opts.proposal && opts.proposal.week === t.week ? opts.proposal : undefined
  const sameFour = !!p && p.party.length === r.party.length && p.party.every((g) => r.party.includes(g))
  const sameOrder = sameFour && p!.party.every((g, i) => r.party[i] === g)
  const sameRoad = !!p && p.dungeon === q.dungeon && p.length === q.length
  const habit = road(t, { quest: q } as Party, opts.prices)
  const used = opts.pack?.slots ? slotsOf(asPack(r.carried), opts.pack) : 0
  return {
    ...(p ? { proposal: p } : {}), sameFour, sameOrder, sameRoad,
    // the first save on the road can follow a fight, so this is how they stand now, not how they left
    who: who.map((h, i) => ({
      hero: h,
      worry: { worn: h.stress >= RULE.sendBelow, ...(h.affliction ? { affliction: h.affliction } : {}), ill: h.quirks.filter((x) => x.disease).map((x) => x.name) },
      ...(p && p.party[i] !== h.guid ? { placedInstead: t.heroes.find((x) => x.guid === p.party[i])?.name ?? null } : {}),
    })),
    carry: habit.map((i) => { const has = r.carried[i.id] ?? 0; return { item: i, has, enough: has >= i.count } }),
    others: Object.entries(r.carried).filter(([id]) => !habit.some((i) => i.id === id)),
    ...(opts.pack?.slots ? { pack: { used, slots: opts.pack.slots, free: opts.pack.slots - used } } : {}),
    words: HABIT_WORDS,
  }
}

