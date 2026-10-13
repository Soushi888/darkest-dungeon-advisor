// Writes the town board: a niceboard source in the Caretaker's voice, the portraits it shows, and the
// compiled page. One fixed file name, so the picks a reader makes survive every rebuild of the board.
// The board speaks only as the Caretaker, in the Hamlet's own words (C13): no file, field or save is named on it.
// Where each figure comes from goes to sources.md beside it (C14).
import { teachings } from "./teach.ts"
import { campTell, campWorth } from "./camp.ts"
import { ROLE_WORDS } from "./roles.ts"
import { asPack, packRules, slotsOf, trims, type PackRules } from "./pack.ts"
import { upkeep, upkeepWords, type UpItem } from "./upkeep.ts"
import { checkTale } from "./talecheck.ts"
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { advise, DOCTRINE, fills, learners, readiness, road, seatParty, RULE, RULE_FOOD, RULE_PROVISION, type Advice, type Party } from "./advise.ts"
export { road, type RoadItem } from "./advise.ts"
import { campingSkills, supplyPrices, type CampSkill, type Cost, nameOf } from "./game.ts"
import { install, root } from "./paths.ts"
import { DIFFICULTY, LENGTH, type HeroView, type Town, type Upgrade } from "./town.ts"
import { buildSkin } from "./skin.ts"
import { loadPicks, reconcile, type Check } from "./reconcile.ts"
import { contradictions } from "./coherence.ts"
import { beats, chronicleFor, heirloomTrips, CHRONICLE_RULE, debrief, judge, loadLedger, remember, untried, type Beat, type Debrief, type Lesson } from "./chronicle.ts"
import { heroClass } from "./game.ts"

// DD_TOWN_OUT lets the tests build elsewhere, so they never touch the live board or its picks. Read at call time: a test file
// sets it after its imports, so a value fixed at import would send its builds into the live board's folder
export const outDir = () => process.env.DD_TOWN_OUT ?? join(root, ".local", "town")
const BOARD = process.env.NICEBOARD ?? join(homedir(), ".claude/skills/Niceboard/Tools/Board.ts")
const y = (s: string) => JSON.stringify(s) // a JSON string is a valid YAML scalar, quotes and colons included
const HABIT = "(my habit)" // how a RULE number is labelled on the board, in his voice (A2)
const coin = (n: number) => `${n.toLocaleString("en-US")} gold`
// C46: stress drawn as a bar on the hero's own gauge, 0 to 200: resolve is tested at 100 and the heart gives out at 200
// (the game's rule as the Darkest Dungeon wiki states it, darkestdungeon.wiki.gg/wiki/Stress; Soushi allowed the wiki 2026-10-11)
const STRESS = { test: 100, max: 200 }
const stressBars = (hs: { name: string; stress: number; affliction?: string }[]) => !hs.length ? [] : ["```board-tally",
  ...hs.flatMap((h) => [`- n: ${h.stress}`, `  label: ${y(`${h.name}'s stress${h.affliction ? `, afflicted (${h.affliction})` : h.stress >= STRESS.test ? ", resolve tested" : ""}`)}`, `  pct: ${Math.min(100, Math.round((h.stress / STRESS.max) * 100))}`]), "```", ""]
const GAUGE = `Each bar is the hero's stress on the gauge of ${STRESS.max}: at ${STRESS.test} their resolve is tested, at ${STRESS.max} the heart gives out.`

function portrait(h: HeroView): string {
  const src = join(install, h.portrait)
  // one file per look, so two heroes of a class who look different keep their own faces (U30)
  const rel = `img/${h.portrait.split("/").at(-2) ?? h.cls}.png`
  if (existsSync(src)) { mkdirSync(join(outDir(), "img"), { recursive: true }); copyFileSync(src, join(outDir(), rel)) }
  return rel
}

/** "needs blacksmith.weapon a" in the Hamlet's words: "the Blacksmith's weapon work, first tier". */
const TIER = ["first", "second", "third", "fourth", "fifth", "sixth"]
export function inWords(need: string): string {
  return need.replace(/^needs /, "").replace(/\b([a-z_]+)\.([a-z_]+) ([a-z])\b/g, (_m, b: string, tree: string, code: string) =>
    `the ${b.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}'s ${tree.replace(/_/g, " ")}, ${TIER[code.charCodeAt(0) - 97] ?? code} tier`)
}

function partyLine(p: Party): string {
  return p.seats.map((s) => `${s.rank}. **${s.hero.name}**, ${s.hero.clsName}`).join(" · ")
}

export interface Answers { expedition?: string; partyOwn?: boolean; partyNames?: string[]; preferred?: string[] }
export async function readAnswers(): Promise<Answers> {
  const f = Bun.file(join(outDir(), "answers.md"))
  if (!(await f.exists())) return {}
  const text = await f.text()
  const a: Answers = {}
  const exp = text.match(/\*\*\d+\. Which expedition[^*]*\*\*\s*(.+)/)
  if (exp) a.expedition = exp[1]!.trim()
  if (/\*\*\d+\. Take this party[^*]*\*\*\s*No/i.test(text)) a.partyOwn = true
  // a note under the party card naming heroes, front to back, is the party Soushi wants
  const note = text.match(/\*\*\d+\. Take this party[^\n]*\n\s*- Note[^:]*:\s*(.+)/)
  if (note) {
    const names = note[1]!.split(/[,;]|\band\b/).map((x) => x.trim()).filter(Boolean)
    if (names.length === 4) a.partyNames = names
  }
  // #4: a note on the Guild card names the skills Soushi prefers ("Prefer: Pistol Shot, Grapeshot Blast"); they are kept
  // across weeks in preferences.json, the latest named first, since the week's answers are replaced at every send
  const guild = text.match(/\*\*\d+\. What do we train first\?\*\*[^\n]*\n\s*- Note[^:]*:\s*(.+)/)
  const prefFile = join(outDir(), "preferences.json")
  const kept = ((await Bun.file(prefFile).json().catch(() => ({}))) as { skills?: string[] }).skills ?? []
  if (guild) {
    const named = guild[1]!.replace(/^\s*(i\s+)?prefer(red)?\s*:?\s*/i, "").replace(/\bover\b.*$/i, "").split(/[,;]|\band\b/).map((x) => x.trim().replace(/\.$/, "")).filter(Boolean)
    const skills = [...named, ...kept.filter((k) => !named.some((n) => n.toLowerCase() === k.toLowerCase()))]
    await Bun.write(prefFile, JSON.stringify({ skills }, null, 1))
    a.preferred = skills
  } else if (kept.length) a.preferred = kept
  return a
}

export function questLabel(p: Party): string {
  const q = p.quest
  // what the road pays leads, so two roads to the same dungeon read apart at a glance (Soushi, 2026-10-10)
  const gold = q.rewards.find((r) => / gold$/.test(r)), trinket = q.rewards[q.rewards.length - 1]
  const pays = [trinket, ...q.rewards.filter((r) => r !== gold && r !== trinket), gold].filter(Boolean)
  return `${q.dungeonName}, ${(LENGTH[q.length] ?? String(q.length)).toLowerCase()} (${q.goal}): ${pays.join(", ")}`
}

/** The Hamlet as the week found it, kept on the first board of each week, so later boards can say what was done since (C26). */
export interface WeekStart { week: number; heroes: { guid: number; name: string; busy?: string }[]; bought: string[]; gold: number | null; purchases?: string[] }

/** C92: the roster ledger, the week each hero joined, kept across weeks so a recruit is not let go while they settle. A hero first
 *  seen this week who was not on the roster when the week began joined this week; anyone else first seen counts as long settled. */
export interface RosterLedger { joined: Record<string, number> }
export function rosterLedger(prev: RosterLedger | undefined, t: Town, start: WeekStart | undefined): RosterLedger {
  const joined = { ...(prev?.joined ?? {}) }
  const atStart = start && start.week === t.week ? new Set(start.heroes.map((h) => h.guid)) : undefined
  for (const h of t.heroes) if (!(String(h.guid) in joined)) joined[String(h.guid)] = atStart && !atStart.has(h.guid) ? t.week : 0
  return { joined }
}
export const settling = (l: RosterLedger, week: number, weeks: number) => new Set(Object.entries(l.joined).filter(([, w]) => w > 0 && week - w < weeks).map(([g]) => Number(g)))

/** The Hamlet as the week found it (C90): heroes placed in a building since the week began are free again, and their seats open.
 *  A week-start record without places (written before C90) counts nobody as placed when the week began. */
export function planView(t: Town, start: WeekStart | undefined): Town {
  if (!start || start.week !== t.week) return t
  const atStart = new Map(start.heroes.map((h) => [h.guid, h.busy ?? ""]))
  const placed = t.heroes.filter((h) => h.busy && atStart.has(h.guid) && !atStart.get(h.guid))
  if (!placed.length) return t
  const freed = new Set(placed.map((h) => h.guid))
  return {
    ...t,
    heroes: t.heroes.map((h) => (freed.has(h.guid) ? { ...h, busy: "" } : h)),
    activities: t.activities.map((x) => ({ ...x, used: x.used - placed.filter((h) => h.busy === x.name).length })),
  }
}

/** What the saves show was done this week, whether or not it was ever sent from the board (C26). */
export function weekSoFar(t: Town, start: WeekStart | undefined): string[] {
  const out: string[] = []
  const placed = t.heroes.filter((h) => h.busy)
  if (placed.length) out.push(`In the buildings: ${placed.map((h) => `${h.name} at the ${h.busy}`).join(", ")}.`)
  if (!start || start.week !== t.week) return out
  const before = new Set(start.heroes.map((h) => h.guid)), now = new Set(t.heroes.map((h) => h.guid))
  const joined = t.heroes.filter((h) => !before.has(h.guid))
  if (joined.length) out.push(`Joined the roster: ${joined.map((h) => `${h.name}, ${h.clsName}`).join("; ")}.`)
  const fell = new Set(t.fallen.map((h) => h.guid))
  const left = start.heroes.filter((h) => !now.has(h.guid))
  if (left.length) out.push(`Gone from the roster: ${left.map((h) => `${h.name}${fell.has(h.guid) ? " (fallen)" : ""}`).join(", ")}.`)
  // code "0" is the level every hero (and every recruit at the coach) starts with, not a purchase
  // each purchase is named for the hero the save records it was bought for, never for the first hero of that class
  const tag = (p: { key: string; guid: number }) => `${p.guid}|${p.key}`
  const had = new Set(start.purchases ?? t.purchases.filter((p) => start.bought.includes(p.key)).map(tag))
  const got = t.purchases.filter((p) => !had.has(tag(p)) && !p.key.endsWith(":0") && (!p.guid || t.heroes.some((h) => h.guid === p.guid) && start.heroes.some((h) => h.guid === p.guid)))
  const named = (p: { key: string; guid: number }) => {
    const [tree = "", code = ""] = p.key.split(":"), hero = t.heroes.find((h) => h.guid === p.guid)
    const step = `${TIER[Number.isNaN(Number(code)) ? code!.charCodeAt(0) - 97 : Number(code)] ?? code} step`
    const u = hero ? t.heroUpgrades.find((x) => x.tree === tree && x.hero === hero.name) : t.buildingUpgrades.find((x) => x.tree === tree)
    return hero ? `${hero.name}'s ${u?.label ?? tree.split(".")[1]!.replace(/_/g, " ")}, ${step}` : u ? `${u.label}, ${step}` : inWords(`${tree} ${code}`)
  }
  if (got.length) out.push(`Bought: ${got.map(named).join("; ")}.`)
  if (start.gold !== null && (t.wallet.gold ?? 0) !== start.gold) out.push(`${coin(Math.abs(start.gold - (t.wallet.gold ?? 0)))} ${(t.wallet.gold ?? 0) < start.gold ? "spent" : "gained"} since the week began.`)
  return out
}

export interface Tale { snaps: number; beats: Beat[]; well: string[]; wrong: string[]; lessons: Lesson[]; debrief?: Debrief; issues?: string[]; taught?: string[] }
export function source(t: Town, a: Advice, opts: { foresight: boolean; answers: Answers; own?: Party; checks?: Check[]; prices?: Map<string, number>; soFar?: string[]; newcomers?: Set<number>; placed?: Map<number, string>; tale?: Tale; camp?: Map<string, CampSkill>; sent?: Proposal; rates?: Record<string, { trips: number; got: number }>; pack?: PackRules }): { board: string; sources: string } {
  const L: string[] = []
  const picked = (opts.answers.expedition && a.parties.find((p) => questLabel(p) === opts.answers.expedition)) || a.best
  const chosen = opts.own ?? picked
  const gold = t.wallet.gold ?? 0
  // C22: the road is paid for first; every spending lean below draws only on what is left after it
  const roadItems = road(t, chosen, opts.prices ?? new Map())
  const reserve = roadItems.reduce((x, i) => x + i.count * i.price, 0)
  let left = Math.max(0, gold - reserve)
  // C93: the four's new heal lesson is set aside right after the road, before any rest or ward is paid (doctrine: the healer first)
  const healLesson = a.buys.find((u) => u.learn)
  const healPrice = healLesson?.cost.find((c) => c.type === "gold")?.amount ?? 0
  const healHeld = healLesson && healPrice <= left ? healPrice : 0
  left -= healHeld
  const firstRoad = `the road comes first: I keep ${coin(reserve)} for provisions, and ${left + healHeld ? `only ${coin(left + healHeld)} is` : "nothing is"} free`

  L.push(`# The *Hamlet*, week ${t.week}`, "")
  // C84: the estate's tally under the headline, from the same figures as the opening line
  estateTally = { won: t.quests_won, done: t.quests_done, roster: t.heroes.length, cap: t.rosterCap, gold }
  L.push(`You are back, and the estate stands. ${t.heroes.length} names on the roster, ${coin(gold)} in the coffers, ${t.quests_won} of ${t.quests_done} expeditions won. I have gone through the ledgers and walked the streets; here is what I would do before the coach leaves again, in the order I would do it: the estate, who stays, who rests, then the road, the training and the provisions last. Where a number is only my own habit, I say so.`, "")
  L.push("```board-idea")
  // the road chosen (his pick, or my lean) is named the same way at the top, in the readiness and in the provisions
  const roadName = chosen ? `${chosen.quest.dungeonName}, ${(LENGTH[chosen.quest.length] ?? "").toLowerCase()} (${chosen.quest.goal})` : ""
  L.push(`headline: ${y(chosen ? `Next: the ${roadName},\nwith ${chosen.seats.map((s) => s.hero.name).join(", ")}.` : "Rest first.\nNo four are fit to go.")}`)
  L.push(`detail: ${y(a.afflicted.length ? `${a.afflicted.map((h) => h.name).join(" and ")} cannot be trusted in the dark until the Abbey or the Tavern has had them.` : "Nobody is afflicted. Spend on the party first, the estate second.")}`)
  L.push("```", "")

  // C37: the coach is back. What the road did to the four, then the bridge to this week's plan
  if (t.back) {
    const b = t.back, here = (g: number) => t.heroes.find((h) => h.guid === g)
    const fell = b.heroes.filter((h) => h.died), home = b.heroes.filter((h) => !h.died).map((h) => here(h.guid)).filter((h): h is HeroView => !!h)
    const road = `the ${b.dungeonName}, ${(LENGTH[b.length] ?? "").toLowerCase()}${b.goal ? ` (${b.goal})` : ""}`.replace(/\s+/g, " ")
    L.push("## The coach is back {wide}", "")
    L.push(`${b.success ? `They came back from ${road}, with the work done.` : `They came back from ${road}, without the work done.`} ${fell.length ? `${fell.map((h) => h.name).join(" and ")} did not come back.` : "All four came back."} Here is what the road did to them, and what it changes for the week ahead.`, "")
    // #3: the road and the four that left, against what I proposed and what was picked
    const went = sentAgainst(b, opts.sent, (g) => [...t.heroes, ...t.fallen].find((h) => h.guid === g)?.name ?? "")
    if (went) L.push(went, "")
    // C40: the survivors' tale, from the chronicle kept on the road; C41: what went well, what went wrong
    const tale = opts.tale
    if (tale && tale.snaps > 1) {
      // C102: the road in a few lines, then what it taught; the step-by-step stays in the chronicle (Soushi, 2026-10-13: "This whole
      // section is too verbose. Should be less mechanical.")
      const battles = tale.beats.filter((x) => x.kind === "battle").length
      const worst = tale.beats.filter((x) => x.kind === "deathsdoor" || x.kind === "fell" || x.kind === "affliction").map((x) => x.text)
      const close = tale.beats.find((x) => x.kind === "close")?.text
      const said = [`${battles} battle${battles === 1 ? "" : "s"} won`, worst.length ? `at the worst, ${[...new Set(worst)].slice(0, 3).join("; ")}` : "", close ?? ""].filter(Boolean)
      L.push(`**What happened.** ${said.join("; ").replace(/^./, (c) => c.toUpperCase())}.`, "")
      const notes = [...(tale.taught ?? []).map((x) => ({ x, kind: "idea" })), ...tale.wrong.map((x) => ({ x, kind: "gotcha" })), ...tale.well.map((x) => ({ x, kind: "works" }))]
      if (notes.length) {
        L.push(`**What the road taught me.** I keep it for the next road to the ${b.dungeonName}, at this danger or worse.`, "", "```board-stickies")
        for (const n of notes) L.push(`- title: ${y(n.x)}`, `  kind: ${n.kind}`)
        L.push("```", "")
      }
      const loot = Object.entries(tale.debrief?.loot ?? {})
      if (loot.length) L.push(`**What came home.** ${loot.map(([k, n]) => `${n.toLocaleString("en-US")} ${k}`).join(", ")}.`, "")
    } else L.push("Nobody kept the story of this road as it happened: I only know how it ended.", "")
    L.push("```board-stickies")
    for (const h of fell) L.push(`- title: ${y(`${h.name} fell in the ${b.dungeonName}`)}`, "  kind: gotcha", `  body: ${y(`${t.fallen.find((x) => x.guid === h.guid)?.clsName ?? "One of yours"}. The roster is one name shorter.`)}`)
    for (const h of b.heroes.filter((h) => !h.died && !here(h.guid))) L.push(`- title: ${y(`${h.name} is no longer on the roster`)}`, "  kind: model", `  body: ${y("They came home, and have since been let go.")}`)
    for (const h of home) {
      const marks = [h.affliction ? `afflicted (${h.affliction})` : "", h.quirks.filter((q) => q.disease).map((q) => `ill (${q.name})`).join(", "), `${h.stress} stress`].filter(Boolean)
      L.push(`- title: ${y(`${h.name} is home`)}`, `  kind: ${h.affliction || h.stress >= RULE.restAbove ? "gotcha" : "works"}`, `  body: ${y(`${h.clsName}, level ${h.level}: ${marks.join(", ")}.`)}`)
    }
    L.push("```", "")
    L.push(GAUGE, "", ...stressBars(home))
    // the bridge: who the road has taken out of this week's plan, what was lost, and where that leaves the next coach
    const resting = home.filter((h) => h.affliction || h.stress >= RULE.restAbove || h.quirks.some((q) => q.disease)).map((h) => h.name)
    const lostHeal = fell.filter((h) => a.lostHealers.includes(h.name))
    const bridge = [
      resting.length ? `${resting.join(", ")} ${resting.length === 1 ? "needs" : "need"} the Abbey, the Tavern or the Sanitarium before the dark again, so they stay out of this week's four.` : "Nobody who went needs to sit out this week.",
      lostHeal.length ? `With ${lostHeal.map((h) => h.name).join(" and ")} gone, ${a.healers.length ? `the healers left on the roster are ${a.healers.map((x) => { const h = t.heroes.find((z) => z.name === x.name), going = chosen?.seats.some((s) => s.hero.name === x.name), why = !h || going ? "" : h.busy ? `in the ${h.busy} this week` : h.affliction ? `afflicted` : h.quirks.some((q) => q.disease) ? "ill" : h.stress >= RULE.sendBelow ? `${h.stress} stress, too worn to send` : ""; return `${x.name} (${x.skill}, about ${x.avg} a cast${going ? ", and going" : why ? `; ${why}` : ""})` }).join(", ")}.` : "nobody left on the roster has a true heal: I would look to the coach for one."}` : "",
      chosen ? `So this week I would send ${chosen.seats.map((s) => s.hero.name).join(", ")} to the ${chosen.quest.dungeonName}${chosen.healer ? `, with ${chosen.heal!.by} to heal` : chosen.heal ? `, without a healer (${chosen.heal.by}'s ${chosen.heal.skill} mends too little to count)` : ", without a healer"}; the reasons are below, in the order the week is played.` : "So this week nobody is fit for the road: rest them first.",
    ].filter(Boolean)
    L.push(bridge.join(" "), "")
  }

  // C20: this week's town event, in the game's own words, and what it changes for my advice
  if (t.event) {
    const ev = t.event, bonus = t.recruits.filter((r) => r.from)
    L.push(`## This week in the Hamlet: ${ev.title} {wide}`, "")
    L.push(`${ev.description}`, "")
    const notes = [...ev.lines]
    if (bonus.length) notes.push(`${bonus.map((r) => `${r.name}, a ${r.clsName},`).join(" and ").replace(/,$/, "")}${bonus.length === 1 ? "," : ""} came with it and wait${bonus.length === 1 ? "s" : ""} at the coach; I weigh ${bonus.length === 1 ? "them" : "each"} under Who stays, who goes.`)
    if (t.activities.some((a) => a.locked || a.cost !== a.baseCost)) notes.push("The prices and closed doors below are this week's, not the usual ones.")
    if (ev.provisions.length) notes.push("I have counted the Provisioner's change into the road below.")
    if (notes.length) {
      L.push("```board-stickies")
      for (const n of notes) L.push(`- title: ${y(n)}`, "  kind: idea")
      L.push("```", "")
    }
  }

  // C28: how ready the party is, by my conditions; it rises as the Hamlet prepares. Never presented as odds
  if (chosen) {
    const r = readiness(t, chosen, reserve)
    L.push(`## How ready they are for the ${roadName}: ${r.met} of ${r.of} {wide}`, "")
    L.push(`${r.verdict} This is my reckoning of what is ready for the road to the ${chosen.quest.dungeonName}, not a promise about the dark: rest them, cure them, buy what they need, and it rises.`, "")
    L.push("```board-tally", `- n: ${r.pct}`, `  label: ${y("% of my conditions met")}`, `  pct: ${r.pct}`, "```", "")
    L.push("| | Condition | Now |", "|---|---|---|")
    for (const c of r.checks) L.push(`| ${c.met ? "Ready" : "**Not yet**"} | ${c.label} | ${c.why} |`)
    L.push("")
  }

  // C26: what the saves show was done this week, sent from the board or not
  if (opts.soFar?.length) {
    L.push("## This week so far {wide}", "")
    L.push("What I have seen done in the Hamlet since the week began; my advice below is drawn from how things stand now.", "")
    L.push("```board-stickies")
    for (const n of opts.soFar) L.push(`- title: ${y(n)}`, "  kind: works")
    L.push("```", "")
  }

  // C18: the picks sent this week against what the save shows. Stickies, not cards, so card numbers never move.
  const checks = opts.checks ?? []
  if (checks.length) {
    const n = (s: string) => checks.filter((c) => c.status === s).length
    L.push("## Did you do what you chose? {wide}", "")
    L.push(`What you told me this week, and what I have seen with my own eyes since: ${n("done")} done, ${n("pending")} not yet, ${n("contrary")} otherwise than you said. Of the road and who takes it, I will know only once the coach has left.`, "")
    L.push("```board-stickies")
    const kind = { done: "works", pending: "model", contrary: "risk" } as const
    const word = { done: "Done", pending: "Not yet", contrary: "Not as chosen" } as const
    for (const c of checks) L.push(`- title: ${y(`${word[c.status]}: ${c.question}`)}`, `  kind: ${kind[c.status]}`, `  body: ${y(`You told me: ${c.pick}. ${c.seen}.`)}`)
    L.push("```", "")
  }

  // the estate at a glance
  L.push("## The estate's coffers {wide}", "")
  L.push("What the estate holds tonight, and how many the roster can bear.", "")
  L.push("```board-tally")
  const tally: [number, string, number][] = [
    [gold, "gold", 0], [t.wallet.crest ?? 0, "crests", 0], [t.wallet.bust ?? 0, "busts", 0], [t.wallet.portrait ?? 0, "portraits", 0], [t.wallet.deed ?? 0, "deeds", 0],
    [t.rosterSize, `heroes of ${t.rosterCap}`, Math.round((t.rosterSize / Math.max(1, t.rosterCap)) * 100)],
  ]
  for (const [n, label, pct] of tally) L.push(`- n: ${n}`, `  label: ${y(label)}`, `  pct: ${pct}`)
  L.push("```", "")
  if (chosen) {
    L.push("```board-stickies")
    if (gold >= reserve) L.push(`- title: ${y(`${coin(reserve)} kept for the road to the ${chosen.quest.dungeonName}`)}`, "  kind: works", `  body: ${y(`Food, torches and the rest, at the Provisioner's prices. ${coin(gold - reserve)} is free to spend; every lean below stays within it.`)}`)
    else L.push(`- title: ${y(`The coffers cannot pay for the road: ${coin(reserve - gold)} short`)}`, "  kind: risk", `  body: ${y(`The road to the ${chosen.quest.dungeonName} wants ${coin(reserve)} of provisions and you have ${coin(gold)}. Spend nothing else this week and buy food and torches first.${chosen.quest.length > 1 ? " A shorter road is wiser than a hungry one." : ""}`)}`)
    L.push("```", "")
  }

  // the expedition: built here, shown after the roster and the rest by inActingOrder (C31); picks follow their question,
  // not their card number, so moving the cards no longer slides a pick (C18)
  L.push("## The next expedition {wide}", "")
  // C91: the order I choose by, so every lean below can be read against it
  L.push(`**My order (my habit), highest first; a lower one never outweighs a higher:** ${DOCTRINE.map((d, i) => `${i + 1}. ${d}`).join("; ")}.`, "")
  L.push(`The roads the estate can send you down this week. I name only the foes your heroes have fought, in places they have walked; of the rest I say nothing. ${opts.foresight ? "Travellers' tales do reach me, though, and where I repeat one I say so." : ""}`.trim(), "")
  if (a.parties.length) {
    L.push("```board-decisions")
    const twins = [...new Set(a.parties.map((p) => p.quest.dungeon))].filter((d) => a.parties.filter((p) => p.quest.dungeon === d).length > 1)
    const twinNote = twins.map((d) => { const ps = a.parties.filter((p) => p.quest.dungeon === d); return ` ${ps.length} roads go to the ${ps[0]!.quest.dungeonName}: ${ps.map((p) => `the ${(LENGTH[p.quest.length] ?? "").toLowerCase()} road to ${p.quest.goal} pays ${p.quest.rewards[p.quest.rewards.length - 1]}`).join(", ")}.` }).join("")
    // C42: a road harder than any in the ledger is untried; the provisions carry a margin for it
    const hard = a.parties.filter((p) => untried(t.ledger ?? [], p.quest, t.trips)).map((p) => questLabel(p).split(":")[0])
    const untriedNote = hard.length ? ` No road of mine yet has been as dangerous as ${hard.join(", ")}: my habits are untried there, so I carry a margin of light and food.` : ""
    L.push(`- q: "Which expedition next?"`, `  context: ${y(`${twinNote.trim()}${untriedNote}${twinNote || untriedNote ? " " : ""}Your heroes able to go now (under ${RULE.sendBelow} stress, not afflicted, not ill, not in a building): ${a.ready.map((h) => h.name).join(", ")}.`)}`, "  options:")
    for (const p of a.parties) {
      const q = p.quest
      const foes = q.walked ? (q.known.length ? `foes you know: ${q.known.slice(0, 6).join(", ")}${q.known.length > 6 ? ` and ${q.known.length - 6} more` : ""}; ${q.unknownCount} kind${q.unknownCount === 1 ? "" : "s"} you have not met` : `${q.unknownCount} kind${q.unknownCount === 1 ? "" : "s"} of foe you have not met`) : "you have never walked it; I will not speak of what lives there"
      // foresight speaks only about the expedition being prepared (C7)
      const rumour = opts.foresight && p === chosen && q.unknownCount ? ` Foresight: travellers speak of ${q.unknownTypes.length ? q.unknownTypes.join(" and ") + " things" : "things I cannot name"} there that you have not met.` : ""
      L.push(`    - pick: ${y(questLabel(p))}`, `      effect: ${y(`${DIFFICULTY[q.difficulty] ?? `level ${q.difficulty}`}; rewards ${q.rewards.join(", ")}; ${foes}.${rumour}`)}`)
    }
    const leanIdx = chosen ? a.parties.indexOf(chosen) : 0
    // only said of a short road chosen over longer ones that a green party would have taken
    const longer = chosen?.quest.length === 1 ? a.parties.filter((p) => p !== chosen && p.quest.length > 1 && p.green).length : 0
    L.push(`  lean: ${Math.max(0, leanIdx)}`, `  lean_why: ${y(`the four I would send fit it best: ${chosen ? chosen.seats.flatMap((s) => s.notes).join(", ") || "ranks and skills line up" : ""}${chosen && learners(chosen) ? `; it takes ${chosen.seats.filter((x) => x.hero.level === 0).slice(0, RULE.learners).map((x) => x.hero.name).join(" and ")} along to learn (my order: newcomers ride on short roads)` : ""}${chosen?.left !== undefined ? `; it leaves ${coin(Math.max(0, chosen.left))} in the coffers after the road` : ""}${longer ? "; with so many of them untried, I keep them to shorter roads" : ""} (my habits).`)}`)
    if (chosen) {
      L.push(`- q: ${y(`Take this party to the ${chosen.quest.dungeonName}?`)}`)
      L.push(`  context: ${y(`${opts.own ? "The four you named, seated as you gave them. " : ""}Front to back: ${chosen.seats.map((s) => `${s.rank}. ${s.hero.name} (${s.hero.clsName}, ${s.hero.stress} stress)`).join("; ")}. ${chosen.healer ? `A healer is in it: ${chosen.heal!.by}'s ${chosen.heal!.skill}, about ${chosen.heal!.avg} hit points a cast.` : chosen.heal ? `No true healer: only ${chosen.heal.by}'s ${chosen.heal.skill}, about ${chosen.heal.avg} hit points a cast.` : "No healer in it."} ${chosen.stunner ? "So is a stun." : "No stun."}${chosen.reach ? ` From these seats they can strike ${chosen.reach.length === 4 ? "every rank of the enemy line" : `enemy rank${chosen.reach.length === 1 ? "" : "s"} ${chosen.reach.join(", ")}, and none of them the ${[1, 2, 3, 4].filter((e) => !chosen.reach!.includes(e)).join(" or ")}`}.` : ""}${chosen.pair ? ` ${chosen.pair.marker === chosen.pair.striker ? `${chosen.pair.marker} marks a foe with ${chosen.pair.mark} and strikes the marked harder with ${chosen.pair.strike}.` : `${chosen.pair.marker} marks a foe with ${chosen.pair.mark}, and ${chosen.pair.striker}'s ${chosen.pair.strike} strikes the marked harder.`}` : ""}${mixWords(chosen, t)}`)}`, "  options:")
      L.push(`    - pick: "Yes, this four"`, `      effect: ${y("Embark with them in this order; each one's equipped skills reach from their rank.")}`)
      L.push(`    - pick: "No, I choose my own"`, `      effect: ${y("Write your four in the note below, front to back, and send them to me; I will look them over before the coach leaves.")}`)
      L.push(`  lean: 0`, `  lean_why: ${y("of those fit to go, they stand best where I would place them, by my reckoning of what each can do from there.")}`)
    }
    L.push("```", "")
  }
  if (chosen) {
    L.push("```board-stickies")
    // as the party stands in the game: rank 4 at the left, rank 1 at the front on the right (Soushi, 2026-10-10). One
    // colour for all four, because the board groups stickies by colour and would break the order otherwise
    faces = new Map(chosen.seats.map((s) => [s.hero.name, portrait(s.hero)]))
    for (const s of [...chosen.seats].reverse()) {
      L.push(`- title: ${y(`Rank ${s.rank}: ${s.hero.name}${s.notes.some((n) => n.startsWith("−")) ? " (mind the quirk)" : ""}`)}`, "  kind: works")
      L.push(`  body: ${y(`${s.hero.clsName}, level ${s.hero.level}, ${s.hero.stress} stress. Skills that reach from here: ${s.skills.join(", ")}.${s.swaps?.length ? ` Before the coach leaves, equip ${s.swaps.map((w) => `${w.equip}${w.for ? ` in place of ${w.for}` : ""}`).join(", and ")}.` : ""}${s.learn ? ` Worth learning at the Guild for this seat: ${s.learn.skill}, ${coin(Math.round(s.learn.gold * (1 - t.skillDiscount)))}.` : ""}${s.notes.length ? ` Quirks that matter here: ${s.notes.join(", ")}.` : ""}`)}`)
    }
    for (const n of chosen.notes) L.push(`- title: ${y("Mind this")}`, "  kind: risk", `  body: ${y(n)}`)
    L.push("```", "")
    L.push(...stressBars(chosen.seats.map((x) => x.hero)))
  }

  // relief
  L.push("## Who rests, who prays {wide}", "")
  L.push(`The ones the dark has worn down, where the Abbey and the Tavern can take them as the estate has built them up, and the places their own habits forbid them. My habit: anyone at ${RULE.restAbove} stress or more rests before going out again. ${GAUGE}`, "")
  L.push(...stressBars([...t.heroes].filter((h) => h.stress > 0).sort((x, y) => y.stress - x.stress)))
  // each card is filed under the building I lean it to, so the section reads building by building (Soushi, 2026-10-11:
  // "organise this section by building you suggest"); a card leaned to wait is filed last
  const cards: string[] = [], filed: { at: number; place: string }[] = []
  // each lean takes its seat, so no two cards lean to the same last seat (U11)
  const seatsLeft = new Map(t.activities.map((x) => [x.activity, x.slots - x.used]))
  const reliefUsed: string[] = [] // C97: the relief activities leaned this week, for the heirlooms to improve
  for (const r of a.relief) {
    if (!r.options.length) continue
    const at = cards.length
    cards.push(`- q: ${y(`Where does ${r.hero.name} go?`)}`, `  image: ${y(portrait(r.hero))}`)
    cards.push(`  context: ${y(`${r.hero.name}, ${r.hero.clsName} level ${r.hero.level}: ${r.why.join(", ")}.`)}`, "  options:")
    for (const o of r.options) cards.push(`    - pick: ${y(o.activity.name)}`, `      effect: ${y(`${o.note}${r.hero.affliction ? `; ${Math.round(o.activity.cure * 100)}% chance to cure the affliction` : ""}.`)}`)
    cards.push(`    - pick: "Leave them be"`, `      effect: ${y("Free; they stay at their stress and wait for next week.")}`)
    if (a.dismiss.some((d) => d.hero.guid === r.hero.guid)) {
      cards.push(`  lean: ${r.options.length}`, `  lean_why: ${y("I would rather let them go than pay for their rest; see Who stays, who goes.")}`)
    } else {
      // C90: a hero already placed this week has been paid for out of the coffers: lean where they are, and charge nothing again
      const paid = opts.placed?.get(r.hero.guid)
      const best = (paid ? r.options.find((o) => o.activity.name === paid) : undefined) ?? r.options.find((o) => o.activity.cost <= left && (seatsLeft.get(o.activity.activity) ?? 0) > 0)
      const taken = r.options.filter((o) => o.activity.cost <= left && !((seatsLeft.get(o.activity.activity) ?? 0) > 0))
      if (best) {
        if (best.activity.name !== paid) left -= best.activity.cost
        reliefUsed.push(best.activity.name)
        seatsLeft.set(best.activity.activity, (seatsLeft.get(best.activity.activity) ?? 1) - 1)
        cards.push(`  lean: ${r.options.indexOf(best)}`, `  lean_why: ${y(best.activity.name === paid ? `already there this week, and paid for: the ${paid} keeps them.` : `the cheapest place they accept that has a free seat (${best.note}).`)}`)
      } else if (taken.length) cards.push(`  lean: ${r.options.length}`, `  lean_why: ${y(`the seats they could take (${taken.map((o) => o.activity.name).join(", ")}) I have already leaned to someone above.`)}`)
      else cards.push(`  lean: ${r.options.length}`, `  lean_why: ${y(`${firstRoad}.`)}`)
    }
    const leaned = !a.dismiss.some((d) => d.hero.guid === r.hero.guid) && r.options.find((o) => o.activity.cost <= left + o.activity.cost && cards.slice(at).some((l) => l === `  lean: ${r.options.indexOf(o)}`))
    filed.push({ at, place: leaned ? leaned.activity.buildingName : "" })
  }
  const ward = t.activities.find((x) => x.activity === "disease_treatment")
  let beds = ward ? ward.slots - ward.used : 0
  // the ward's free beds go to the most experienced first; the rest wait
  // C86: an ill true healer takes the Medical Ward's first bed
  for (const h of [...a.disease].sort((x, z) => Number(a.trueHealer.has(z.guid)) - Number(a.trueHealer.has(x.guid)) || z.level - x.level || z.xp - x.xp)) {
    if (!ward) continue
    const at = cards.length
    // C89: a hero I seat in this week's four goes on the road, not to the ward
    const going = !!chosen?.seats.some((x) => x.hero.guid === h.guid)
    const gets = !going && beds > 0
    if (gets) beds--
    const ill = h.quirks.filter((q) => q.disease).map((q) => q.name).join(", ")
    cards.push(`- q: ${y(`Treat ${h.name}'s ${ill}?`)}`, `  image: ${y(portrait(h))}`)
    cards.push(`  context: ${y(`${h.name}, ${h.clsName} level ${h.level}, carries ${ill}. The Medical Ward has ${ward.slots} bed${ward.slots === 1 ? "" : "s"} as the Sanitarium stands, ${ward.slots - ward.used} free this week, for ${a.disease.length} ill.`)}`, "  options:")
    cards.push(`    - pick: "Medical Ward"`, `      effect: ${y(`${coin(ward.cost)}; the disease is treated before the next expedition.`)}`)
    cards.push(`    - pick: "Not this week"`, `      effect: ${y("The disease stays; keep them out of the party.")}`)
    const purse = ward.cost <= left || opts.placed?.get(h.guid) === ward.name
    const lean = !going && gets && h.level >= 1 && purse ? 0 : 1
    if (lean === 0 && opts.placed?.get(h.guid) !== ward.name) left -= ward.cost
    cards.push(`  lean: ${lean}`, `  lean_why: ${y(opts.placed?.get(h.guid) === ward.name ? `already there this week, and paid for: the ${ward.name} keeps them.` : going ? `${h.name} goes on the road this week: ${ill} bites only at the campfire, and this road lights none. The ward can wait for a week at home.` : !gets ? "the bed goes to a more experienced hero this week." : h.level < 1 ? "a level 0 hero is cheaper to replace than to cure." : !purse ? `${firstRoad}.` : "a hero with experience is worth the bed.")}`)
    filed.push({ at, place: lean === 0 ? ward.buildingName : "" })
  }
  // the Treatment Ward (C25): one quirk per hero, by my habit; seats to the party first, then the most experienced
  const tw = t.activities.find((x) => x.activity === "treatment")
  let seats = tw ? tw.slots - tw.used : 0
  const waiting: typeof a.treat = []
  for (const tr of a.treat) {
    if (!tw) break
    // a card only for a seat that is free; the rest wait in line on one note below
    if (seats <= 0) { waiting.push(tr); continue }
    const gets = seats > 0
    if (gets) seats--
    const purse = tr.cost <= left || opts.placed?.get(tr.hero.guid) === tw.name
    // a hero in the ward cannot board the coach: never lean on treating one of the four I would send (Soushi, 2026-10-10)
    const lean = gets && purse && !tr.inParty ? 0 : 1
    if (lean === 0 && opts.placed?.get(tr.hero.guid) !== tw.name) left -= tr.cost
    filed.push({ at: cards.length, place: lean === 0 ? tw.buildingName : "" })
    cards.push(`- q: ${y(`Treat ${tr.hero.name}'s ${tr.quirk.name}?`)}`, `  image: ${y(portrait(tr.hero))}`)
    cards.push(`  context: ${y(`${tr.hero.name}, ${tr.hero.clsName} level ${tr.hero.level}${tr.inParty ? ", in the party I would send" : ""}. ${tr.quirk.name}${tr.quirk.description ? `: ${tr.quirk.description}` : "."}${tr.quirk.locked ? " It has set in, and the ward asks more for it." : ""} The ${tw.name} has ${tw.slots} seat${tw.slots === 1 ? "" : "s"}, ${tw.slots - tw.used} free this week.`)}`, "  options:")
    cards.push(`    - pick: ${y(tw.name)}`, `      effect: ${y(`${tr.cost ? coin(tr.cost) : "free this week"}; the ward works on ${tr.quirk.name}, and ${tr.hero.name} stays in the Hamlet while it does.`)}`)
    cards.push(`    - pick: "Not this week"`, `      effect: ${y(`${tr.hero.name} keeps it for now.`)}`)
    cards.push(`  lean: ${lean}`, `  lean_why: ${y(opts.placed?.get(tr.hero.guid) === tw.name ? `already there this week, and paid for: the ${tw.name} keeps them.` : tr.inParty ? `${tr.hero.name} rides with the party I would send, and a hero in the ward cannot board the coach; treat it in a week they stay home.` : !gets ? "the seat goes to someone the road needs more." : !purse ? `${firstRoad}.` : `${tr.why}.`)}`)
  }
  const stuck = a.relief.filter((r) => !r.options.length)
  if (cards.length) {
    const spans = filed.sort((x, z) => x.at - z.at).map((f, k, all) => ({ place: f.place, lines: cards.slice(f.at, all[k + 1]?.at ?? cards.length) }))
    const places = [...new Set(spans.map((x) => x.place).filter(Boolean)), ""]
    for (const place of places) {
      const lines = spans.filter((x) => x.place === place).flatMap((x) => x.lines)
      if (!lines.length) continue
      L.push(`### ${place || "Waiting this week"}`, "", "```board-decisions", ...lines, "```", "")
    }
  }
  if (waiting.length && tw) {
    const inWard = t.heroes.filter((h) => h.busy === tw.name).map((h) => h.name)
    L.push("```board-stickies")
    L.push(`- title: ${y(`The ${tw.name} is full this week${inWard.length ? ` (${inWard.join(", ")})` : ""}`)}`, "  kind: model", `  body: ${y(`Next in line, by my habit: ${waiting.map((w) => `${w.hero.name}'s ${w.quirk.name} (${w.why}${w.quirk.locked ? "; it has set in" : ""})`).join("; ")}.`)}`)
    L.push("```", "")
  }
  if (stuck.length) {
    L.push("```board-stickies")
    for (const r of stuck) L.push(`- title: ${y(`${r.hero.name} waits`)}`, "  kind: gotcha", `  body: ${y(`${r.why.join("; ")}. ${r.hero.quirks.filter((q) => q.description && /only|not allowed|won't|will not/i.test(q.description)).map((q) => `${q.name}: ${q.description}`).join(" ")}`)}`)
    L.push("```", "")
  }

  // provisions for the chosen expedition
  if (chosen) {
    const q = chosen.quest
    const len = Math.max(1, Math.min(3, q.length))
    L.push(`## Provisions for the ${roadName} {wide}`, "")
    L.push(`What to buy at the Provisioner for the ${q.dungeonName}. The counts are my habit for a ${LENGTH[len]?.toLowerCase()} expedition, nothing more; I ask for bandages and antivenom only where foes you know there have already bled or poisoned you.`, "")
    // one table, not a sticky per item (Soushi, 2026-10-10): what to buy, how many, at what price
    L.push("| Buy | How many (my habit) | Each | Cost | Why |", "|---|---|---|---|---|")
    for (const i of roadItems) {
      const why = i.id === "bandage" ? `known there to bleed you: ${q.bleeders.join(", ")}` : i.id === "antivenom" ? `known there to poison you: ${q.blighters.join(", ")}` : (t.supply[i.id] ?? "").replace(/\|/g, "/")
      L.push(`| ${i.label} | ${i.count} | ${coin(i.price)} | ${coin(i.count * i.price)} | ${i.why ? `${why}${why ? " " : ""}**What I learnt:** ${i.why.replace(/\|/g, "/")}` : why} |`)
    }
    L.push(`| **In all** | | | **${coin(reserve)}** | ${gold >= reserve ? `set aside in the coffers; ${coin(gold - reserve)} left over` : `you have ${coin(gold)}: buy food and torches first`} |`, "")
    const notes = (t.event?.provisions ?? []).map((pv) => `${pv.item === "provision" ? "Food" : "Torches, shovels and the rest"} ${pv.cost ? `cost ${pv.cost <= -1 ? "nothing" : `${Math.round(-pv.cost * 100)}% less`}` : `come in ${Math.round(-pv.amount * 100)}% smaller lots`} this week, for the ${t.event!.title}.`)
    // firewood's price in the item list is 0: it is taken, not bought. The count the camp needs is the game's to show
    if (q.length >= 2) notes.push(`This road has a camp: take firewood from the Provisioner before you leave; it costs ${coin(opts.prices?.get("firewood") ?? 0)}.`)
    if (notes.length) L.push(notes.join(" "), "")
    // C79: the pack's slots, from the game's files; the buy list against what stays free for what they find
    if (opts.pack?.slots) {
      // a road with a camp also packs its firewood (the note above), one stack of its own
      const buy = asPack({ ...Object.fromEntries(roadItems.map((i) => [i.id, i.count])), ...(q.length >= 2 ? { firewood: 1 } : {}) }), used = slotsOf(buy, opts.pack), free = opts.pack.slots - used
      const cut = free < RULE.packFree ? trims(buy, opts.pack) : []
      L.push(`**The packs.** This takes ${used} of the pack's ${opts.pack.slots} slots and leaves ${free} free for what they find. ${free >= RULE.packFree ? `That is room enough (my habit: at least ${RULE.packFree}).` : `I like at least ${RULE.packFree} free (my habit). ${cut.length ? `To free a slot, leave behind ${cut.map((c) => `${c.n} ${c.key === "food" ? "food" : c.key.replace(/_/g, " ")}`).join(", or ")}.` : "Every stack is full, so each slot freed costs a whole stack."}`}`, "")
    }
  }

  // guild and blacksmith
  L.push("## The Guild and the Blacksmith {wide}", "")
  L.push(`What the trainers and the smith can teach the party next, and at what price: the Guild knocks ${Math.round(t.skillDiscount * 100)}% off its lessons and the Blacksmith ${Math.round(t.gearDiscount * 100)}% off his work, for what the estate has already paid them.`, "")
  // C78: the upkeep of the four who leave, one plan per hero, from the gold the road leaves free (Soushi, 06:42: "ensure the heroes
  // that go in expedition are well upgraded so we take the opportunity each time to maintain and upgrade the roster")
  if (chosen) {
    const seated = new Map(chosen.seats.map((s) => [s.hero.name, s]))
    const items: UpItem[] = t.heroUpgrades.filter((u) => seated.has(u.hero ?? "")).map((u) => {
      const kind = /\.weapon$/.test(u.tree) ? "weapon" : /\.armour$/.test(u.tree) ? "armour" : "skill", s = seated.get(u.hero!)!
      return { hero: u.hero!, what: `${u.label} to level ${u.toLevel}`, kind, gold: u.cost.find((c) => c.type === "gold")?.amount ?? 0,
        heal: kind === "skill" && /medicine|reconstruction|grace|comfort|heal/i.test(u.label), used: kind !== "skill" || (s.carry ?? s.skills).some((k) => k.toLowerCase() === u.label.toLowerCase()),
        ...(u.blockedBy ? { blockedBy: inWords(u.blockedBy) } : {}) } as UpItem
    })
    // the camping skill most worth learning for each, by the same habit as the Survivalist's card (C47)
    if (opts.camp) for (const s of chosen.seats) {
      const known = s.hero.campKnown ?? s.hero.campEquipped ?? []
      const k = [...opts.camp.values()].filter((x) => x.classes.includes(s.hero.cls) && !known.includes(x.id) && x.gold > 0).sort((x, z) => campWorth(z, RULE) - campWorth(x, RULE) || x.gold - z.gold)[0]
      if (k) items.push({ hero: s.hero.name, what: `${k.name} at the Survivalist`, kind: "camp", gold: Math.round(k.gold * (1 - t.campDiscount)) })
    }
    const plan = upkeep(items, left, { camps: chosen.quest.length >= 2, dismiss: new Map(a.dismiss.map((d) => [d.hero.name, d.why])) })
    L.push(`**Before the coach leaves, the four's upkeep (my habit).** ${gold < reserve ? `The road's provisions cost ${coin(reserve)} and the coffers hold ${coin(gold)}: the road itself is ${coin(reserve - gold)} short, so nothing is free for the rest.` : `${coin(left)} is free once the road's provisions are kept back.`} ${gold < reserve ? "When gold is free, I spend it" : "I would spend it"} in this order: healing, then the weapon and the armour, then the other skills they carry from their seats, then a camping skill if the road camps. That spends ${coin(plan.spent)} and leaves ${coin(plan.left)}. A skill they do not carry from their seat is not worth the gold this week, and a hero I would dismiss gets nothing.`, "")
    // one colour for all four, so the board keeps them in seat order (it groups stickies by colour)
    L.push("```board-stickies")
    for (const s of chosen.seats) {
      const mine = plan.lines.filter((l) => l.item.hero === s.hero.name)
      if (!mine.length) continue
      L.push(`- title: ${y(`${s.hero.name}'s upkeep`)}`, "  kind: model", `  body: ${y(`${mine.map((l) => upkeepWords(l, coin)).join("; ")}.`.replace(/^./, (c) => c.toUpperCase()))}`)
    }
    L.push("```", "")
  }
  if (a.buys.length) {
    L.push("```board-decisions")
    const preferred = opts.answers.preferred ?? []
    L.push(`- q: "What do we train first?"`, `  context: ${y(`You have ${coin(gold)}. These are the party's upgrades you can afford now, cheapest first.${preferred.length ? ` The skills you prefer: ${preferred.join(", ")}.` : " Name the skills you prefer in a note here and I will train them first."}`)}`, "  options:")
    // the five cheapest lessons, and every piece of the smith's work the coffers can pay for, so an upgrade just opened is never hidden (Soushi, 2026-10-10)
    // and every lesson you named that the coffers can pay for, so a preferred skill is never left off the card (#4)
    const named = (u: (typeof a.buys)[number]) => u.where === "Guild" && (opts.answers.preferred ?? []).some((n) => n.toLowerCase() === u.label.toLowerCase())
    const shown = [...a.buys.filter(named), ...a.buys.filter((u) => u.where !== "Blacksmith" && !named(u)).slice(0, 5), ...a.buys.filter((u) => u.where === "Blacksmith")]
    for (const u of shown) L.push(`    - pick: ${y(u.learn ? `${u.hero}: learn ${u.label}` : `${u.hero}: ${u.label} to level ${u.toLevel}`)}`, `      effect: ${y(`${coin(u.cost.find((c) => c.type === "gold")?.amount ?? 0)} at the Guild${u.learn ? `; a new heal, about ${u.learn.heals} hit points a cast, cast from ${u.hero}'s seat` : ""}.`.replace("at the Guild", `at the ${u.where}`))}`)
    L.push(`    - pick: "Keep the gold"`, `      effect: ${y("Spend nothing at the Guild or the Blacksmith this week.")}`)
    const price = (u: (typeof shown)[number]) => u.cost.find((c) => c.type === "gold")?.amount ?? 0
    // a skill you named comes first, then healing, then the cheapest step (#4)
    const liked = shown.findIndex((u) => u.where === "Guild" && price(u) <= left && preferred.some((n) => n.toLowerCase() === u.label.toLowerCase()))
    left += healHeld
    const heal = [shown.findIndex((u) => !!u.learn && price(u) <= left), shown.findIndex((u) => /medicine|reconstruction|grace|comfort|heal/i.test(u.label) && price(u) <= left)].find((i) => i >= 0) ?? -1
    const cheap = shown.findIndex((u) => price(u) <= left)
    const pick = liked >= 0 ? liked : heal >= 0 ? heal : cheap
    if (pick >= 0) left -= price(shown[pick]!)
    L.push(`  lean: ${pick >= 0 ? pick : shown.length}`, `  lean_why: ${y(liked >= 0 ? `you prefer ${shown[liked]!.label}, so it comes first (your choice, not my habit).` : heal >= 0 ? "the party's healing is what brings everyone home." : cheap >= 0 ? "the cheapest step for the hero who fights most." : `${firstRoad}.`)}`)
    L.push("```", "")
  }
  if (a.blocked.length) {
    L.push("```board-stickies")
    const byNeed = new Map<string, string[]>()
    for (const u of a.blocked) { const k = u.blockedBy; byNeed.set(k, [...(byNeed.get(k) ?? []), `${u.hero} ${u.label}`]) }
    for (const [need, what] of byNeed) L.push(`- title: ${y(`Waiting on ${inWords(need)}`)}`, "  kind: model", `  body: ${y(`${what.join(", ")}. ${/resolve/.test(need) ? "Resolve is earned on the road, not bought: these open as they come home from more expeditions." : "Buy that building upgrade first, with heirlooms."}`)}`)
    L.push("```", "")
  }

  // C47: the Survivalist, the camping skills of the four going, and what is worth teaching them (Soushi, 2026-10-11: "we unlocked
  // Survivalist, it will be important to include it in the board")
  if (opts.camp && chosen) {
    const camp = opts.camp, off = t.campDiscount, q = chosen.quest
    const tell = campTell
    const worth = (k: CampSkill) => campWorth(k, RULE)
    const price = (k: CampSkill) => Math.round(k.gold * (1 - off))
    const camps = q.length >= 2
    L.push("## The Survivalist {wide}", "")
    L.push(`The Survivalist teaches the skills a hero uses at the campfire, which only a medium or long road gives them the night for. ${off ? `He knocks ${Math.round(off * 100)}% off his lessons for what the estate has paid him.` : ""} ${camps ? `This week's road camps, so what they carry to the fire matters now.` : `This week's road is short and does not camp: what they learn here waits for a longer road.`}`.replace(/\s+/g, " ").trim(), "")
    const best: { hero: HeroView; k: CampSkill }[] = []
    L.push("```board-stickies")
    for (const s of chosen.seats) {
      const h = s.hero, known = h.campKnown ?? [], taken = h.campEquipped ?? []
      const open = [...camp.values()].filter((k) => k.classes.includes(h.cls) && !known.includes(k.id) && k.gold > 0).sort((x, z) => worth(z) - worth(x) || price(x) - price(z))
      if (open[0]) best.push({ hero: h, k: open[0] })
      const line = (id: string) => { const k = camp.get(id); return k ? `${k.name} (${tell(k)})` : id }
      L.push(`- title: ${y(`${h.name}, ${h.clsName}, at the campfire`)}`, "  kind: model",
        `  body: ${y(`Takes to camp: ${taken.map(line).join(", ") || "nothing yet"}.${known.length > taken.length ? ` Also knows: ${known.filter((x) => !taken.includes(x)).map((id) => camp.get(id)?.name ?? id).join(", ")}.` : ""}${open[0] ? ` Worth learning: ${line(open[0].id)}, ${coin(price(open[0]))}.` : " Knows every camping skill the Survivalist can teach them."}`)}`)
    }
    L.push("```", "")
    if (best.length) {
      L.push("```board-decisions", `- q: "What do we teach at the Survivalist?"`, `  context: ${y(`The best lesson for each of the four, by my habit of weighing a camping skill (stress relieved by how many it reaches, health healed, a cure or a guard on the camp, a boon for the next fight). ${camps ? "This road camps." : "This road does not camp."}`)}`, "  options:")
      for (const b of best) L.push(`    - pick: ${y(`${b.hero.name}: ${b.k.name}`)}`, `      effect: ${y(`${coin(price(b.k))} at the Survivalist; ${tell(b.k)}.`)}`)
      L.push(`    - pick: "Keep the gold"`, `      effect: ${y("Teach nothing at the Survivalist this week.")}`)
      const pick = camps ? best.map((b, i) => ({ b, i })).filter(({ b }) => price(b.k) <= left).sort((x, z) => worth(z.b.k) - worth(x.b.k))[0] : undefined
      if (pick) left -= price(pick.b.k)
      L.push(`  lean: ${pick ? pick.i : best.length}`, `  lean_why: ${y(pick ? `the most worth at the fire for this road, within the gold left.` : camps ? `${firstRoad}.` : "this road does not camp; the gold serves better elsewhere this week.")}`, "```", "")
    }
  }

  // roster
  L.push("## Who stays, who goes {wide}", "")
  // C29: recruits share the places the roster has, counting the ones my dismissals would free (Soushi, 2026-10-10)
  const worth = (h: HeroView) => h.quirks.filter((q) => q.positive).length - h.quirks.filter((q) => !q.positive && !q.disease).length
  const byWorth = [...a.recruits].sort((x, z) => worth(z.hero) - worth(x.hero) || z.hero.level - x.hero.level)
  // C43: a recruit who brings what the four lack (a true healer, a stun) comes first, whatever their quirks
  const fill = fills(chosen, byWorth), fillOf = (r: { hero: HeroView }) => fill.get(r.hero.guid)
  const ranked = [...byWorth].sort((x, z) => Number(!!fillOf(z)) - Number(!!fillOf(x)))
  // a full roster still has choices: a recruit clearly better than a level 0 hero outside the party is worth the swap (RULE: by 2 or more)
  const sendingNow = new Set(chosen?.seats.map((x) => x.hero.guid))
  const named = new Set(a.dismiss.map((d) => d.hero.guid))
  // a hero this board sends to the Abbey, the Tavern or the Sanitarium is not one it lets go
  const tended = new Set([...a.relief.map((r) => r.hero.guid), ...a.treat.map((x) => x.hero.guid), ...a.disease.map((h) => h.guid)])
  // C88: a hero who joined this week is never let go for another recruit the same week (Soushi, 2026-10-13: "you just made me recruit him to ask me to dismiss him")
  const weak = t.heroes.filter((h) => h.level === 0 && !h.busy && !sendingNow.has(h.guid) && !named.has(h.guid) && !tended.has(h.guid) && !opts.newcomers?.has(h.guid) && !t.settling?.has(h.guid)).sort((x, z) => worth(x) - worth(z))
  // C88: a recruit of a class the roster already holds is never taken: C85 would set the two against each other
  // except a true healer (C86): two healers are never too alike
  const held = (r: Advice["recruits"][number]) => r.heal ? undefined : t.heroes.find((h) => h.cls === r.hero.cls)
  let free = Math.max(0, t.rosterCap - t.rosterSize) + a.dismiss.length
  const dismiss = [...a.dismiss]
  for (const r of ranked.filter((r) => !held(r) && (fillOf(r) || worth(r.hero) > 0))) {
    if (free > 0) { free--; continue }
    const w = weak.shift()
    if (!w || (!fillOf(r) && worth(r.hero) - worth(w) < 2)) break
    dismiss.push({ hero: w, why: `level 0 with ${w.quirks.filter((q) => !q.positive && !q.disease).length} bad quirks and ${w.quirks.filter((q) => q.positive).length} good; ${fillOf(r) ? `${r.hero.name} at the coach brings the ${fillOf(r)!.gap === "healer" ? "true healer" : "stun"} the four lack` : `${r.hero.name} at the coach would serve you better`}` })
  }
  const places = Math.max(0, t.rosterCap - t.rosterSize) + dismiss.length
  const taken = ranked.filter((r) => !held(r) && (fillOf(r) || worth(r.hero) >= 0)).slice(0, places)
  L.push(`${t.rosterSize} names on the roster, room for ${t.rosterCap} as the Stage Coach stands: ${t.rosterCap - t.rosterSize} place${t.rosterCap - t.rosterSize === 1 ? "" : "s"} free${dismiss.length ? `, ${places} if you let go of the ones I name` : ""}. My habit: a hero still at level 0 with ${RULE.dismissNegatives} or more bad quirks, outside the party, is worth letting go, and the coach's best take the places there are.`, "")
  const rcards: string[] = []
  for (const d of dismiss) {
    rcards.push(`- q: ${y(`Dismiss ${d.hero.name}?`)}`, `  image: ${y(portrait(d.hero))}`, `  context: ${y(`${d.hero.clsName}, ${d.why}.`)}`, "  options:")
    rcards.push(`    - pick: "Dismiss"`, `      effect: ${y("Frees a place on the roster for a fresh recruit.")}`, `    - pick: "Keep"`, `      effect: ${y("They stay; their quirks can be treated at the Sanitarium for gold.")}`)
    rcards.push(`  lean: 0`, `  lean_why: ${y("a recruit costs nothing and comes without these quirks.")}`)
  }
  for (const r of ranked) {
    rcards.push(`- q: ${y(`Recruit ${r.hero.name}, ${r.hero.clsName}?`)}`, `  image: ${y(portrait(r.hero))}`, `  context: ${y(`${r.why}.`)}`, "  options:")
    rcards.push(`    - pick: "Recruit"`, `      effect: ${y(`Joins the roster at level ${r.hero.level}.`)}`, `    - pick: "Pass"`, `      effect: ${y(r.hero.from ? "Leave them at the coach." : "The coach brings others next week.")}`)
    const take = taken.includes(r)
    const why = held(r) ? `the roster already has ${/^[AEIOU]/i.test(r.hero.clsName) ? "an" : "a"} ${r.hero.clsName}, ${held(r)!.name}, and two of a class are what I would let go of` : take && fillOf(r) ? `${fillOf(r)!.text}; there is a place for them` : take ? `${worth(r.hero) > 0 ? "more good quirks than bad" : "as many good quirks as bad"}, and there is a place for them` : worth(r.hero) < 0 ? "more bad quirks than good" : `no place left for them: ${places ? `the ${places === 1 ? "place goes" : `${places} places go`} to ${taken.map((x) => x.hero.name).join(" and ")}` : "the roster is full"}`
    rcards.push(`  lean: ${take ? 0 : 1}`, `  lean_why: ${y(`${why}.`)}`)
  }
  if (rcards.length) L.push("```board-decisions", ...rcards, "```", "")
  // C85: pairs too alike to keep both, and the coach's recruit who would round the roster out (Soushi, 07:15)
  if (a.alike.length) {
    const roleWords = (rs: string[]) => rs.map((r) => ROLE_WORDS[r as keyof typeof ROLE_WORDS]).join(", ")
    L.push("**Too alike (my habit).** Two heroes who do the same work in a fight leave a gap elsewhere. Where the coach brings someone the roster lacks, I would let the weaker of a pair go for them, even at a lower level.", "")
    const an = (w: string) => `${/^[AEIOU]/i.test(w) ? "an" : "a"} ${w}`
    const said = (p: (typeof a.alike)[number]) => `${p.keep.name} and ${p.drop.name} are too alike: ${p.shared}. ${p.why}, so ${p.keep.name} is the one I keep.`
    const swap = a.alike.filter((p) => p.recruit), wait = a.alike.filter((p) => !p.recruit)
    if (swap.length) {
      L.push("```board-decisions")
      for (const p of swap) {
        const r = p.recruit!
        L.push(`- q: ${y(`Let ${p.drop.name} go for ${r.hero.name}?`)}`, `  context: ${y(`${said(p)} ${r.hero.name}, level ${r.hero.level}, ${r.brings.length ? `brings what the roster is short of: ${roleWords(r.brings)}` : `is ${an(r.hero.clsName)}, and the roster has none`}.`)}`, "  options:",
          `    - pick: ${y(`Dismiss ${p.drop.name}, recruit ${r.hero.name}`)}`, `      effect: ${y(`${p.drop.name} leaves the roster and ${r.hero.name} takes the place.`)}`,
          `    - pick: "Keep both"`, `      effect: ${y(`${p.drop.name} stays; the roster keeps two who do the same work.`)}`,
          "  lean: 0", `  lean_why: ${y(`my habit: a roster that does more kinds of work goes further than two of the same, and ${p.drop.name} is the weaker of the pair.`)}`)
      }
      L.push("```", "")
    }
    if (wait.length) {
      L.push("```board-stickies")
      for (const p of wait) L.push(`- title: ${y(`Too alike: ${p.keep.name} and ${p.drop.name}`)}`, "  kind: model", `  body: ${y(`${said(p)} The coach brings nobody this week who does what the roster lacks, so I would keep both until one does.`)}`)
      L.push("```", "")
    }
  }

  // heirlooms and trinkets
  if (a.heirlooms.length || a.trinkets.length) {
    L.push("## Heirlooms and trinkets {wide}", "")
    L.push("What the family's heirlooms could build tonight, and the trinkets in the estate's stores with who may wear them.", "")
    // what the estate holds, as the Hamlet's own bar shows it: the icons are set beside each count when the page is built (U9)
    L.push(`**What the estate holds.** ${PURSE.map(([k, w]) => `${(k === "gold" ? gold : t.wallet[k] ?? 0).toLocaleString("en-US")} ${w}`).join(", ")}.`, "")
    // the Stage Coach's upgrades are always named, each with its cost and what is missing when the estate cannot pay yet (U10)
    const short = (u: Upgrade) => u.cost.filter((c) => c.amount > (t.wallet[c.type] ?? 0)).map((c) => `${c.amount - (t.wallet[c.type] ?? 0)} ${c.type}s`).join(" and ")
    const cost = (u: Upgrade) => u.cost.map((c) => `${c.amount} ${c.type}s`).join(" and ")
    const coachOut = a.coach.filter((u) => !u.affordable)
    const waitsWords = (u: Upgrade) => u.blockedBy.replace(/^needs /, "").split(", ").map((w) => inWords(`needs ${w}`)).join(", ")
    const coachNote = coachOut.length ? ` Out of reach at the Stage Coach: ${coachOut.map((u) => `${u.label.replace(/^[^:]+: /, "")} (${cost(u)}; ${u.blockedBy ? `it waits on ${waitsWords(u)}` : `${short(u)} short`})`).join("; ")}.` : ""
    if (a.heirlooms.length || coachOut.length) {
      L.push("```board-decisions")
      L.push(`- q: "Where do the heirlooms go?"`, `  context: ${y(`The estate holds ${t.wallet.crest ?? 0} crests, ${t.wallet.bust ?? 0} busts, ${t.wallet.portrait ?? 0} portraits, ${t.wallet.deed ?? 0} deeds.${coachNote}`)}`, "  options:")
      for (const u of a.heirlooms) L.push(`    - pick: ${y(u.label)}`, `      effect: ${y(`costs ${u.cost.map((c) => `${c.amount} ${c.type}s`).join(" and ")}.`)}`)
      L.push(`    - pick: "Save them"`, `      effect: ${y("Keep the heirlooms for a bigger upgrade later.")}`)
      // an affordable building upgrade that opens the party's own waiting upgrades comes first (Soushi, 2026-10-10)
      const opens = a.heirlooms.map((u) => a.blocked.filter((b) => b.blockedBy.includes(`${u.tree} ${u.code}`)))
      const most = opens.reduce((best, o, i) => (o.length > (opens[best]?.length ?? 0) ? i : best), -1)
      const san = a.heirlooms.findIndex((u) => u.tree === "sanitarium.disease_quirk_cost" || u.tree === "sanitarium.cost")
      // my habit: a roster mostly at level 1 or lower wants seasoned recruits before anything else the heirlooms can buy
      const seasoned = a.coach.find((u) => u.tree === "stage_coach.upgraded_recruits"), si = seasoned ? a.heirlooms.indexOf(seasoned) : -1
      // C97: the habit buys the first tier of seasoned recruits; once that is bought, the next tier waits behind upgrades the estate is far
      // from, and the heirlooms go to what they can build now (Soushi, 2026-10-13: "We already bought the Stage Coach upgrade, we need
      // to plan next target based on what we got")
      const youngWhy = a.young && seasoned && seasoned.code === "a" ? `my habit: ${a.young.low} of your ${a.young.of} heroes are level 1 or lower, so the Stage Coach's seasoned recruits come first` : ""
      // U40: on the road to the seasoned recruits, a step the estate can buy tonight is bought, not saved for: the one the four
      // wait on first, else the first in the plan's order (C75); "Save them" only when no step is buyable
      const onRoad = (seasoned?.chain ?? []).filter((x) => x.ready).map((x) => a.heirlooms.findIndex((u) => u.tree === x.tree && u.code === x.code)).filter((i) => i >= 0)
      const step = onRoad.find((i) => (opens[i]?.length ?? 0) > 0) ?? onRoad[0] ?? -1
      // C97: after the young habit, the doctrine's order: what opens the four's waiting upgrades, the Sanitarium, the relief the
      // heroes use this week (stress), then a lower price where the party's gold goes (the Guild if it trains this week, else the smith)
      const relief = a.heirlooms.findIndex((u) => reliefUsed.some((n) => u.label.includes(n)))
      const cut = a.heirlooms.findIndex((u) => u.label === (a.buys.some((b) => b.where === "Guild") ? "Guild: lower prices" : "Blacksmith: lower prices"))
      const lean = youngWhy ? (si >= 0 ? si : step >= 0 ? step : a.heirlooms.length) : most >= 0 ? most : san >= 0 ? san : relief >= 0 ? relief : cut >= 0 ? cut : a.heirlooms.length
      const why = youngWhy ? (si >= 0 ? `${youngWhy}.` : step >= 0 ? `${youngWhy}, and the road to them can start tonight: ${a.heirlooms[step]!.label} is one of its steps${opens[step]?.length ? `, and it opens what the party is waiting for: ${opens[step]!.map((b) => `${b.hero} ${b.label}`).join(", ")}` : ""}.` : seasoned!.blockedBy ? `${youngWhy}; I keep the heirlooms for them, and the road to them comes first: it waits on ${waitsWords(seasoned!)}.` : `${youngWhy}; I keep the heirlooms for them, ${cost(seasoned!)}, ${short(seasoned!)} short.`) : most >= 0 ? `it opens what the party is waiting for: ${opens[most]!.map((b) => `${b.hero} ${b.label}`).join(", ")}.` : san >= 0 ? `${a.disease.length} of your heroes are ill; cheaper treatment pays back quickly.` : relief >= 0 ? `my order puts stress next, and this week I lean heroes to the ${reliefUsed.find((n) => a.heirlooms[relief]!.label.includes(n))}: improving it serves them now and every week after.` : cut >= 0 ? `my order puts the gold next: the party ${a.buys.some((b) => b.where === "Guild") ? "trains at the Guild" : "is armed at the Blacksmith"} this week, and a lower price there pays back every week.` : "nothing affordable opens anything the party is waiting for."
      L.push(`  lean: ${lean}`, `  lean_why: ${y(why)}`)
      L.push("```", "")
      // U22: saving is a plan, not a wait (Soushi, 05:22: "when you propose to save for later, at least give a vision")
      if (youngWhy && si < 0 && seasoned) L.push(...savingPlan(t, a, seasoned, opts.rates ?? {}))
    }
    if (a.trinkets.length) {
      L.push("```board-stickies")
      for (const tr of a.trinkets) L.push(`- title: ${y(tr.to ? `${tr.trinket} to ${tr.to}` : `${tr.trinket} waits in the stores`)}`, "  kind: idea", `  body: ${y(`${tr.why[0]!.toUpperCase()}${tr.why.slice(1)}.`)}`)
      L.push("```", "")
    }
  }

  // C14: every number on this page, with the save field or game file it was read from
  const rows: [string, string, string][] = []
  rows.push([`${STRESS.test}`, "stress at which resolve is tested", "darkestdungeon.wiki.gg/wiki/Stress (Soushi allowed the wiki, 2026-10-11)"], [`${STRESS.max}`, "stress at which the heart gives out; the bars run to it", "darkestdungeon.wiki.gg/wiki/Stress"])
  for (const [k, v] of Object.entries(t.wallet)) rows.push([`${v}`, `${k} in the coffers`, "`persist.estate.json` wallet"])
  rows.push([`${t.rosterSize} / ${t.rosterCap}`, "roster and its cap", "`persist.roster.json` heroes; `stage_coach.building.json` roster_size_upgrades at your `stage_coach.rostersize` purchases"])
  rows.push([`${t.quests_won} / ${t.quests_done}`, "expeditions won", "`persist.progression.json` total_successful_quests_finished / total_quests_finished"])
  const shown = new Set<number>()
  for (const h of [...a.relief.map((r) => r.hero), ...a.disease, ...(chosen?.seats.map((x) => x.hero) ?? []), ...a.dismiss.map((d) => d.hero)]) {
    if (shown.has(h.guid)) continue
    shown.add(h.guid)
    rows.push([`${h.stress}`, `${h.name}'s stress`, `\`persist.roster.json\` heroes.${h.guid}.m_Stress`])
    rows.push([`${h.level}`, `${h.name}'s level`, `resolveXp ${h.xp} against \`roster.variables.json\` resolve_level_thresholds`])
  }
  for (const act of t.activities) {
    const file = `\`campaign/town/buildings/${act.building}/${act.building}.building.json\``
    rows.push([`${act.cost}`, `${act.name}, gold`, `${file} ${act.activity} cost tier at your purchases`])
    if (act.heal) rows.push([`${act.heal}`, `${act.name}, stress relieved`, `${file} ${act.activity} stress_upgrades`])
    if (act.lockedQuirkCost !== undefined) rows.push([`${act.lockedQuirkCost}`, `${act.name}, gold for a quirk that has set in`, `${file} ${act.activity} permanent_negative_quirk_cost_upgrades at your purchases`])
    rows.push([`${act.slots - act.used} / ${act.slots}`, `${act.name}, free seats`, `${file} slot_upgrades; occupants from \`persist.town.json\``])
  }
  for (const u of a.buys.slice(0, 5)) rows.push([`${u.cost.find((c) => c.type === "gold")?.amount ?? 0}`, `${u.hero}: ${u.label} to level ${u.toLevel}`, `\`upgrades/heroes/${u.tree.split(".")[0]}.upgrades.json\` ${u.tree} code ${u.code}, less ${Math.round((u.where === "Guild" ? t.skillDiscount : t.gearDiscount) * 100)}% from \`${u.where === "Guild" ? "guild" : "blacksmith"}.building.json\``])
  for (const r of a.recruits) if (fill.get(r.hero.guid)?.gap === "healer") rows.push([`${r.heal!.avg}`, `${r.heal!.skill}, hit points a cast on average`, `\`heroes/${r.hero.cls}/${r.hero.cls}.info.darkest\` .heal range at its first level`])
  for (const u of a.heirlooms) rows.push([u.cost.map((c) => `${c.amount} ${c.type}`).join(", "), u.label, `\`upgrades/building/${u.tree.split(".")[0]}.upgrades.json\` ${u.tree} code ${u.code}`])
  for (const p of a.parties) rows.push([p.quest.rewards.filter((r) => /^\d/.test(r)).join(", "), `${questLabel(p)}, rewards`, "`persist.quest.json` completion_reward"])
  for (const i of roadItems) rows.push([`${i.price}`, `${i.label}, gold each`, `\`inventory/base.supply.inventory.items.darkest\` purchase_gold_value${t.event?.provisions.length ? `, with this week's event (\`${t.event.id}\`)` : ""}`])
  rows.push([`${t.witnessedSkills}`, "enemy attacks witnessed", "`persist.game_knowledge.json` combat_skills"])
  // C48: the Caretaker's habits, every rule of his own on one list, grouped, to be reviewed and changed as the game is learnt
  // (Soushi, 2026-10-11: "it should be a list of the habits of the caretaker so we can review and update them")
  L.push("## The Caretaker's habits {wide}", "")
  L.push(`Every rule of my own that bends the advice on this page, so you can weigh it and change it as we learn the dark together. None of these is a law of the dark; each is my own judgement. Pin a comment on any row to change it, and I will. Your heroes have suffered ${t.witnessedSkills} kinds of blow so far, in ${t.visited.length ? `${t.visited.length} of the places beyond the Hamlet` : "no place yet"}.`, "")
  const H = (group: string, rows: [string, string | number][]) => { L.push(`**${group}**`, "", "| Habit | Now |", "|---|---|"); for (const [w, v] of rows) L.push(`| ${w} | ${v} |`); L.push("") }
  H("Rest and sending", [
    ["A hero at this much stress or more rests before going out again", RULE.restAbove],
    ["I only send heroes under this much stress", RULE.sendBelow],
    ["A level 0 hero with this many bad quirks is one I would let go", RULE.dismissNegatives],
    ["When this share of the roster is level 1 or lower, the heirlooms go to the Stage Coach's seasoned recruits first", `${Math.round(RULE.youngRoster * 100)}%`],
    ["A heal restoring this many hit points a cast, at its first level, makes a healer; less is no heal at all", RULE.realHeal],
  ])
  H("Choosing the road", [
    ["When this many of the four are level 0, a longer road counts against itself", RULE.greenParty],
    ["How much it counts, for each step beyond a short road", RULE.greenPerStep],
    ["Every this much gold the road leaves in the coffers counts one point", coin(RULE.goldPerPoint)],
    ["Up to this many points for gold left", RULE.goldCap],
    ["A road the coffers cannot provision counts this much against itself", RULE.brokeRoad],
  ])
  H("Seating the four", [
    ["A true healer in the four", `+${RULE.healerWorth}`], ["A stun in the four", `+${RULE.stunWorth}`],
    ["Two of the same calling in the four", `−${RULE.sameClass}`], ["Each level of a hero", `+${RULE.levelWorth}`], ["Each point of stress a hero carries", `−${RULE.stressWeight}`],
    ["Each enemy rank the four can strike from their seats", `+${RULE.reachPerRank}`],
    ["Each neighbouring rank a hero can still strike from, if knocked out of their seat", `+${RULE.shufflePerSide}`],
    ["A skill that moves its user back into their seat", `+${RULE.moveWorth}`],
    ["A mark carried with a hand that strikes the marked harder", `+${RULE.markPair}`],
    ["A bleed or blight, times the share of the road's known foes that fail to resist it", `+${RULE.dotWorth}`],
    ["Each hit point above the four's average at the front (rank 1 twice, rank 2 once, rank 3 once against, rank 4 twice against)", `${RULE.frontHp}`],
    ["A true healer's extra weight on a road where healing failed before", `+${RULE.lessonHeal}`],
  ])
  H("On the road", [
    ["Torches for a short, medium and long road", RULE_FOOD.slice(1).join(", ")], ["Food for a short, medium and long road, in full slots of 12", RULE_PROVISION.slice(1).join(", ")],
    ["When this many of the four have broken, I bring them home", RULE.turnBackBroken],
    ["Below this light I count them as walking in the dark", CHRONICLE_RULE.darkTorch],
    ["This much stress between two pages is a blow worth telling", CHRONICLE_RULE.stressSpike],
    ["This share of a hero's health lost or regained between two pages is a wound or a mending worth telling", `${Math.round(CHRONICLE_RULE.woundShare * 100)}%`],
  ])
  H("Learning from the road", [
    ["Torches a lesson about the dark adds on its dungeon", `+${CHRONICLE_RULE.lessonTorches}`],
    ["Food a lesson about hunger adds on its dungeon", `+${CHRONICLE_RULE.lessonFood}`],
    ["One more torch and food on a road harder than any yet", `+${CHRONICLE_RULE.untriedMargin}`],
  ])
  H("At the Survivalist", [
    ["Each point of stress a camping skill relieves, times how many it reaches", RULE.campStress],
    ["A camping heal, per whole health bar, times how many it reaches", RULE.campHealth],
    ["A cure at camp (bleeding, blight, disease)", RULE.campCure], ["A guard on the camp against a night ambush", RULE.campGuard], ["A boon until the next fight", RULE.campBoon],
  ])

  const S: string[] = [`# Where each figure comes from, week ${t.week}`, "", "Every number on the town board beside the save field or game file it was read from (C14). Numbers labelled (my habit) on the board are RULE values and are not here.", ""]
  S.push("| Figure | What | Read from |", "|---|---|---|")
  for (const [n, what, from] of rows) S.push(`| ${n} | ${what.replace(/\|/g, "/")} | ${from} |`)
  S.push("", `Save copied from your Steam profile to \`.dd-runtime/profile/\` and decoded there; your files are never written. Game data read from the install. ${t.witnessedSkills} enemy attacks witnessed, dungeons walked: ${t.visited.join(", ") || "none"}. Rules of mine on this page: rest at ${RULE.restAbove} stress, send under ${RULE.sendBelow}, let go of level 0 heroes with ${RULE.dismissNegatives}+ bad quirks.`, "")
  return { board: inActingOrder(L.join("\n")), sources: S.join("\n") }
}

/** C31: the board reads in the order the week is played, each section changing what the next can advise: what happened,
 *  the coffers, the estate's upgrades, who stays (the pool), who rests (who is free), the road and the party, how ready they
 *  are, the party's training, and the road's provisions last, out of what is left (Soushi, 2026-10-10). Sections are built
 *  in the order their figures depend on (the gold the leans spend, the party the training trains) and shown in this one. */
export const ACTING_ORDER = ["The coach is back",
  "This week in the Hamlet", "This week so far", "Did you do what you chose?", "The estate's coffers", "Heirlooms and trinkets",
  "Who stays, who goes", "Who rests, who prays", "The next expedition", "How ready they are", "The Guild and the Blacksmith", "The Survivalist",
  "Provisions for the", "The Caretaker's habits",
]
export function inActingOrder(md: string): string {
  const parts = md.split(/\n(?=## )/)
  const head = parts[0]!, sections = parts.slice(1)
  const rank = (sec: string) => { const i = ACTING_ORDER.findIndex((t) => sec.startsWith(`## ${t}`)); return i < 0 ? ACTING_ORDER.length : i }
  return [head, ...sections.map((sec, i) => ({ sec, i })).sort((a, b) => rank(a.sec) - rank(b.sec) || a.i - b.i).map((x) => x.sec)].join("\n")
}

export async function buildBoard(t: Town, opts: { foresight?: boolean } = {}): Promise<string> {
  mkdirSync(join(outDir(), "img"), { recursive: true })
  const answers = await readAnswers()
  // C40 to C42: the survivors' tale of the road just walked, and its lessons kept before this week is advised
  let tale: Tale | undefined
  if (t.back) {
    const snaps = await chronicleFor(t.back), fellNames = t.back.heroes.filter((h) => h.died).map((h) => h.name)
    // C45: the whole debrief folded into the tale: traps, obstacles, criticals, curios and quirks take their place among the beats;
    // a fall of light the obstacle caused, and a leap of stress the trap caused, are told once, by their cause
    const db = snaps.length > 1 ? await debrief(snaps) : undefined
    const extra = db?.beats ?? []
    // a leap of stress already told by its cause (a trap, a curio, an obstacle by hand) is not told a second time (U7)
    const told = (x: Beat) => extra.some((e) => Math.abs(e.i - x.i) <= 1 && (e.who === x.who || (!!x.who && e.text.includes(`${x.who} `) && /stress/.test(e.text))))
    const all = [...beats(snaps, fellNames).filter((x) => !(x.kind === "dark" && extra.some((e) => e.kind === "obstacle" && e.i === x.i))
      && !(x.kind === "battle" && extra.some((e) => e.kind === "battle" && e.i === x.i))
      && !(x.kind === "spike" && told(x))), ...extra].sort((x, y) => x.i - y.i)
    // C55: the tale checks itself against the pages, and a step that does not match is dropped and reported
    const classes = await Promise.all([...new Set(snaps.flatMap((s) => s.heroes.map((h) => h.cls)))].map((c) => nameOf("class", c)))
    const check = checkTale(snaps, all, db, classes), bs = check.beats
    const healers = (await Promise.all(t.back.heroes.map(async (bh) => {
      const h = [...t.heroes, ...t.fallen].find((x) => x.guid === bh.guid), sk = h ? (await heroClass(h.cls)).skills : undefined
      return !!h && h.skills.some((s) => sk?.get(s.id)?.targetsAllies && sk.get(s.id)!.healAvg >= RULE.realHeal) ? h.name : ""
    }))).filter(Boolean)
    const healer = healers.length > 0
    const first = snaps[0]
    const base = { dungeon: t.back.dungeon, difficulty: first?.difficulty ?? 0, length: t.back.length, week: t.week - 1, trip: `${t.back.dungeonName}, week ${t.week - 1}` }
    const j = judge(snaps, bs, { ...base, dungeonName: t.back.dungeonName, success: t.back.success, healer })
    // C102: what the road taught about the foes and the four, kept beside what it used
    const taught = teachings(snaps, bs, db, base, healers)
    j.lessons.push(...taught.lessons)
    if (snaps.length > 1) await remember(j.lessons)
    tale = { snaps: snaps.length, beats: bs, ...j, debrief: db, issues: check.issues, taught: taught.lines }
  }
  t.ledger = await loadLedger()
  // the week's first board keeps the Hamlet as it found it (C26)
  const wsFile = Bun.file(join(outDir(), "week-start.json"))
  let start = (await wsFile.exists()) ? ((await wsFile.json()) as WeekStart) : undefined
  if (!start || start.week !== t.week) {
    start = { week: t.week, heroes: t.heroes.map((h) => ({ guid: h.guid, name: h.name, busy: h.busy })), bought: [...t.bought], gold: t.wallet.gold ?? 0, purchases: t.purchases.map((p) => `${p.guid}|${p.key}`) }
    await Bun.write(wsFile, JSON.stringify(start, null, 1))
  }
  // C90: the week is advised from the Hamlet as the week found it, so following a pick never moves the others. A hero placed in a
  // building since the week began still counts as free to the plan, and their seat as open (Soushi, 2026-10-13: "ensure the
  // proposed strategies are coherent and while I apply it it doesn't break the recommendations")
  const ledgerFile = Bun.file(join(outDir(), "roster-ledger.json"))
  const rl = rosterLedger((await ledgerFile.exists()) ? ((await ledgerFile.json()) as RosterLedger) : undefined, t, start)
  await Bun.write(ledgerFile, JSON.stringify(rl, null, 1))
  t.settling = settling(rl, t.week, RULE.settleWeeks)
  const placed = new Map(t.heroes.filter((h) => h.busy && start?.week === t.week && start.heroes.some((x) => x.guid === h.guid && !x.busy)).map((h) => [h.guid, h.busy] as const))
  t = planView(t, start)
  const a = await advise(t)
  // a party Soushi named in a note, seated for the expedition he picked
  let own: Party | undefined
  const quest = ((answers.expedition && a.parties.find((p) => questLabel(p) === answers.expedition)) || a.best)?.quest
  if (answers.partyNames?.length && quest) {
    const heroes = answers.partyNames.map((n) => t.heroes.find((h) => h.name.toLowerCase() === n.toLowerCase())).filter((h): h is HeroView => !!h)
    // four names that are all on the roster, or the note is not a party
    if (heroes.length === 4) own = await seatParty(heroes, quest)
  }
  const checks = reconcile(await loadPicks(outDir()), t)
  // what was proposed the week they left: kept per week, else the last proposal when it is that week's (#3)
  let sent: Proposal | undefined
  if (t.back) for (const f of [join(outDir(), "proposals", `week-${t.week - 1}.json`), join(outDir(), "proposal.json")]) {
    const p = await Bun.file(f).json().catch(() => undefined) as Proposal | undefined
    if (p && p.week === t.week - 1) { sent = p; break }
  }
  // what each heirloom came home at, per recorded trip (U22)
  const rates = Object.fromEntries(await Promise.all(["crest", "bust", "portrait", "deed"].map(async (k) => [k, await heirloomTrips(k)] as const)))
  const { board, sources } = source(t, a, { foresight: !!opts.foresight, answers, own, checks, prices: await supplyPrices(), soFar: weekSoFar(t, start), placed, newcomers: start && start.week === t.week ? new Set(t.heroes.filter((h) => !start!.heroes.some((x) => x.guid === h.guid)).map((h) => h.guid)) : undefined, tale, camp: await campingSkills(), sent, rates, pack: await packRules() })
  // C38: every build is read back for advice that contradicts itself; the live session is told through coherence.json
  const clash = [...contradictions(board), ...(tale?.issues ?? [])]
  await Bun.write(join(outDir(), "coherence.json"), JSON.stringify({ week: t.week, contradictions: clash }, null, 1))
  if (clash.length) console.log(`INCOHERENT week ${t.week}: ${clash.join(" | ")}`)
  // what the Caretaker proposed this week, for the farewell to judge the departure against (C24)
  const chosen = own ?? ((answers.expedition && a.parties.find((p) => questLabel(p) === answers.expedition)) || a.best)
  if (chosen) {
    // kept per week too, so the return a week later still knows what was proposed and picked when they left (#3)
    const prop: Proposal = { week: t.week, dungeon: chosen.quest.dungeon, length: chosen.quest.length, type: chosen.quest.type, label: questLabel(chosen), party: chosen.seats.map((x) => x.hero.guid), own: !!own, picked: !!(answers.expedition && a.parties.some((p) => questLabel(p) === answers.expedition)) }
    await Bun.write(join(outDir(), "proposal.json"), JSON.stringify(prop, null, 1))
    mkdirSync(join(outDir(), "proposals"), { recursive: true })
    await Bun.write(join(outDir(), "proposals", `week-${t.week}.json`), JSON.stringify(prop, null, 1))
  }
  return compile(board, sources)
}

// the estate's currencies, in the order the Hamlet's bar shows them, with the word the board says for each
const PURSE: [string, string][] = [["gold", "gold"], ["crest", "crests"], ["bust", "busts"], ["portrait", "portraits"], ["deed", "deeds"]]

/** The game's own currency icons set beside each count of the estate's holdings: on the heirlooms' line and on the coffers'
 *  tally (Soushi, 2026-10-11 04:23: "show more clearly what we hold, like in the game, with the respective assets"). The icons
 *  are copied from the install at build time like the portraits (A4); a count whose icon is missing keeps its word. */
export function estateIcons(html: string): string {
  const icon = new Map<string, string>()
  for (const [k, w] of PURSE) {
    const src = join(install, "shared", "estate", `currency.${k}.icon.png`), rel = `img/currency.${k}.png`
    if (!existsSync(src)) continue
    mkdirSync(join(outDir(), "img"), { recursive: true })
    copyFileSync(src, join(outDir(), rel))
    icon.set(w, rel)
  }
  if (!icon.size) return html
  const img = (w: string) => `<img class="coin" src="${icon.get(w)}" alt="${w}" title="${w}">`
  html = html.replace(/<p><strong>What the estate holds\.<\/strong>([^<]*)<\/p>/, (_m, list: string) =>
    `<p class="purse"><strong>What the estate holds.</strong> ${[...list.matchAll(/(\d[\d,]*) ([a-z]+)/g)].map(([, n, w]) => icon.has(w!) ? `<span class="coin">${img(w!)}<b>${n}</b></span>` : `<span class="coin"><b>${n}</b> ${w}</span>`).join("")}</p>`)
  html = html.replace(/<div class="big">([\d,]+)<\/div><div class="of">(gold|crests|busts|portraits|deeds)<\/div>/g, (m, n: string, w: string) => icon.has(w) ? `<div class="big">${img(w)}${n}</div><div class="of">${w}</div>` : m)
  const css = `<style>.purse{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem 1.3rem}.purse .coin{display:inline-flex;align-items:center;gap:.35rem;font-size:1.15rem}.purse img.coin,.tally img.coin{height:1.8rem;width:auto;vertical-align:middle;image-rendering:auto}.tally img.coin{height:1.5rem;margin-right:.35rem}</style>`
  return html.replace("</head>", `${css}</head>`)
}

/** The four's experience (C85, my habit): a seasoned hero beside newcomers steadies them, so a party of newcomers is told who
 *  of the roster could go with them (Soushi, 07:15: "putting newbies with more experienced, or a veteran in a less experienced
 *  group to help leveling"). */
function mixWords(p: Party, t: Town): string {
  const lv = p.seats.map((s) => s.hero.level), top = Math.max(...lv)
  const vet = p.seats.find((s) => s.hero.level === top)!.hero, green = p.seats.filter((s) => s.hero.level <= 1 && s.hero.guid !== vet.guid).map((s) => s.hero.name)
  if (top >= 2 && green.length) return ` A seasoned hero goes with newcomers (my habit): ${vet.name}, level ${vet.level}, beside ${green.join(", ")}.`
  const seasoned = t.heroes.filter((h) => h.level >= 2 && !p.seats.some((s) => s.hero.guid === h.guid)).sort((a, b) => b.level - a.level)[0]
  return top <= 1 && seasoned ? ` All four are newcomers; my habit is to send a seasoned hero with them, such as ${seasoned.name}, ${seasoned.clsName}, level ${seasoned.level}.` : ""
}

// the estate's tally for the header, filled while the board is written (C84)
let estateTally: { won: number; done: number; roster: number; cap: number; gold: number } | undefined

/** The estate's tally set under the headline (C84; Soushi, 07:10: "I would like the number of expedition won / total expedition
 *  to be more visible"): expeditions won of all as the lead figure, the roster against its limit, the gold. */
export function headerTally(html: string, x: typeof estateTally): string {
  if (!x) return html
  const coin = existsSync(join(outDir(), "img", "currency.gold.png")) ? `<img class="coin" src="img/currency.gold.png" alt="">` : ""
  const box = `<div class="estate-tally"><div class="et-lead"><b>${x.won}</b><span>of ${x.done}</span><small>expeditions won</small></div><div><b>${x.roster}</b><span>of ${x.cap}</span><small>on the roster</small></div><div><b>${coin}${x.gold.toLocaleString("en-US")}</b><small>gold in the coffers</small></div></div>`
  const css = `<style>.estate-tally{display:flex;flex-wrap:wrap;gap:.6rem 2.2rem;align-items:flex-end;margin:.6rem 0 1rem}.estate-tally>div{display:flex;flex-direction:column;line-height:1.05}.estate-tally b{font-family:var(--title,inherit);font-size:2rem;color:var(--ink);font-weight:normal;display:inline-flex;align-items:center;gap:.35rem}.estate-tally .et-lead b{font-size:3.2rem;color:var(--gold)}.estate-tally span{font-size:1rem;color:var(--ink);margin-top:.1rem}.estate-tally small{font-size:.8rem;color:var(--dim);text-transform:lowercase;letter-spacing:.04em;margin-top:.15rem}.estate-tally img.coin{height:1.6rem;width:auto}@media (max-width:520px){.estate-tally .et-lead b{font-size:2.4rem}.estate-tally b{font-size:1.6rem}}</style>`
  return html.replace(/(<header class="hero"><div><h1>[\s\S]*?<\/h1>)/, `$1${box}`).replace("</head>", `${css}</head>`)
}

// the portraits the seat stickies show, by hero name, filled while the board is written (U30)
let faces = new Map<string, string>()

/** Each seat sticky of the party card ("Rank 4: Patremol") shows that hero's portrait in their own look (U30; Soushi, 06:30:
 *  "Show heroes portrait for the seatings"). The board's stickies take no picture, so it is set in once the page is built. */
export function seatFaces(html: string, by: Map<string, string>): string {
  if (!by.size) return html
  const out = html.replace(/(<div class="sticky[^"]*"[^>]*>)(<b class="t">Rank \d: ([^<(]+?)(?: \(|<))/g, (m, open: string, rest: string, name: string) =>
    by.has(name.trim()) ? `${open}<img class="seat-face" src="${by.get(name.trim())}" alt="">${rest}` : m)
  return out.replace("</head>", `<style>.sticky img.seat-face{float:left;width:4.2rem;height:auto;margin:0 .6rem .3rem 0;border:1px solid var(--line,#444)}</style></head>`)
}

async function compile(board: string, sources: string): Promise<string> {
  const src = join(outDir(), "town.md")
  await Bun.write(src, board)
  await Bun.write(join(outDir(), "sources.md"), sources)
  await buildSkin()
  const out = join(outDir(), "town.html")
  const proc = Bun.spawnSync(["bun", BOARD, src, "--no-sketch", "--out", out], { stdout: "pipe", stderr: "pipe" })
  if (proc.exitCode !== 0) throw new Error(`board build failed: ${proc.stderr.toString()}`)
  await Bun.write(out, headerTally(seatFaces(estateIcons(await Bun.file(out).text()), faces), estateTally))
  estateTally = undefined
  return out
}

/** The plan behind a lean to keep the heirlooms (U22): what is short, which of this week's roads pay it, how many trips that
 *  takes at the rate the recorded trips brought it home, and what the other heirlooms can buy now without delaying the target. */
export function savingPlan(t: Town, a: Advice, target: Upgrade, rates: Record<string, { trips: number; got: number }>): string[] {
  const held = (k: string) => t.wallet[k] ?? 0
  const lines: string[] = []
  // U29: the whole road to the target, every upgrade it waits on in an order the Hamlet allows, from the game's upgrade files
  // (Soushi, 06:16: "detail better the target we save for ... we need armorsmith first for Stage Coach seasoned recruits")
  const chain = target.chain?.length ? target.chain : [{ tree: target.tree, code: target.code, label: target.label, cost: target.cost, ready: target.affordable, waits: [] }]
  const costs = (c: Cost[]) => c.map((x) => `${x.amount} ${x.type}s`).join(" and ")
  if (chain.length > 1) {
    const step = (k: string) => chain.findIndex((x) => `${x.tree} ${x.code}` === k) + 1
    lines.push(`It waits on ${chain.length - 1} other upgrade${chain.length > 2 ? "s" : ""} first. In an order the Hamlet allows: ${chain.map((x, i) => `${i + 1}. ${x.label}, ${costs(x.cost)}, ${x.ready ? "buyable tonight" : x.waits.length ? `after ${x.waits.map((w) => step(w) ? `step ${step(w)}` : inWords(`needs ${w}`)).join(" and ")}` : `${x.cost.filter((c) => c.amount > held(c.type)).map((c) => `${c.amount - held(c.type)} ${c.type}${c.amount - held(c.type) === 1 ? "" : "s"}`).join(" and ")} short`}`).join("; ")}.`)
  } else lines.push(`Nothing has to be built before it: the game asks for no other upgrade first.`)
  // what the whole road costs, against what the estate holds
  const need = new Map<string, number>()
  for (const x of chain) for (const c of x.cost) need.set(c.type, (need.get(c.type) ?? 0) + c.amount)
  if (chain.length > 1) lines.push(`The whole road costs ${[...need].map(([k, n]) => `${n} ${k}s (you hold ${held(k)})`).join(", ")}.`)
  for (const c of [...need].map(([type, amount]) => ({ type, amount })).filter((c) => c.amount > held(c.type))) {
    const k = c.type, short = c.amount - held(k), plural = `${k}s`
    const roads = t.quests.filter((q) => !q.plot && q.rewards.some((r) => new RegExp(`^\\d+ ${k}s?$`).test(r)))
      .map((q) => `the ${q.dungeonName}, ${(LENGTH[q.length] ?? "").toLowerCase()} (${q.goal}), paying ${q.rewards.find((r) => new RegExp(`^\\d+ ${k}s?$`).test(r))}`)
    const r = rates[k], per = r && r.trips ? r.got / r.trips : 0
    lines.push(`${short} ${plural} short.`)
    lines.push(roads.length ? `This week ${roads.length > 1 ? "these roads pay" : "this road pays"} them: ${roads.join("; ")}.` : `No road this week pays ${plural}.`)
    lines.push(per > 0 ? `The ${r!.trips} roads I kept the story of brought home ${r!.got} ${plural}, about ${Math.round(per * 10) / 10} a trip; at that rate, ${Math.ceil(short / per)} more trips.` : r?.trips ? `None of the ${r.trips} roads I kept the story of brought ${plural} home, so I cannot say how many trips.` : `I have kept no road's story yet, so I cannot say how many trips.`)
  }
  // what the rest can buy without touching what the target needs
  const keep = Object.fromEntries([...need].map(([k, n]) => [k, Math.min(n, held(k))]))
  const spare = (k: string) => held(k) - (keep[k] ?? 0)
  const free = a.heirlooms.filter((u) => u !== target && !chain.some((x) => x.tree === u.tree && x.code === u.code) && u.cost.every((c) => c.amount <= spare(c.type)))
  const sparing = Object.keys(t.wallet).filter((k) => ["crest", "bust", "portrait", "deed"].includes(k) && spare(k) > 0).map((k) => `${spare(k)} ${k}s`)
  lines.push(free.length ? `Without delaying it, the ${sparing.join(", ")} it does not need can pay for any one of these now: ${free.map((u) => `${u.label} (${u.cost.map((c) => `${c.amount} ${c.type}s`).join(" and ")})`).join("; ")}.` : `Nothing else the heirlooms can buy now leaves the target untouched.`)
  return ["```board-stickies", `- title: ${JSON.stringify(`My plan for the ${target.label.replace(/^[^:]+: /, "")}`)}`, "  kind: model", `  body: ${JSON.stringify(lines.join(" "))}`, "```", ""]
}

/** The road and four that left, against the proposal of the week they left (#3): named, each difference marked, and whose
 *  choice it was. Empty when nothing was proposed that week. */
export function sentAgainst(b: NonNullable<Town["back"]>, p: Proposal | undefined, name: (g: number) => string): string {
  if (!p) return ""
  const len = (n: number) => (LENGTH[n] ?? String(n)).toLowerCase()
  const roadSame = p.dungeon === b.dungeon && p.length === b.length
  const proposedRoad = p.label.split(":")[0]!, four = b.heroes.map((h) => h.guid), names = (gs: number[]) => gs.map(name).filter(Boolean)
  const gone = p.party.filter((g) => !four.includes(g)), came = four.filter((g) => !p.party.includes(g))
  const whose = p.picked || p.own ? "the road and four you picked" : "my own lean"
  const diffs: string[] = []
  if (!roadSame) diffs.push(`they went to the ${b.dungeonName}, ${len(b.length)}, not ${proposedRoad.startsWith("the ") ? "" : "the "}${proposedRoad}`)
  if (came.length) diffs.push(`${names(came).join(" and ")} went in place of ${names(gone).join(" and ")}`)
  const head = `**Who went, against what was proposed.** ${names(four).join(", ")} went to the ${b.dungeonName}, ${len(b.length)}.`
  return diffs.length
    ? `${head} The proposal, ${whose}, was ${proposedRoad} with ${names(p.party).join(", ")}; ${diffs.join("; ")}.`
    : `${head} As proposed, ${whose}.`
}

export interface Proposal { week: number; dungeon: string; length: number; type: string; label: string; party: number[]; own: boolean; picked?: boolean }

/** The farewell (C24): once the party has left, the board turns into the Caretaker's last word before the dark: how they were
 *  sent against what he proposed and what was picked, what they carry against his habit, the foes known there, when he would
 *  turn back, and a send-off. In his voice like the town board (C13); its figures go to sources.md (C14). */
export function farewellSource(t: Town, r: NonNullable<Town["raid"]>, opts: { proposal?: Proposal; checks: Check[]; prices: Map<string, number>; pack?: PackRules }): { board: string; sources: string } {
  const q = r.quest, L: string[] = [], rows: [string, string, string][] = []
  const who = r.party.map((g) => t.heroes.find((h) => h.guid === g)).filter((h): h is HeroView => !!h)
  const names = who.map((h) => h.name)
  const p = opts.proposal && opts.proposal.week === t.week ? opts.proposal : undefined
  const len = Math.max(1, Math.min(3, q.length))
  L.push(`# The coach has left for the *${q.dungeonName}*`, "")
  L.push(`The wheels are past the old bridge and the road turns toward the ${q.dungeonName}. Before the sound of them is gone, here is my last word on how you sent them.`, "")
  const sameFour = !!p && p.party.length === r.party.length && p.party.every((g) => r.party.includes(g))
  const sameOrder = sameFour && p!.party.every((g, i) => r.party[i] === g)
  const sameRoad = !!p && p.dungeon === q.dungeon && p.length === q.length
  const verdict = !p ? "I had no proposal of mine this week to hold them to." : sameRoad && sameOrder ? (p.own ? "The four you named, on the road you chose, in the order you gave them." : "As I would have sent them: the road I proposed, the four I proposed, in the order I placed them.") : `${sameRoad ? "The road I proposed" : "Not the road I proposed"}, ${sameFour ? (sameOrder ? "with the four I proposed in my order" : "with the four I proposed, in another order") : "and not the four I proposed"}.`
  L.push("```board-idea")
  L.push(`headline: ${y(`${q.dungeonName}, ${(LENGTH[q.length] ?? "").toLowerCase()} (${q.goal}),\nwith ${names.join(", ")}.`)}`)
  L.push(`detail: ${y(verdict)}`)
  L.push("```", "")

  // how they were sent
  L.push("## How you sent them {wide}", "")
  L.push("Who left, front to back, against what I proposed and what you told me.", "")
  L.push("```board-stickies")
  // rank 4 at the left, rank 1 at the front on the right, as in the game; one colour so the order holds
  ;[...who.entries()].reverse().forEach(([i, h]) => {
    // the first save on the road can follow a fight, so this is how they stand now, not how they left
    const worry = [h.stress >= RULE.sendBelow ? "past the stress I send them at" : "", h.affliction ? `afflicted (${h.affliction})` : "", h.quirks.some((x) => x.disease) ? `ill (${h.quirks.filter((x) => x.disease).map((x) => x.name).join(", ")})` : ""].filter(Boolean)
    const was = p && p.party[i] !== h.guid ? ` I had placed ${t.heroes.find((x) => x.guid === p.party[i])?.name ?? "another"} here.` : ""
    L.push(`- title: ${y(`Rank ${i + 1}: ${h.name}, ${h.clsName}${worry.length ? " (watch them)" : ""}`)}`, "  kind: works", `  body: ${y(`Level ${h.level}, ${h.stress} stress.${worry.length ? ` Already ${worry.join(" and ")}; watch them first.` : ""}${was}`)}`)
    rows.push([`${h.stress}`, `${h.name}'s stress on the road`, `\`persist.roster.json\` heroes.${h.guid}.m_Stress; seat from \`persist.raid.json\` party.heroes`])
  })
  const contrary = opts.checks.filter((c) => c.status === "contrary"), pending = opts.checks.filter((c) => c.status === "pending")
  if (opts.checks.length) L.push(`- title: ${y(`${opts.checks.filter((c) => c.status === "done").length} of ${opts.checks.length} of your other choices done before you left`)}`, `  kind: ${contrary.length ? "risk" : pending.length ? "model" : "works"}`, `  body: ${y([...contrary.map((c) => `Not as chosen: ${c.question} ${c.seen}.`), ...pending.map((c) => `Left undone: ${c.question} ${c.seen}.`)].join(" ") || "Everything you told me is done.")}`)
  L.push("```", "")
  L.push(...stressBars([...who.values()]))

  // what they carry
  const habit = road(t, { quest: q } as Party, opts.prices)
  L.push("## What they carry {wide}", "")
  L.push(`Their packs against what I would carry on a ${LENGTH[len]?.toLowerCase()} road (my habit), and what the coffers kept: ${coin(t.wallet.gold ?? 0)}.${opts.pack?.slots ? ` The packs fill ${slotsOf(asPack(r.carried), opts.pack)} of their ${opts.pack.slots} slots: ${opts.pack.slots - slotsOf(asPack(r.carried), opts.pack)} stay free for what they find.` : ""}`, "")
  L.push("```board-stickies")
  for (const i of habit) {
    const has = r.carried[i.id] ?? 0
    L.push(`- title: ${y(`${i.label}: ${has} carried, ${i.count} by my habit`)}`, `  kind: ${has >= i.count ? "works" : "risk"}`, `  body: ${y((has >= i.count ? "Enough, by my reckoning." : has === 0 ? `None at all. ${i.id === "bandage" ? "Foes you know there have bled you before." : i.id === "antivenom" ? "Foes you know there have poisoned you before." : "Spend what else they carry with care."}` : `${i.count - has} short of what I would carry. Spend ${i.label.toLowerCase()} only when you must.`) + (i.why ? ` What I learnt: ${i.why}.` : ""))}`)
    rows.push([`${has}`, `${i.label} carried`, "`persist.raid.json` party.inventory"])
  }
  for (const [id, n] of Object.entries(r.carried)) {
    if (habit.some((i) => i.id === id)) continue
    L.push(`- title: ${y(`Also in the packs: ${n} ${id.replace(/_/g, " ")}`)}`, "  kind: idea", `  body: ${y(t.supply[id] || "Something for the road.")}`)
  }
  L.push("```", "")

  // foes known there
  L.push(`## What waits in the ${q.dungeonName} {wide}`, "")
  L.push("Only the foes your heroes have fought where they have walked; of the rest I say nothing.", "")
  L.push("```board-stickies")
  if (q.known.length) L.push(`- title: ${y(`Foes you know there: ${q.known.length}`)}`, "  kind: model", `  body: ${y(`${q.known.join(", ")}.${q.unknownCount ? ` And ${q.unknownCount} kind${q.unknownCount === 1 ? "" : "s"} you have not met.` : ""}`)}`)
  else L.push(`- title: ${y("You have not walked it before")}`, "  kind: risk", `  body: ${y("I will not speak of what lives there. Go carefully.")}`)
  if (q.bleeders.length) L.push(`- title: ${y(`They bleed you: ${q.bleeders.length}`)}`, `  kind: ${(r.carried.bandage ?? 0) ? "works" : "risk"}`, `  body: ${y(`${q.bleeders.join(", ")}. ${(r.carried.bandage ?? 0) ? `You carry ${r.carried.bandage} bandage${r.carried.bandage === 1 ? "" : "s"}.` : "You carry no bandages."}`)}`)
  if (q.blighters.length) L.push(`- title: ${y(`They poison you: ${q.blighters.length}`)}`, `  kind: ${(r.carried.antivenom ?? 0) ? "works" : "risk"}`, `  body: ${y(`${q.blighters.join(", ")}. ${(r.carried.antivenom ?? 0) ? `You carry ${r.carried.antivenom} antivenom.` : "You carry no antivenom."}`)}`)
  L.push("```", "")

  // when to turn back
  L.push("## When I would turn back {wide}", "")
  L.push("My habits, nothing more; you are the one in the dark.", "")
  L.push("```board-stickies")
  L.push(`- title: ${y(`When ${RULE.turnBackBroken} of the four have broken`)}`, "  kind: gotcha", `  body: ${y("One broken hero can be carried home. Two, and the rest follow them down. Bring them home while you still can.")}`)
  L.push(`- title: ${y("When the food and the light are both gone")}`, "  kind: gotcha", `  body: ${y("A hungry party in the dark is a party I bury. Whatever is left undone will still be there next week.")}`)
  L.push("```", "")

  L.push("## Go well {wide}", "")
  L.push(`Go now. I will keep the gate, and a lamp in the window for ${names.length === 4 ? `all four of them` : "each of them"}. Come back with ${names.join(", ").replace(/, ([^,]*)$/, " and $1")}, and the ledgers will be open when you do.`, "")

  const S = [`# Where each figure comes from, departure in week ${t.week}`, "", "Every number on the farewell beside the save field or game file it was read from (C14). Counts labelled my habit are RULE values.", "", "| Figure | What | Read from |", "|---|---|---|"]
  for (const i of habit) rows.push([`${i.count}`, `${i.label}, my habit`, "RULE_FOOD and RULE_PROVISION in `advise.ts`"])
  rows.push([`${t.wallet.gold ?? 0}`, "gold in the coffers", "`persist.estate.json` wallet"])
  for (const [n, what, from] of rows) S.push(`| ${n} | ${what} | ${from} |`)
  return { board: L.join("\n"), sources: S.join("\n") }
}

/** Builds the farewell board for the expedition under way. */
export async function buildFarewell(t: Town): Promise<string> {
  mkdirSync(join(outDir(), "img"), { recursive: true })
  const f = Bun.file(join(outDir(), "proposal.json"))
  const proposal = (await f.exists()) ? ((await f.json()) as Proposal) : undefined
  // U33: the farewell weighs the packs by the same habit the provisions table set, lessons learnt included (C42)
  t.ledger = await loadLedger()
  const { board, sources } = farewellSource(t, t.raid!, { proposal, checks: reconcile(await loadPicks(outDir()), t), prices: await supplyPrices(), pack: await packRules() })
  return compile(board, sources)
}
