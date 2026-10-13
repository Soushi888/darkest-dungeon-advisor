// Writes the town board: a niceboard source in the Caretaker's voice, the portraits it shows, and the
// compiled page. One fixed file name, so the picks a reader makes survive every rebuild of the board.
// The board speaks only as the Caretaker, in the Hamlet's own words (C13): no file, field or save is named on it.
// Where each figure comes from goes to sources.md beside it (C14).
import { coin } from "./words.ts"
import { teachings } from "../road/teach.ts"
import { campTell } from "../caretaker/camp.ts"
import { ROLE_WORDS } from "../caretaker/roles.ts"
import { packRules, type PackRules } from "../caretaker/pack.ts"
import { upkeepWords } from "../caretaker/upkeep.ts"
import { checkTale } from "../road/talecheck.ts"
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { DOCTRINE, type Advice, type Party } from "../caretaker/advise.ts"
import { farewellPlan, plan, prepare, saving, taleHealers, theWeek, type Mix, type Saving } from "../caretaker/plan.ts"
import { weekStartOf, type RosterLedger, type WeekStart } from "../world/week.ts"
import { campingSkills, supplyPrices, type CampSkill, nameOf } from "../sources/game.ts"
import { install, outDir, root } from "../sources/paths.ts"
import { DIFFICULTY, LENGTH, questLabel, type HeroView, type Town, type Upgrade } from "../world/town.ts"
import { buildSkin } from "./skin.ts"
import { loadPicks, reconcile, type Check } from "../world/reconcile.ts"
import { contradictions } from "./coherence.ts"
import { beats, chronicleFor, heirloomTrips, debrief, judge, loadLedger, remember, type Beat, type Debrief, type Lesson } from "../road/chronicle.ts"
import { dungeonMonsters, specialFoes } from "../sources/game.ts"
import { meetings } from "../road/foes.ts"
import { habitGroups, ROAD_HABIT_FROM } from "../caretaker/rules.ts"

const BOARD = process.env.NICEBOARD ?? join(homedir(), ".claude/skills/Niceboard/Tools/Board.ts")
const y = (s: string) => JSON.stringify(s) // a JSON string is a valid YAML scalar, quotes and colons included
const HABIT = "(my habit)" // how a RULE number is labelled on the board, in his voice (A2)
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
export function source(t: Town, a: Advice, opts: { foresight: boolean; answers: Answers; own?: Party; checks?: Check[]; prices?: Map<string, number>; soFar?: string[]; real?: Town; newcomers?: Set<number>; placed?: Map<number, string>; tale?: Tale; camp?: Map<string, CampSkill>; sent?: Proposal; rates?: Record<string, { trips: number; got: number }>; pack?: PackRules }): { board: string; sources: string } {
  const L: string[] = []
  // C111: every decision below is the plan's; this function only words it
  const P = plan(t, a, opts)
  const { chosen, gold, roadItems, reserve } = P, W = P.words
  // B3: what a lean short of gold quotes is the gold still free when it was decided, in the order the gold is spent
  const firstRoad = (left: number) => left >= P.free
    ? `the road comes first: I keep ${coin(reserve)} for provisions, and ${P.free ? `only ${coin(P.free)} is` : "nothing is"} free`
    : `the road comes first, then what I would spend before this: I keep ${coin(reserve)} for provisions, and ${left ? `only ${coin(left)} is` : "nothing is"} left`

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
    for (const { hero: h, worn } of P.back!.home) {
      const marks = [h.affliction ? `afflicted (${h.affliction})` : "", h.quirks.filter((q) => q.disease).map((q) => `ill (${q.name})`).join(", "), `${h.stress} stress`].filter(Boolean)
      L.push(`- title: ${y(`${h.name} is home`)}`, `  kind: ${worn ? "gotcha" : "works"}`, `  body: ${y(`${h.clsName}, level ${h.level}: ${marks.join(", ")}.`)}`)
    }
    L.push("```", "")
    L.push(GAUGE, "", ...stressBars(home))
    // the bridge: who the road has taken out of this week's plan, what was lost, and where that leaves the next coach
    const { resting, lostHealers: lostHeal, healers } = P.back!
    const healerWhy = (w: (typeof healers)[number]["why"]) => !w ? "" : w.kind === "busy" ? `in the ${w.where} this week` : w.kind === "afflicted" ? "afflicted" : w.kind === "ill" ? "ill" : `${w.stress} stress, too worn to send`
    const bridge = [
      resting.length ? `${resting.join(", ")} ${resting.length === 1 ? "needs" : "need"} the Abbey, the Tavern or the Sanitarium before the dark again, so they stay out of this week's four.` : "Nobody who went needs to sit out this week.",
      lostHeal.length ? `With ${lostHeal.join(" and ")} gone, ${healers.length ? `the healers left on the roster are ${healers.map((x) => { const why = healerWhy(x.why); return `${x.name} (${x.skill}, about ${x.avg} a cast${x.going ? ", and going" : why ? `; ${why}` : ""})` }).join(", ")}.` : "nobody left on the roster has a true heal: I would look to the coach for one."}` : "",
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
    const r = P.readiness!
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
    if (P.roadPaid) L.push(`- title: ${y(`${coin(reserve)} kept for the road to the ${chosen.quest.dungeonName}`)}`, "  kind: works", `  body: ${y(`Food, torches and the rest, at the Provisioner's prices. ${coin(P.free)} is free to spend; every lean below stays within it.`)}`)
    else L.push(`- title: ${y(`The coffers cannot pay for the road: ${coin(P.short)} short`)}`, "  kind: risk", `  body: ${y(`The road to the ${chosen.quest.dungeonName} wants ${coin(reserve)} of provisions and you have ${coin(gold)}. Spend nothing else this week and buy food and torches first.${P.shorterRoad ? " A shorter road is wiser than a hungry one." : ""}`)}`)
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
    const hard = P.expedition.untried.map((p) => questLabel(p).split(":")[0])
    const untriedNote = hard.length ? ` No road of mine yet has been as dangerous as ${hard.join(", ")}: my habits are untried there, so I carry a margin of light and food.` : ""
    L.push(`- q: "Which expedition next?"`, `  context: ${y(`${twinNote.trim()}${untriedNote}${twinNote || untriedNote ? " " : ""}Your heroes able to go now (under ${W.sendBelow} stress, not afflicted, not ill, not in a building): ${a.ready.map((h) => h.name).join(", ")}.`)}`, "  options:")
    for (const { party: p, bears, meanLevel } of P.expedition.roads) {
      const q = p.quest
      const foes = q.walked ? (q.known.length ? `foes you know: ${q.known.slice(0, 6).join(", ")}${q.known.length > 6 ? ` and ${q.known.length - 6} more` : ""}; ${q.unknownCount} kind${q.unknownCount === 1 ? "" : "s"} you have not met` : `${q.unknownCount} kind${q.unknownCount === 1 ? "" : "s"} of foe you have not met`) : "you have never walked it; I will not speak of what lives there"
      // foresight speaks only about the expedition being prepared (C7)
      const rumour = opts.foresight && p === chosen && q.unknownCount ? ` Foresight: travellers speak of ${q.unknownTypes.length ? q.unknownTypes.join(" and ") + " things" : "things I cannot name"} there that you have not met.` : ""
      L.push(`    - pick: ${y(questLabel(p))}`, `      effect: ${y(`${DIFFICULTY[q.difficulty] ? `${DIFFICULTY[q.difficulty]} (level ${q.difficulty})` : `level ${q.difficulty}`}${bears ? "" : `, beyond what the four can bear: their mean level is ${meanLevel.toFixed(1)} (my habit)`}; rewards ${q.rewards.join(", ")}; ${foes}.${rumour}`)}`)
    }
    const ex = P.expedition
    L.push(`  lean: ${ex.lean}`, `  lean_why: ${y(`the four I would send fit it best: ${chosen ? chosen.seats.flatMap((s) => s.notes).join(", ") || "ranks and skills line up" : ""}${ex.learners.length ? `; it takes ${ex.learners.join(" and ")} along to learn (my order: newcomers ride on short roads)` : ""}${chosen?.left !== undefined ? `; it leaves ${coin(Math.max(0, chosen.left))} in the coffers after the road` : ""}${ex.greenKeptShort ? "; with so many of them untried, I keep them to shorter roads" : ""} (my habits).`)}`)
    if (chosen) {
      L.push(`- q: ${y(`Take this party to the ${chosen.quest.dungeonName}?`)}`)
      L.push(`  context: ${y(`${opts.own ? "The four you named, seated as you gave them. " : ""}Front to back: ${chosen.seats.map((s) => `${s.rank}. ${s.hero.name} (${s.hero.clsName}, ${s.hero.stress} stress)`).join("; ")}. ${chosen.healer ? `A healer is in it: ${chosen.heal!.by}'s ${chosen.heal!.skill}, about ${chosen.heal!.avg} hit points a cast.` : chosen.heal ? `No true healer: only ${chosen.heal.by}'s ${chosen.heal.skill}, about ${chosen.heal.avg} hit points a cast.` : "No healer in it."} ${chosen.stunner ? "So is a stun." : "No stun."}${chosen.reach ? ` From these seats they can strike ${chosen.reach.length === 4 ? "every rank of the enemy line" : `enemy rank${chosen.reach.length === 1 ? "" : "s"} ${chosen.reach.join(", ")}, and none of them the ${[1, 2, 3, 4].filter((e) => !chosen.reach!.includes(e)).join(" or ")}`}.` : ""}${chosen.pair ? ` ${chosen.pair.marker === chosen.pair.striker ? `${chosen.pair.marker} marks a foe with ${chosen.pair.mark} and strikes the marked harder with ${chosen.pair.strike}.` : `${chosen.pair.marker} marks a foe with ${chosen.pair.mark}, and ${chosen.pair.striker}'s ${chosen.pair.strike} strikes the marked harder.`}` : ""}${mixWords(P.expedition.mix)}`)}`, "  options:")
      L.push(`    - pick: "Yes, this four"`, `      effect: ${y("Embark with them in this order; each one's equipped skills reach from their rank.")}`)
      L.push(`    - pick: "No, I choose my own"`, `      effect: ${y("Write your four in the note below, front to back, and send them to me; I will look them over before the coach leaves.")}`)
      const pw = P.expedition.partyWhy
      const not = [pw.unpaid ? `the coffers cannot pay for the road: ${coin(P.short)} short` : "", pw.beyond ? `the road is beyond what they can bear: their mean level is ${pw.meanLevel.toFixed(1)}, against its danger level ${pw.danger} (my habit)` : ""].filter(Boolean)
      L.push(`  lean: ${P.expedition.partyLean}`, `  lean_why: ${y(not.length ? `I would not send them like this: ${not.join("; and ")}.` : "of those fit to go, they stand best where I would place them, by my reckoning of what each can do from there.")}`)
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
      L.push(`  body: ${y(`${s.hero.clsName}, level ${s.hero.level}, ${s.hero.stress} stress. Skills that reach from here: ${s.skills.join(", ")}.${s.swaps?.length ? ` Before the coach leaves, equip ${s.swaps.map((w) => `${w.equip}${w.for ? ` in place of ${w.for}` : ""}`).join(", and ")}.` : ""}${s.learn ? ` Worth learning at the Guild for this seat: ${s.learn.skill}, ${coin(P.expedition.learnPrice.get(s.hero.name)!)}.` : ""}${s.notes.length ? ` Quirks that matter here: ${s.notes.join(", ")}.` : ""}`)}`)
    }
    for (const n of chosen.notes) L.push(`- title: ${y("Mind this")}`, "  kind: risk", `  body: ${y(n)}`)
    L.push("```", "")
    L.push(...stressBars(chosen.seats.map((x) => x.hero)))
  }

  // relief
  L.push("## Who rests, who prays {wide}", "")
  L.push(`The ones the dark has worn down, where the Abbey and the Tavern can take them as the estate has built them up, and the places their own habits forbid them. My habit: anyone at ${W.restAbove} stress or more rests before going out again. ${GAUGE}`, "")
  L.push(...stressBars([...t.heroes].filter((h) => h.stress > 0).sort((x, y) => y.stress - x.stress)))
  // each card is filed under the building I lean it to, so the section reads building by building (Soushi, 2026-10-11:
  // "organise this section by building you suggest"); a card leaned to wait is filed last
  const cards: string[] = [], filed: { at: number; place: string }[] = []
  for (const { relief: r, lean, why, filedUnder, left } of P.relief) {
    const at = cards.length
    cards.push(`- q: ${y(`Where does ${r.hero.name} go?`)}`, `  image: ${y(portrait(r.hero))}`)
    cards.push(`  context: ${y(`${r.hero.name}, ${r.hero.clsName} level ${r.hero.level}: ${r.why.join(", ")}.`)}`, "  options:")
    for (const o of r.options) cards.push(`    - pick: ${y(o.activity.name)}`, `      effect: ${y(`${o.note}${r.hero.affliction ? `; ${Math.round(o.activity.cure * 100)}% chance to cure the affliction` : ""}.`)}`)
    cards.push(`    - pick: "Leave them be"`, `      effect: ${y("Free; they stay at their stress and wait for next week.")}`)
    const lw = why.kind === "dismiss" ? "I would rather let them go than pay for their rest; see Who stays, who goes."
      : why.kind === "paid" ? `already there this week, and paid for: the ${why.place} keeps them.`
      : why.kind === "cheapest" ? `the cheapest place they accept that has a free seat (${why.note}).`
      : why.kind === "taken" ? `the seats they could take (${why.places.join(", ")}) I have already leaned to someone above.`
      : `${firstRoad(left)}.`
    cards.push(`  lean: ${lean}`, `  lean_why: ${y(lw)}`)
    // each card is filed under the building the plan leans it to (decision 15)
    filed.push({ at, place: filedUnder })
  }
  // a card exists only where the plan found the ward, so each card carries it
  for (const { hero: h, lean, why, filedUnder, left } of P.ward?.cards ?? []) {
    const ward = P.ward!.ward
    const at = cards.length
    const ill = h.quirks.filter((q) => q.disease).map((q) => q.name).join(", ")
    cards.push(`- q: ${y(`Treat ${h.name}'s ${ill}?`)}`, `  image: ${y(portrait(h))}`)
    cards.push(`  context: ${y(`${h.name}, ${h.clsName} level ${h.level}, carries ${ill}. The Medical Ward has ${ward.slots} bed${ward.slots === 1 ? "" : "s"} as the Sanitarium stands, ${P.ward!.freeBeds} free this week, for ${a.disease.length} ill.`)}`, "  options:")
    cards.push(`    - pick: "Medical Ward"`, `      effect: ${y(`${coin(ward.cost)}; the disease is treated before the next expedition.`)}`)
    cards.push(`    - pick: "Not this week"`, `      effect: ${y("The disease stays; keep them out of the party.")}`)
    cards.push(`  lean: ${lean}`, `  lean_why: ${y({ paid: `already there this week, and paid for: the ${ward.name} keeps them.`, going: `${h.name} goes on the road this week: ${ill} bites only at the campfire, and this road lights none. The ward can wait for a week at home.`, bed: "the bed goes to a more experienced hero this week.", green: "a level 0 hero is cheaper to replace than to cure.", broke: `${firstRoad(left)}.`, worth: "a hero with experience is worth the bed." }[why])}`)
    filed.push({ at, place: filedUnder })
  }
  // the Treatment Ward (C25)
  const tw = P.treatment?.ward
  const waiting = P.treatment?.waiting ?? []
  for (const { treat: tr, lean, why, filedUnder, left } of P.treatment?.cards ?? []) {
    const tw = P.treatment!.ward
    filed.push({ at: cards.length, place: filedUnder })
    cards.push(`- q: ${y(`Treat ${tr.hero.name}'s ${tr.quirk.name}?`)}`, `  image: ${y(portrait(tr.hero))}`)
    cards.push(`  context: ${y(`${tr.hero.name}, ${tr.hero.clsName} level ${tr.hero.level}${tr.inParty ? ", in the party I would send" : ""}. ${tr.quirk.name}${tr.quirk.description ? `: ${tr.quirk.description}` : "."}${tr.quirk.locked ? " It has set in, and the ward asks more for it." : ""} The ${tw.name} has ${tw.slots} seat${tw.slots === 1 ? "" : "s"}, ${P.treatment!.freeSeats} free this week.`)}`, "  options:")
    cards.push(`    - pick: ${y(tw.name)}`, `      effect: ${y(`${tr.cost ? coin(tr.cost) : "free this week"}; the ward works on ${tr.quirk.name}, and ${tr.hero.name} stays in the Hamlet while it does.`)}`)
    cards.push(`    - pick: "Not this week"`, `      effect: ${y(`${tr.hero.name} keeps it for now.`)}`)
    cards.push(`  lean: ${lean}`, `  lean_why: ${y({ paid: `already there this week, and paid for: the ${tw.name} keeps them.`, inParty: `${tr.hero.name} rides with the party I would send, and a hero in the ward cannot leave with the coach; treat it in a week they stay home.`, broke: `${firstRoad(left)}.`, worth: `${tr.why}.` }[why])}`)
  }
  const stuck = P.stuck
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
    const inWard = P.treatment!.inWard
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
    L.push(`| **In all** | | | **${coin(reserve)}** | ${P.roadPaid ? `set aside in the coffers; ${coin(P.free)} left over` : `you have ${coin(gold)}: buy food and torches first`} |`, "")
    const notes = (t.event?.provisions ?? []).map((pv) => `${pv.item === "provision" ? "Food" : "Torches, shovels and the rest"} ${pv.cost ? `cost ${pv.cost <= -1 ? "nothing" : `${Math.round(-pv.cost * 100)}% less`}` : `come in ${Math.round(-pv.amount * 100)}% smaller lots`} this week, for the ${t.event!.title}.`)
    // firewood's price in the item list is 0: it is taken, not bought. The count the camp needs is the game's to show
    if (P.provisions!.firewood) notes.push(`This road has a camp: take firewood from the Provisioner before you leave; it costs ${coin(opts.prices?.get("firewood") ?? 0)}.`)
    if (notes.length) L.push(notes.join(" "), "")
    // C79: the pack's slots, from the game's files; the buy list against what stays free for what they find
    const pk = P.provisions!.pack
    if (pk) {
      L.push(`**The packs.** This takes ${pk.used} of the pack's ${pk.slots} slots and leaves ${pk.free} free for what they find. ${pk.enough ? `That is room enough (my habit: at least ${W.packFree}).` : `I like at least ${W.packFree} free (my habit). ${pk.cut.length ? `To free a slot, leave behind ${pk.cut.map((c) => `${c.n} ${c.key === "food" ? "food" : c.key.replace(/_/g, " ")}`).join(", or ")}.` : "Every stack is full, so each slot freed costs a whole stack."}`}`, "")
    }
  }

  // guild and blacksmith
  L.push("## The Guild and the Blacksmith {wide}", "")
  L.push(`What the trainers and the smith can teach the party next, and at what price: the Guild knocks ${Math.round(t.skillDiscount * 100)}% off its lessons and the Blacksmith ${Math.round(t.gearDiscount * 100)}% off his work, for what the estate has already paid them.`, "")
  // C78: the upkeep of the four who leave, one plan per hero, from the gold the road leaves free (Soushi, 06:42: "ensure the heroes
  // that go in expedition are well upgraded so we take the opportunity each time to maintain and upgrade the roster")
  if (chosen) {
    const plan = P.upkeep!
    L.push(`**Before the coach leaves, the four's upkeep (my habit).** ${!P.roadPaid ? `The road's provisions cost ${coin(reserve)} and the coffers hold ${coin(gold)}: the road itself is ${coin(P.short)} short, so nothing is free for the rest.` : `${coin(plan.free)} is free once the road's provisions are kept back.`} ${!P.roadPaid ? "When gold is free, I spend it" : "I would spend it"} in this order: healing, then the weapon and the armour, then the other skills they carry from their seats, then a camping skill if the road camps. That spends ${coin(plan.spent)} and leaves ${coin(plan.left)}. A skill they do not carry from their seat is not worth the gold this week, and a hero I would dismiss gets nothing.`, "")
    // one colour for all four, so the board keeps them in seat order (it groups stickies by colour)
    L.push("```board-stickies")
    for (const s of chosen.seats) {
      const mine = plan.lines.filter((l) => l.item.hero === s.hero.name)
      if (!mine.length) continue
      // what an item waits on is named in the Hamlet's words
      const said = (l: (typeof mine)[number]) => upkeepWords(l.item.blockedBy ? { ...l, item: { ...l.item, blockedBy: inWords(l.item.blockedBy) } } : l, coin)
      L.push(`- title: ${y(`${s.hero.name}'s upkeep`)}`, "  kind: model", `  body: ${y(`${mine.map(said).join("; ")}.`.replace(/^./, (c) => c.toUpperCase()))}`)
    }
    L.push("```", "")
  }
  if (P.train) {
    L.push("```board-decisions")
    const preferred = opts.answers.preferred ?? []
    L.push(`- q: "What do we train first?"`, `  context: ${y(`You have ${coin(gold)}. These are the party's upgrades you can afford now, cheapest first.${preferred.length ? ` The skills you prefer: ${preferred.join(", ")}.` : " Name the skills you prefer in a note here and I will train them first."}`)}`, "  options:")
    const { shown, lean, why, liked } = P.train
    for (const u of shown) L.push(`    - pick: ${y(u.learn ? `${u.hero}: learn ${u.label}` : `${u.hero}: ${u.label} to level ${u.toLevel}`)}`, `      effect: ${y(`${coin(u.cost.find((c) => c.type === "gold")?.amount ?? 0)} at the Guild${u.learn ? `; a new heal, about ${u.learn.heals} hit points a cast, cast from ${u.hero}'s seat` : ""}.`.replace("at the Guild", `at the ${u.where}`))}`)
    L.push(`    - pick: "Keep the gold"`, `      effect: ${y("Spend nothing at the Guild or the Blacksmith this week.")}`)
    L.push(`  lean: ${lean}`, `  lean_why: ${y({ liked: `you prefer ${liked?.label}, so it comes first (your choice, not my habit).`, heal: "the party's healing is what brings everyone home.", cheap: "the cheapest step for the hero who fights most.", broke: `${firstRoad(P.train.left)}.` }[why])}`)
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
  if (opts.camp && chosen && P.camp) {
    const camp = opts.camp, off = t.campDiscount
    const tell = campTell
    const { camps, best } = P.camp
    L.push("## The Survivalist {wide}", "")
    L.push(`The Survivalist teaches the skills a hero uses at the campfire, which only a medium or long road gives them the night for. ${off ? `He knocks ${Math.round(off * 100)}% off his lessons for what the estate has paid him.` : ""} ${camps ? `This week's road camps, so what they carry to the fire matters now.` : `This week's road is short and does not camp: what they learn here waits for a longer road.`}`.replace(/\s+/g, " ").trim(), "")
    L.push("```board-stickies")
    for (const { hero: h, known, open, price } of P.camp.seats) {
      const taken = h.campEquipped ?? []
      const line = (id: string) => { const k = camp.get(id); return k ? `${k.name} (${tell(k)})` : id }
      L.push(`- title: ${y(`${h.name}, ${h.clsName}, at the campfire`)}`, "  kind: model",
        `  body: ${y(`Takes to camp: ${taken.map(line).join(", ") || "nothing yet"}.${known.length > taken.length ? ` Also knows: ${known.filter((x) => !taken.includes(x)).map((id) => camp.get(id)?.name ?? id).join(", ")}.` : ""}${open ? ` Worth learning: ${line(open.id)}, ${coin(price)}.` : " Knows every camping skill the Survivalist can teach them."}`)}`)
    }
    L.push("```", "")
    if (best.length) {
      L.push("```board-decisions", `- q: "What do we teach at the Survivalist?"`, `  context: ${y(`The best lesson for each of the four, by my habit of weighing a camping skill (stress relieved by how many it reaches, health healed, a cure or a guard on the camp, a boon for the next fight). ${camps ? "This road camps." : "This road does not camp."}`)}`, "  options:")
      for (const b of best) L.push(`    - pick: ${y(`${b.hero.name}: ${b.k.name}`)}`, `      effect: ${y(`${coin(b.price)} at the Survivalist; ${tell(b.k)}.`)}`)
      L.push(`    - pick: "Keep the gold"`, `      effect: ${y("Teach nothing at the Survivalist this week.")}`)
      L.push(`  lean: ${P.camp.lean}`, `  lean_why: ${y({ worth: `the most worth at the fire for this road, within the gold left.`, broke: `${firstRoad(P.camp.left)}.`, "no-camp": "this road does not camp; the gold serves better elsewhere this week." }[P.camp.why])}`, "```", "")
    }
  }

  // roster
  L.push("## Who stays, who goes {wide}", "")
  // C29: recruits share the places the roster has, counting the ones my dismissals would free (Soushi, 2026-10-10)
  const { places, taken, fill } = P.roster
  // a dismissal the plan adds for a recruit (decision 28), in words
  const dismiss = P.roster.dismiss.map((d) => ({ hero: d.hero, why: d.why ?? `level 0 with ${d.swap!.bad} bad quirks and ${d.swap!.good} good; ${d.swap!.fill ? `${d.swap!.recruit.hero.name} at the coach brings the ${d.swap!.fill.gap === "healer" ? "true healer" : "stun"} the four lack` : `${d.swap!.recruit.hero.name} at the coach would serve you better`}` }))
  L.push(`${t.rosterSize} names on the roster, room for ${t.rosterCap} as the Stage Coach stands: ${P.roster.free} place${P.roster.free === 1 ? "" : "s"} free${dismiss.length ? `, ${places} if you let go of the ones I name` : ""}. My habit: a hero still at level 0 with ${W.dismissNegatives} or more bad quirks, outside the party, is worth letting go, and the coach's best take the places there are.`, "")
  const rcards: string[] = []
  for (const d of dismiss) {
    rcards.push(`- q: ${y(`Dismiss ${d.hero.name}?`)}`, `  image: ${y(portrait(d.hero))}`, `  context: ${y(`${d.hero.clsName}, ${d.why}.`)}`, "  options:")
    rcards.push(`    - pick: "Dismiss"`, `      effect: ${y("Frees a place on the roster for a fresh recruit.")}`, `    - pick: "Keep"`, `      effect: ${y("They stay; their quirks can be treated at the Sanitarium for gold.")}`)
    rcards.push(`  lean: 0`, `  lean_why: ${y("a recruit costs nothing and comes without these quirks.")}`)
  }
  for (const { recruit: r, take, held, fill: filled, worth } of P.roster.recruits) {
    rcards.push(`- q: ${y(`Recruit ${r.hero.name}, ${r.hero.clsName}?`)}`, `  image: ${y(portrait(r.hero))}`, `  context: ${y(`${r.why}.`)}`, "  options:")
    rcards.push(`    - pick: "Recruit"`, `      effect: ${y(`Joins the roster at level ${r.hero.level}.`)}`, `    - pick: "Pass"`, `      effect: ${y(r.hero.from ? "Leave them at the coach." : "The coach brings others next week.")}`)
    const why = held ? `the roster already has ${/^[AEIOU]/i.test(r.hero.clsName) ? "an" : "a"} ${r.hero.clsName}, ${held.name}, and two of a class are what I would let go of` : take && filled ? `${filled.text}; there is a place for them` : take ? `${worth > 0 ? "more good quirks than bad" : "as many good quirks as bad"}, and there is a place for them` : worth < 0 ? "more bad quirks than good" : `no place left for them: ${places ? `the ${places === 1 ? "place goes" : `${places} places go`} to ${taken.map((x) => x.hero.name).join(" and ")}` : "the roster is full"}`
    rcards.push(`  lean: ${take ? 0 : 1}`, `  lean_why: ${y(`${why}.`)}`)
  }
  if (rcards.length) L.push("```board-decisions", ...rcards, "```", "")
  // C85: pairs too alike to keep both, and the coach's recruit who would round the roster out (Soushi, 07:15)
  if (a.alike.length) {
    const roleWords = (rs: string[]) => rs.map((r) => ROLE_WORDS[r as keyof typeof ROLE_WORDS]).join(", ")
    L.push("**Too alike (my habit).** Two heroes who do the same work in a fight leave a gap elsewhere. Where the coach brings someone the roster lacks, I would let the weaker of a pair go for them, even at a lower level.", "")
    const an = (w: string) => `${/^[AEIOU]/i.test(w) ? "an" : "a"} ${w}`
    const said = (p: (typeof a.alike)[number]) => `${p.keep.name} and ${p.drop.name} are too alike: ${p.shared}. ${p.why}, so ${p.keep.name} is the one I keep.`
    const { swap, wait } = P.alike
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
    const H = P.heirlooms!, coachOut = H.coachOut
    const waitsWords = (u: Upgrade) => u.blockedBy.replace(/^needs /, "").split(", ").map((w) => inWords(`needs ${w}`)).join(", ")
    const coachNote = coachOut.length ? ` Out of reach at the Stage Coach: ${coachOut.map((u) => `${u.label.replace(/^[^:]+: /, "")} (${cost(u)}; ${u.blockedBy ? `it waits on ${waitsWords(u)}` : `${short(u)} short`})`).join("; ")}.` : ""
    if (H.card) {
      L.push("```board-decisions")
      L.push(`- q: "Where do the heirlooms go?"`, `  context: ${y(`The estate holds ${t.wallet.crest ?? 0} crests, ${t.wallet.bust ?? 0} busts, ${t.wallet.portrait ?? 0} portraits, ${t.wallet.deed ?? 0} deeds.${coachNote}`)}`, "  options:")
      for (const u of a.heirlooms) L.push(`    - pick: ${y(u.label)}`, `      effect: ${y(`costs ${u.cost.map((c) => `${c.amount} ${c.type}s`).join(" and ")}.`)}`)
      L.push(`    - pick: "Save them"`, `      effect: ${y("Keep the heirlooms for a bigger upgrade later.")}`)
      const { opens, why: w } = H, seasoned = H.seasoned
      const youngWhy = w.kind.startsWith("young") ? `my habit: ${H.young!.low} of your ${H.young!.of} heroes are level 1 or lower, so the Stage Coach's seasoned recruits come first` : ""
      const why = w.kind === "young-seasoned" ? `${youngWhy}.`
        : w.kind === "young-step" ? `${youngWhy}, and the road to them can start tonight: ${a.heirlooms[w.step]!.label} is one of its steps${opens[w.step]?.length ? `, and it opens what the party is waiting for: ${opens[w.step]!.map((b) => `${b.hero} ${b.label}`).join(", ")}` : ""}.`
        : w.kind === "young-waits" ? `${youngWhy}; I keep the heirlooms for them, and the road to them comes first: it waits on ${waitsWords(seasoned!)}.`
        : w.kind === "young-short" ? `${youngWhy}; I keep the heirlooms for them, ${cost(seasoned!)}, ${short(seasoned!)} short.`
        : w.kind === "opens" ? `it opens what the party is waiting for: ${opens[w.most]!.map((b) => `${b.hero} ${b.label}`).join(", ")}.`
        : w.kind === "sanitarium" ? `${a.disease.length} of your heroes are ill; cheaper treatment pays back quickly.`
        : w.kind === "relief" ? `my order puts stress next, and this week I lean heroes to the ${w.place}: improving it serves them now and every week after.`
        : w.kind === "cut" ? `my order puts the gold next: the party ${w.guild ? "trains at the Guild" : "is armed at the Blacksmith"} this week, and a lower price there pays back every week.`
        : "nothing affordable opens anything the party is waiting for."
      L.push(`  lean: ${H.lean}`, `  lean_why: ${y(why)}`)
      L.push("```", "")
      // U22: saving is a plan, not a wait (Soushi, 05:22: "when you propose to save for later, at least give a vision")
      if (H.saving) L.push(...savingWords(H.saving))
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
  // B8: every dismissal on the board, the ones made for a recruit at the coach included
  for (const h of [...a.relief.map((r) => r.hero), ...a.disease, ...(chosen?.seats.map((x) => x.hero) ?? []), ...P.roster.dismiss.map((d) => d.hero)]) {
    if (shown.has(h.guid)) continue
    shown.add(h.guid)
    rows.push([`${h.stress}`, `${h.name}'s stress`, `\`persist.roster.json\` heroes.${h.guid}.m_Stress`])
    rows.push([`${h.level}`, `${h.name}'s level`, `resolveXp ${h.xp} against \`roster.variables.json\` resolve_level_thresholds`])
  }
  for (const d of P.roster.dismiss) if (d.swap) rows.push([`${d.swap.bad}`, `${d.hero.name}'s bad quirks`, `\`persist.roster.json\` heroes.${d.hero.guid} quirks, negative and not diseases, by \`shared/quirk/quirk_library.json\``], [`${d.swap.good}`, `${d.hero.name}'s good quirks`, `\`persist.roster.json\` heroes.${d.hero.guid} quirks, positive, by \`shared/quirk/quirk_library.json\``])
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
  for (const [group, habits] of habitGroups()) H(group, habits.map((h): [string, string] => [h.words, h.value()]))

  const S: string[] = [`# Where each figure comes from, week ${t.week}`, "", "Every number on the town board beside the save field or game file it was read from (C14). Numbers labelled (my habit) on the board are RULE values and are not here.", ""]
  S.push("| Figure | What | Read from |", "|---|---|---|")
  for (const [n, what, from] of rows) S.push(`| ${n} | ${what.replace(/\|/g, "/")} | ${from} |`)
  S.push("", `Save copied from your Steam profile to \`.dd-runtime/profile/\` and decoded there; your files are never written. Game data read from the install. ${t.witnessedSkills} enemy attacks witnessed, dungeons walked: ${t.visited.join(", ") || "none"}. Rules of mine on this page: rest at ${W.restAbove} stress, send under ${W.sendBelow}, let go of level 0 heroes with ${W.dismissNegatives}+ bad quirks.`, "")
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
    const healers = await taleHealers(t)
    const healer = healers.length > 0
    const first = snaps[0]
    const base = { dungeon: t.back.dungeon, difficulty: first?.difficulty ?? 0, length: t.back.length, week: t.week - 1, trip: `${t.back.dungeonName}, week ${t.week - 1}` }
    const j = judge(snaps, bs, { ...base, dungeonName: t.back.dungeonName, success: t.back.success, healer })
    // C102: what the road taught about the foes and the four, kept beside what it used
    // C106: the special foes met on the road, kept so the next road is advised by them
    const met = meetings(snaps, await specialFoes(base.dungeon, base.difficulty), new Set(await dungeonMonsters(base.dungeon, base.difficulty, ["hall", "room"])))
    const taught = teachings(snaps, bs, db, base, healers, met, `the ${t.back.dungeonName}`)
    j.lessons.push(...taught.lessons)
    if (snaps.length > 1) await remember(j.lessons)
    tale = { snaps: snaps.length, beats: bs, ...j, debrief: db, issues: check.issues, taught: taught.lines }
  }
  t.ledger = await loadLedger()
  // the week's first board keeps the Hamlet as it found it (C26)
  const wsFile = Bun.file(join(outDir(), "week-start.json"))
  let start = (await wsFile.exists()) ? ((await wsFile.json()) as WeekStart) : undefined
  if (!start || start.week !== t.week) {
    start = weekStartOf(t)
    await Bun.write(wsFile, JSON.stringify(start, null, 1))
  }
  // C90: the week is advised from the Hamlet as the week found it, so following a pick never moves the others; the seats, the
  // beds and the gold handed out, and what was done (the picks' checks, "This week so far"), are the save's (Soushi, 2026-10-13:
  // "ensure the proposed strategies are coherent and while I apply it it doesn't break the recommendations")
  const ledgerFile = Bun.file(join(outDir(), "roster-ledger.json"))
  const week = theWeek(t, start, (await ledgerFile.exists()) ? ((await ledgerFile.json()) as RosterLedger) : undefined)
  await Bun.write(ledgerFile, JSON.stringify(week.ledger, null, 1))
  const { real, placed, newcomers } = week
  t = week.planned
  // my reading of the week, and a party Soushi named in a note, seated for the expedition he picked
  const { a, own, chosen, picked } = await prepare(t, answers)
  const checks = reconcile(await loadPicks(outDir()), real)
  // what was proposed the week they left: kept per week, else the last proposal when it is that week's (#3)
  let sent: Proposal | undefined
  if (t.back) for (const f of [join(outDir(), "proposals", `week-${t.week - 1}.json`), join(outDir(), "proposal.json")]) {
    const p = await Bun.file(f).json().catch(() => undefined) as Proposal | undefined
    if (p && p.week === t.week - 1) { sent = p; break }
  }
  // what each heirloom came home at, per recorded trip (U22)
  const rates = Object.fromEntries(await Promise.all(["crest", "bust", "portrait", "deed"].map(async (k) => [k, await heirloomTrips(k)] as const)))
  const { board, sources } = source(t, a, { foresight: !!opts.foresight, answers, own, checks, prices: await supplyPrices(), soFar: weekSoFar(real, start), real, placed, newcomers, tale, camp: await campingSkills(), sent, rates, pack: await packRules() })
  // C38: every build is read back for advice that contradicts itself; the live session is told through coherence.json
  const clash = [...contradictions(board), ...(tale?.issues ?? [])]
  await Bun.write(join(outDir(), "coherence.json"), JSON.stringify({ week: t.week, contradictions: clash }, null, 1))
  if (clash.length) console.log(`INCOHERENT week ${t.week}: ${clash.join(" | ")}`)
  // what the Caretaker proposed this week, for the farewell to judge the departure against (C24)
  if (chosen) {
    // kept per week too, so the return a week later still knows what was proposed and picked when they left (#3)
    const prop: Proposal = { week: t.week, dungeon: chosen.quest.dungeon, length: chosen.quest.length, type: chosen.quest.type, label: questLabel(chosen), party: chosen.seats.map((x) => x.hero.guid), own: !!own, picked }
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
function mixWords(m: Mix): string {
  if (m?.kind === "with") return ` A seasoned hero goes with newcomers (my habit): ${m.vet.name}, level ${m.vet.level}, beside ${m.green.join(", ")}.`
  return m?.kind === "suggest" ? ` All four are newcomers; my habit is to send a seasoned hero with them, such as ${m.seasoned.name}, ${m.seasoned.clsName}, level ${m.seasoned.level}.` : ""
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

/** The plan behind a lean to keep the heirlooms (U22), in words: the plan's saving (decision 32) as one sticky. */
export function savingPlan(t: Town, a: Advice, target: Upgrade, rates: Record<string, { trips: number; got: number }>): string[] {
  return savingWords(saving(t, a, target, rates))
}
function savingWords(sv: Saving): string[] {
  const { target, chain } = sv
  const lines: string[] = []
  // U29: the whole road to the target, every upgrade it waits on in an order the Hamlet allows, from the game's upgrade files
  // (Soushi, 06:16: "detail better the target we save for ... we need armorsmith first for Stage Coach seasoned recruits")
  const costs = (c: { type: string; amount: number }[]) => c.map((x) => `${x.amount} ${x.type}s`).join(" and ")
  if (chain.length > 1) {
    const step = (k: string) => chain.findIndex((x) => `${x.tree} ${x.code}` === k) + 1
    lines.push(`It waits on ${chain.length - 1} other upgrade${chain.length > 2 ? "s" : ""} first. In an order the Hamlet allows: ${chain.map((x, i) => `${i + 1}. ${x.label}, ${costs(x.cost)}, ${x.ready ? "buyable tonight" : x.waits.length ? `after ${x.waits.map((w) => step(w) ? `step ${step(w)}` : inWords(`needs ${w}`)).join(" and ")}` : `${x.missing.map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`).join(" and ")} short`}`).join("; ")}.`)
  } else lines.push(`Nothing has to be built before it: the game asks for no other upgrade first.`)
  // what the whole road costs, against what the estate holds
  if (chain.length > 1) lines.push(`The whole road costs ${sv.need.map(({ type, n, held }) => `${n} ${type}s (you hold ${held})`).join(", ")}.`)
  for (const c of sv.shorts) {
    const plural = `${c.type}s`, r = c.rate
    lines.push(`${c.short} ${plural} short.`)
    lines.push(c.roads.length ? `This week ${c.roads.length > 1 ? "these roads pay" : "this road pays"} them: ${c.roads.map((q) => `the ${q.dungeonName}, ${(LENGTH[q.length] ?? "").toLowerCase()} (${q.goal}), paying ${q.pays}`).join("; ")}.` : `No road this week pays ${plural}.`)
    lines.push(c.perTrip > 0 ? `The ${r!.trips} roads I kept the story of brought home ${r!.got} ${plural}, about ${Math.round(c.perTrip * 10) / 10} a trip; at that rate, ${c.trips} more trips.` : r?.trips ? `None of the ${r.trips} roads I kept the story of brought ${plural} home, so I cannot say how many trips.` : `I have kept no road's story yet, so I cannot say how many trips.`)
  }
  // what the rest can buy without touching what the target needs
  lines.push(sv.free.length ? `Without delaying it, the ${sv.spare.map(([k, n]) => `${n} ${k}s`).join(", ")} it does not need can pay for any one of these now: ${sv.free.map((u) => `${u.label} (${u.cost.map((c) => `${c.amount} ${c.type}s`).join(" and ")})`).join("; ")}.` : `Nothing else the heirlooms can buy now leaves the target untouched.`)
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
  // C111: the farewell's decisions are the plan's; this function only words them
  const F = farewellPlan(t, r, opts)
  const who = F.who.map((w) => w.hero)
  const names = who.map((h) => h.name)
  const p = F.proposal
  const len = Math.max(1, Math.min(3, q.length))
  L.push(`# The coach has left for the *${q.dungeonName}*`, "")
  L.push(`The wheels are past the old bridge and the road turns toward the ${q.dungeonName}. Before the sound of them is gone, here is my last word on how you sent them.`, "")
  const { sameFour, sameOrder, sameRoad } = F
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
  ;[...F.who.entries()].reverse().forEach(([i, { hero: h, worry: wr, placedInstead }]) => {
    const worry = [wr.worn ? "past the stress I send them at" : "", wr.affliction ? `afflicted (${wr.affliction})` : "", wr.ill.length ? `ill (${wr.ill.join(", ")})` : ""].filter(Boolean)
    const was = placedInstead !== undefined ? ` I had placed ${placedInstead ?? "another"} here.` : ""
    L.push(`- title: ${y(`Rank ${i + 1}: ${h.name}, ${h.clsName}${worry.length ? " (watch them)" : ""}`)}`, "  kind: works", `  body: ${y(`Level ${h.level}, ${h.stress} stress.${worry.length ? ` Already ${worry.join(" and ")}; watch them first.` : ""}${was}`)}`)
    rows.push([`${h.stress}`, `${h.name}'s stress on the road`, `\`persist.roster.json\` heroes.${h.guid}.m_Stress; seat from \`persist.raid.json\` party.heroes`])
  })
  const contrary = opts.checks.filter((c) => c.status === "contrary"), pending = opts.checks.filter((c) => c.status === "pending")
  if (opts.checks.length) L.push(`- title: ${y(`${opts.checks.filter((c) => c.status === "done").length} of ${opts.checks.length} of your other choices done before you left`)}`, `  kind: ${contrary.length ? "risk" : pending.length ? "model" : "works"}`, `  body: ${y([...contrary.map((c) => `Not as chosen: ${c.question} ${c.seen}.`), ...pending.map((c) => `Left undone: ${c.question} ${c.seen}.`)].join(" ") || "Everything you told me is done.")}`)
  L.push("```", "")
  L.push(...stressBars([...who.values()]))

  // what they carry
  const habit = F.carry.map((c) => c.item)
  L.push("## What they carry {wide}", "")
  L.push(`Their packs against what I would carry on a ${LENGTH[len]?.toLowerCase()} road (my habit), and what the coffers kept: ${coin(t.wallet.gold ?? 0)}.${F.pack ? ` The packs fill ${F.pack.used} of their ${F.pack.slots} slots: ${F.pack.free} stay free for what they find.` : ""}`, "")
  L.push("```board-stickies")
  for (const { item: i, has, enough } of F.carry) {
    L.push(`- title: ${y(`${i.label}: ${has} carried, ${i.count} by my habit`)}`, `  kind: ${enough ? "works" : "risk"}`, `  body: ${y((enough ? "Enough, by my reckoning." : has === 0 ? `None at all. ${i.id === "bandage" ? "Foes you know there have bled you before." : i.id === "antivenom" ? "Foes you know there have poisoned you before." : "Spend what else they carry with care."}` : `${i.count - has} short of what I would carry. Spend ${i.label.toLowerCase()} only when you must.`) + (i.why ? ` What I learnt: ${i.why}.` : ""))}`)
    rows.push([`${has}`, `${i.label} carried`, "`persist.raid.json` party.inventory"])
  }
  for (const [id, n] of F.others) {
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
  L.push(`- title: ${y(`When ${F.words.turnBackBroken} of the four have broken`)}`, "  kind: gotcha", `  body: ${y("One broken hero can be carried home. Two, and the rest follow them down. Bring them home while you still can.")}`)
  L.push(`- title: ${y("When the food and the light are both gone")}`, "  kind: gotcha", `  body: ${y("A hungry party in the dark is a party I bury. Whatever is left undone will still be there next week.")}`)
  L.push("```", "")

  L.push("## Go well {wide}", "")
  L.push(`Go now. I will keep the gate, and a lamp in the window for ${names.length === 4 ? `all four of them` : "each of them"}. Come back with ${names.join(", ").replace(/, ([^,]*)$/, " and $1")}, and the ledgers will be open when you do.`, "")

  const S = [`# Where each figure comes from, departure in week ${t.week}`, "", "Every number on the farewell beside the save field or game file it was read from (C14). Counts labelled my habit are RULE values.", "", "| Figure | What | Read from |", "|---|---|---|"]
  for (const i of habit) rows.push([`${i.count}`, `${i.label}, my habit`, ROAD_HABIT_FROM])
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
