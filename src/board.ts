// Writes the town board: a niceboard source in the Caretaker's voice, the portraits it shows, and the
// compiled page. One fixed file name, so the picks a reader makes survive every rebuild of the board.
// The board speaks only as the Caretaker, in the Hamlet's own words (C13): no file, field or save is named on it.
// Where each figure comes from goes to sources.md beside it (C14).
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { advise, readiness, road, seatParty, RULE, type Advice, type Party } from "./advise.ts"
export { road, type RoadItem } from "./advise.ts"
import { supplyPrices } from "./game.ts"
import { install, root } from "./paths.ts"
import { DIFFICULTY, LENGTH, type HeroView, type Town } from "./town.ts"
import { buildSkin } from "./skin.ts"
import { loadPicks, reconcile, type Check } from "./reconcile.ts"
import { contradictions } from "./coherence.ts"
import { beats, chronicleFor, debrief, judge, loadLedger, remember, untried, type Beat, type Debrief, type Lesson } from "./chronicle.ts"
import { heroClass } from "./game.ts"

// DD_TOWN_OUT lets the tests build elsewhere, so they never touch the live board or its picks
export const outDir = process.env.DD_TOWN_OUT ?? join(root, ".local", "town")
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
  const rel = `img/${h.cls}.png`
  if (existsSync(src)) copyFileSync(src, join(outDir, rel))
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

export interface Answers { expedition?: string; partyOwn?: boolean; partyNames?: string[] }
export async function readAnswers(): Promise<Answers> {
  const f = Bun.file(join(outDir, "answers.md"))
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
  return a
}

export function questLabel(p: Party): string {
  const q = p.quest
  // what the road pays leads, so two roads to the same dungeon read apart at a glance (Soushi, 2026-10-10)
  const gold = q.rewards.find((r) => / gold$/.test(r)), trinket = q.rewards[q.rewards.length - 1]
  const pays = [trinket, ...q.rewards.filter((r) => r !== gold && r !== trinket), gold].filter(Boolean)
  return `${q.dungeonName}, ${(LENGTH[q.length] ?? String(q.length)).toLowerCase()} ${q.type}: ${pays.join(", ")}`
}

/** The Hamlet as the week found it, kept on the first board of each week, so later boards can say what was done since (C26). */
export interface WeekStart { week: number; heroes: { guid: number; name: string }[]; bought: string[]; gold: number | null; purchases?: string[] }

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

export interface Tale { snaps: number; beats: Beat[]; well: string[]; wrong: string[]; lessons: Lesson[]; debrief?: Debrief }
export function source(t: Town, a: Advice, opts: { foresight: boolean; answers: Answers; own?: Party; checks?: Check[]; prices?: Map<string, number>; soFar?: string[]; tale?: Tale }): { board: string; sources: string } {
  const L: string[] = []
  const picked = (opts.answers.expedition && a.parties.find((p) => questLabel(p) === opts.answers.expedition)) || a.best
  const chosen = opts.own ?? picked
  const gold = t.wallet.gold ?? 0
  // C22: the road is paid for first; every spending lean below draws only on what is left after it
  const roadItems = road(t, chosen, opts.prices ?? new Map())
  const reserve = roadItems.reduce((x, i) => x + i.count * i.price, 0)
  let left = Math.max(0, gold - reserve)
  const firstRoad = `the road comes first: I keep ${coin(reserve)} for provisions, and ${left ? `only ${coin(left)} is` : "nothing is"} free`

  L.push(`# The *Hamlet*, week ${t.week}`, "")
  L.push(`You are back, and the estate stands. ${t.heroes.length} names on the roster, ${coin(gold)} in the coffers, ${t.quests_won} of ${t.quests_done} expeditions won. I have gone through the ledgers and walked the streets; here is what I would do before the coach leaves again, in the order I would do it: the estate, who stays, who rests, then the road, the training and the provisions last. Where a number is only my own habit, I say so.`, "")
  L.push("```board-idea")
  // the road chosen (his pick, or my lean) is named the same way at the top, in the readiness and in the provisions
  const roadName = chosen ? `${chosen.quest.dungeonName}, ${(LENGTH[chosen.quest.length] ?? "").toLowerCase()} ${chosen.quest.type}` : ""
  L.push(`headline: ${y(chosen ? `Next: the ${roadName},\nwith ${chosen.seats.map((s) => s.hero.name).join(", ")}.` : "Rest first.\nNo four are fit to go.")}`)
  L.push(`detail: ${y(a.afflicted.length ? `${a.afflicted.map((h) => h.name).join(" and ")} cannot be trusted in the dark until the Abbey or the Tavern has had them.` : "Nobody is afflicted. Spend on the party first, the estate second.")}`)
  L.push("```", "")

  // C37: the coach is back. What the road did to the four, then the bridge to this week's plan
  if (t.back) {
    const b = t.back, here = (g: number) => t.heroes.find((h) => h.guid === g)
    const fell = b.heroes.filter((h) => h.died), home = b.heroes.filter((h) => !h.died).map((h) => here(h.guid)).filter((h): h is HeroView => !!h)
    const road = `the ${b.dungeonName}, ${(LENGTH[b.length] ?? "").toLowerCase()} ${b.quest}`.replace(/\s+/g, " ")
    L.push("## The coach is back {wide}", "")
    L.push(`${b.success ? `They came back from ${road}, with the work done.` : `They came back from ${road}, without the work done.`} ${fell.length ? `${fell.map((h) => h.name).join(" and ")} did not come back.` : "All four came back."} Here is what the road did to them, and what it changes for the week ahead.`, "")
    // C40: the survivors' tale, from the chronicle kept on the road; C41: what went well, what went wrong
    const tale = opts.tale
    if (tale && tale.snaps > 1) {
      const told = tale.beats.map((x) => x.text)
      const turn = tale.beats.findIndex((x) => x.bad && x.kind !== "ambush" && x.kind !== "spike")
      const start = turn < 0 ? told : told.slice(0, turn), rest = turn < 0 ? [] : told.slice(turn)
      // a long road is told step by step, the turn marked, so the story reads as it happened
      if (told.length > 6) {
        L.push(`**What the survivors told me.** ${start.length ? `It began well${rest.length ? `, then it turned at step ${start.length + 1}` : ""}.` : "It went badly from the start."}`, "")
        told.forEach((x, k) => L.push(`${k + 1}. ${k === start.length && rest.length ? "**" : ""}${x[0]!.toUpperCase()}${x.slice(1)}.${k === start.length && rest.length ? "**" : ""}`))
        L.push("")
      } else L.push(`**What the survivors told me.** ${start.length ? `It began well: ${start.join(", ")}.` : "It went badly from the start."}${rest.length ? ` Then it turned: ${rest.join(", then ")}.` : " Nothing turned against them."}`, "")
      if (tale.well.length || tale.wrong.length) {
        L.push("```board-stickies")
        for (const w of tale.well) L.push(`- title: ${y(w)}`, "  kind: works")
        for (const w of tale.wrong) L.push(`- title: ${y(w)}`, "  kind: gotcha")
        L.push("```", "")
      }
      // C45: what struck them, foe by foe, and what came home
      const foes = tale.debrief?.foes.filter((f) => f.hp + f.blight + f.bleed > 0) ?? []
      if (foes.length) {
        L.push("**What struck them.** Every wound I could lay at a foe's feet, with the attacks that fit it among those your heroes have already suffered.", "")
        L.push("| Foe | Wounds | Health taken | Criticals | Attacks that fit | Blight and bleed | Hardest on |", "|---|---|---|---|---|---|---|")
        for (const f of foes) {
          const atk = Object.entries(f.attacks).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} (${n})`).join("; ") || "too few to tell"
          const dot = [f.blight ? `${f.blight} by blight` : "", f.bleed ? `${f.bleed} by bleeding` : ""].filter(Boolean).join(", ") || "none"
          const most = Object.entries(f.victims).sort((x, y) => y[1] - x[1])[0]
          L.push(`| ${f.name} | ${f.blows} | ${f.hp} | ${f.crits || "none"} | ${atk} | ${dot} | ${most ? `${most[0]} (${most[1]})` : ""} |`)
        }
        L.push("")
      }
      const loot = Object.entries(tale.debrief?.loot ?? {})
      if (loot.length) L.push(`**What came home.** ${loot.map(([k, n]) => `${n.toLocaleString("en-US")} ${k}`).join(", ")}.`, "")
      if (tale.lessons.length) L.push(`**What I will remember.** ${tale.lessons.map((l) => `In the ${b.dungeonName}: ${l.text}.`).join(" ")} I keep it for the next road there, at this level of danger or worse.`, "")
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
      chosen ? `So this week I would send ${chosen.seats.map((s) => s.hero.name).join(", ")} to the ${chosen.quest.dungeonName}${chosen.healer ? `, with ${chosen.heal!.by} to heal` : chosen.heal ? `, with only ${chosen.heal.by}'s light heal` : ", without a healer"}; the reasons are below, in the order the week is played.` : "So this week nobody is fit for the road: rest them first.",
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
  L.push(`The roads the estate can send you down this week. I name only the foes your heroes have fought, in places they have walked; of the rest I say nothing. ${opts.foresight ? "Travellers' tales do reach me, though, and where I repeat one I say so." : ""}`.trim(), "")
  if (a.parties.length) {
    L.push("```board-decisions")
    const twins = [...new Set(a.parties.map((p) => p.quest.dungeon))].filter((d) => a.parties.filter((p) => p.quest.dungeon === d).length > 1)
    const twinNote = twins.map((d) => { const ps = a.parties.filter((p) => p.quest.dungeon === d); return ` ${ps.length} roads go to the ${ps[0]!.quest.dungeonName}: ${ps.map((p) => `the ${(LENGTH[p.quest.length] ?? "").toLowerCase()} ${p.quest.type} pays ${p.quest.rewards[p.quest.rewards.length - 1]}`).join(", ")}.` }).join("")
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
    L.push(`  lean: ${Math.max(0, leanIdx)}`, `  lean_why: ${y(`the four I would send fit it best: ${chosen ? chosen.seats.flatMap((s) => s.notes).join(", ") || "ranks and skills line up" : ""}${chosen?.left !== undefined ? `; it leaves ${coin(Math.max(0, chosen.left))} in the coffers after the road` : ""}${longer ? "; with so many of them untried, I keep them to shorter roads" : ""} (my habits).`)}`)
    if (chosen) {
      L.push(`- q: ${y(`Take this party to the ${chosen.quest.dungeonName}?`)}`)
      L.push(`  context: ${y(`${opts.own ? "The four you named, seated as you gave them. " : ""}Front to back: ${chosen.seats.map((s) => `${s.rank}. ${s.hero.name} (${s.hero.clsName}, ${s.hero.stress} stress)`).join("; ")}. ${chosen.healer ? `A healer is in it: ${chosen.heal!.by}'s ${chosen.heal!.skill}, about ${chosen.heal!.avg} hit points a cast.` : chosen.heal ? `No true healer: only ${chosen.heal.by}'s ${chosen.heal.skill}, about ${chosen.heal.avg} hit points a cast.` : "No healer in it."} ${chosen.stunner ? "So is a stun." : "No stun."}${chosen.reach ? ` From these seats they can strike ${chosen.reach.length === 4 ? "every rank of the enemy line" : `enemy rank${chosen.reach.length === 1 ? "" : "s"} ${chosen.reach.join(", ")}, and none of them the ${[1, 2, 3, 4].filter((e) => !chosen.reach!.includes(e)).join(" or ")}`}.` : ""}${chosen.pair ? ` ${chosen.pair.marker === chosen.pair.striker ? `${chosen.pair.marker} marks a foe with ${chosen.pair.mark} and strikes the marked harder with ${chosen.pair.strike}.` : `${chosen.pair.marker} marks a foe with ${chosen.pair.mark}, and ${chosen.pair.striker}'s ${chosen.pair.strike} strikes the marked harder.`}` : ""}`)}`, "  options:")
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
      const best = r.options.find((o) => o.activity.cost <= left)
      if (best) {
        left -= best.activity.cost
        cards.push(`  lean: ${r.options.indexOf(best)}`, `  lean_why: ${y(`the cheapest place they accept that has a free seat (${best.note}).`)}`)
      } else cards.push(`  lean: ${r.options.length}`, `  lean_why: ${y(`${firstRoad}.`)}`)
    }
    const leaned = !a.dismiss.some((d) => d.hero.guid === r.hero.guid) && r.options.find((o) => o.activity.cost <= left + o.activity.cost && cards.slice(at).some((l) => l === `  lean: ${r.options.indexOf(o)}`))
    filed.push({ at, place: leaned ? leaned.activity.buildingName : "" })
  }
  const ward = t.activities.find((x) => x.activity === "disease_treatment")
  let beds = ward ? ward.slots - ward.used : 0
  // the ward's free beds go to the most experienced first; the rest wait
  for (const h of [...a.disease].sort((x, z) => z.level - x.level || z.xp - x.xp)) {
    if (!ward) continue
    const at = cards.length
    const gets = beds > 0
    if (gets) beds--
    const ill = h.quirks.filter((q) => q.disease).map((q) => q.name).join(", ")
    cards.push(`- q: ${y(`Treat ${h.name}'s ${ill}?`)}`, `  image: ${y(portrait(h))}`)
    cards.push(`  context: ${y(`${h.name}, ${h.clsName} level ${h.level}, carries ${ill}. The Medical Ward has ${ward.slots} bed${ward.slots === 1 ? "" : "s"} as the Sanitarium stands, ${ward.slots - ward.used} free this week, for ${a.disease.length} ill.`)}`, "  options:")
    cards.push(`    - pick: "Medical Ward"`, `      effect: ${y(`${coin(ward.cost)}; the disease is treated before the next expedition.`)}`)
    cards.push(`    - pick: "Not this week"`, `      effect: ${y("The disease stays; keep them out of the party.")}`)
    const purse = ward.cost <= left
    const lean = gets && h.level >= 1 && purse ? 0 : 1
    if (lean === 0) left -= ward.cost
    cards.push(`  lean: ${lean}`, `  lean_why: ${y(!gets ? "the bed goes to a more experienced hero this week." : h.level < 1 ? "a level 0 hero is cheaper to replace than to cure." : !purse ? `${firstRoad}.` : "a hero with experience is worth the bed.")}`)
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
    const purse = tr.cost <= left
    // a hero in the ward cannot board the coach: never lean on treating one of the four I would send (Soushi, 2026-10-10)
    const lean = gets && purse && !tr.inParty ? 0 : 1
    if (lean === 0) left -= tr.cost
    filed.push({ at: cards.length, place: lean === 0 ? tw.buildingName : "" })
    cards.push(`- q: ${y(`Treat ${tr.hero.name}'s ${tr.quirk.name}?`)}`, `  image: ${y(portrait(tr.hero))}`)
    cards.push(`  context: ${y(`${tr.hero.name}, ${tr.hero.clsName} level ${tr.hero.level}${tr.inParty ? ", in the party I would send" : ""}. ${tr.quirk.name}${tr.quirk.description ? `: ${tr.quirk.description}` : "."}${tr.quirk.locked ? " It has set in, and the ward asks more for it." : ""} The ${tw.name} has ${tw.slots} seat${tw.slots === 1 ? "" : "s"}, ${tw.slots - tw.used} free this week.`)}`, "  options:")
    cards.push(`    - pick: ${y(tw.name)}`, `      effect: ${y(`${tr.cost ? coin(tr.cost) : "free this week"}; the ward works on ${tr.quirk.name}, and ${tr.hero.name} stays in the Hamlet while it does.`)}`)
    cards.push(`    - pick: "Not this week"`, `      effect: ${y(`${tr.hero.name} keeps it for now.`)}`)
    cards.push(`  lean: ${lean}`, `  lean_why: ${y(tr.inParty ? `${tr.hero.name} rides with the party I would send, and a hero in the ward cannot board the coach; treat it in a week they stay home.` : !gets ? "the seat goes to someone the road needs more." : !purse ? `${firstRoad}.` : `${tr.why}.`)}`)
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
  }

  // guild and blacksmith
  L.push("## The Guild and the Blacksmith {wide}", "")
  L.push(`What the trainers and the smith can teach the party next, and at what price: the Guild knocks ${Math.round(t.skillDiscount * 100)}% off its lessons and the Blacksmith ${Math.round(t.gearDiscount * 100)}% off his work, for what the estate has already paid them.`, "")
  if (a.buys.length) {
    L.push("```board-decisions")
    L.push(`- q: "What do we train first?"`, `  context: ${y(`You have ${coin(gold)}. These are the party's upgrades you can afford now, cheapest first.`)}`, "  options:")
    // the five cheapest lessons, and every piece of the smith's work the coffers can pay for, so an upgrade just opened is never hidden (Soushi, 2026-10-10)
    const shown = [...a.buys.filter((u) => u.where !== "Blacksmith").slice(0, 5), ...a.buys.filter((u) => u.where === "Blacksmith")]
    for (const u of shown) L.push(`    - pick: ${y(`${u.hero}: ${u.label} to level ${u.toLevel}`)}`, `      effect: ${y(`${coin(u.cost.find((c) => c.type === "gold")?.amount ?? 0)} at the ${u.where}.`)}`)
    L.push(`    - pick: "Keep the gold"`, `      effect: ${y("Spend nothing at the Guild or the Blacksmith this week.")}`)
    const price = (u: (typeof shown)[number]) => u.cost.find((c) => c.type === "gold")?.amount ?? 0
    const heal = shown.findIndex((u) => /medicine|reconstruction|grace|comfort|heal/i.test(u.label) && price(u) <= left)
    const cheap = shown.findIndex((u) => price(u) <= left)
    const pick = heal >= 0 ? heal : cheap
    if (pick >= 0) left -= price(shown[pick]!)
    L.push(`  lean: ${pick >= 0 ? pick : shown.length}`, `  lean_why: ${y(heal >= 0 ? "the party's healing is what brings everyone home." : cheap >= 0 ? "the cheapest step for the hero who fights most." : `${firstRoad}.`)}`)
    L.push("```", "")
  }
  if (a.blocked.length) {
    L.push("```board-stickies")
    const byNeed = new Map<string, string[]>()
    for (const u of a.blocked) { const k = u.blockedBy; byNeed.set(k, [...(byNeed.get(k) ?? []), `${u.hero} ${u.label}`]) }
    for (const [need, what] of byNeed) L.push(`- title: ${y(`Waiting on ${inWords(need)}`)}`, "  kind: model", `  body: ${y(`${what.join(", ")}. Buy that building upgrade first, with heirlooms.`)}`)
    L.push("```", "")
  }

  // roster
  L.push("## Who stays, who goes {wide}", "")
  // C29: recruits share the places the roster has, counting the ones my dismissals would free (Soushi, 2026-10-10)
  const worth = (h: HeroView) => h.quirks.filter((q) => q.positive).length - h.quirks.filter((q) => !q.positive && !q.disease).length
  const ranked = [...a.recruits].sort((x, z) => worth(z.hero) - worth(x.hero) || z.hero.level - x.hero.level)
  // a full roster still has choices: a recruit clearly better than a level 0 hero outside the party is worth the swap (RULE: by 2 or more)
  const sendingNow = new Set(chosen?.seats.map((x) => x.hero.guid))
  const named = new Set(a.dismiss.map((d) => d.hero.guid))
  const weak = t.heroes.filter((h) => h.level === 0 && !h.busy && !sendingNow.has(h.guid) && !named.has(h.guid)).sort((x, z) => worth(x) - worth(z))
  let free = Math.max(0, t.rosterCap - t.rosterSize) + a.dismiss.length
  const dismiss = [...a.dismiss]
  for (const r of ranked.filter((r) => worth(r.hero) > 0)) {
    if (free > 0) { free--; continue }
    const w = weak.shift()
    if (!w || worth(r.hero) - worth(w) < 2) break
    dismiss.push({ hero: w, why: `level 0 with ${w.quirks.filter((q) => !q.positive && !q.disease).length} bad quirks and ${w.quirks.filter((q) => q.positive).length} good; ${r.hero.name} at the coach would serve you better` })
  }
  const places = Math.max(0, t.rosterCap - t.rosterSize) + dismiss.length
  const taken = ranked.filter((r) => worth(r.hero) >= 0).slice(0, places)
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
    const why = take ? `${worth(r.hero) > 0 ? "more good quirks than bad" : "as many good quirks as bad"}, and there is a place for them` : worth(r.hero) < 0 ? "more bad quirks than good" : `no place left for them: ${places ? `the ${places === 1 ? "place goes" : `${places} places go`} to ${taken.map((x) => x.hero.name).join(" and ")}` : "the roster is full"}`
    rcards.push(`  lean: ${take ? 0 : 1}`, `  lean_why: ${y(`${why}.`)}`)
  }
  if (rcards.length) L.push("```board-decisions", ...rcards, "```", "")

  // heirlooms and trinkets
  if (a.heirlooms.length || a.trinkets.length) {
    L.push("## Heirlooms and trinkets {wide}", "")
    L.push("What the family's heirlooms could build tonight, and the trinkets in the estate's stores with who may wear them.", "")
    if (a.heirlooms.length) {
      L.push("```board-decisions")
      L.push(`- q: "Where do the heirlooms go?"`, `  context: ${y(`The estate holds ${t.wallet.crest ?? 0} crests, ${t.wallet.bust ?? 0} busts, ${t.wallet.portrait ?? 0} portraits, ${t.wallet.deed ?? 0} deeds.`)}`, "  options:")
      for (const u of a.heirlooms) L.push(`    - pick: ${y(u.label)}`, `      effect: ${y(`costs ${u.cost.map((c) => `${c.amount} ${c.type}s`).join(" and ")}.`)}`)
      L.push(`    - pick: "Save them"`, `      effect: ${y("Keep the heirlooms for a bigger upgrade later.")}`)
      // an affordable building upgrade that opens the party's own waiting upgrades comes first (Soushi, 2026-10-10)
      const opens = a.heirlooms.map((u) => a.blocked.filter((b) => b.blockedBy.includes(`${u.tree} ${u.code}`)))
      const most = opens.reduce((best, o, i) => (o.length > (opens[best]?.length ?? 0) ? i : best), -1)
      const san = a.heirlooms.findIndex((u) => u.tree === "sanitarium.disease_quirk_cost" || u.tree === "sanitarium.cost")
      const lean = most >= 0 ? most : san >= 0 ? san : a.heirlooms.length
      const why = most >= 0 ? `it opens what the party is waiting for: ${opens[most]!.map((b) => `${b.hero} ${b.label}`).join(", ")}.` : san >= 0 ? `${a.disease.length} of your heroes are ill; cheaper treatment pays back quickly.` : "nothing affordable opens anything the party is waiting for."
      L.push(`  lean: ${lean}`, `  lean_why: ${y(why)}`)
      L.push("```", "")
    }
    if (a.trinkets.length) {
      L.push("```board-stickies")
      for (const tr of a.trinkets) L.push(`- title: ${y(`${tr.trinket} to ${tr.to}`)}`, "  kind: idea", `  body: ${y(`${tr.why}.`)}`)
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
  for (const u of a.heirlooms) rows.push([u.cost.map((c) => `${c.amount} ${c.type}`).join(", "), u.label, `\`upgrades/building/${u.tree.split(".")[0]}.upgrades.json\` ${u.tree} code ${u.code}`])
  for (const p of a.parties) rows.push([p.quest.rewards.filter((r) => /^\d/.test(r)).join(", "), `${questLabel(p)}, rewards`, "`persist.quest.json` completion_reward"])
  for (const i of roadItems) rows.push([`${i.price}`, `${i.label}, gold each`, `\`inventory/base.supply.inventory.items.darkest\` purchase_gold_value${t.event?.provisions.length ? `, with this week's event (\`${t.event.id}\`)` : ""}`])
  rows.push([`${t.witnessedSkills}`, "enemy attacks witnessed", "`persist.game_knowledge.json` combat_skills"])
  L.push("## How I keep the accounts {wide}", "")
  L.push(`My habits, so you can weigh them: rest at ${RULE.restAbove} stress, send only under ${RULE.sendBelow}, let go of level 0 heroes with ${RULE.dismissNegatives} or more bad quirks. Your heroes have suffered ${t.witnessedSkills} kinds of blow so far, in ${t.visited.length ? t.visited.length + " of the places beyond the Hamlet" : "no place yet"}. Everything else on this page is what the estate's ledgers and my own eyes tell me.`, "")

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
  "Who stays, who goes", "Who rests, who prays", "The next expedition", "How ready they are", "The Guild and the Blacksmith",
  "Provisions for the", "How I keep the accounts",
]
export function inActingOrder(md: string): string {
  const parts = md.split(/\n(?=## )/)
  const head = parts[0]!, sections = parts.slice(1)
  const rank = (sec: string) => { const i = ACTING_ORDER.findIndex((t) => sec.startsWith(`## ${t}`)); return i < 0 ? ACTING_ORDER.length : i }
  return [head, ...sections.map((sec, i) => ({ sec, i })).sort((a, b) => rank(a.sec) - rank(b.sec) || a.i - b.i).map((x) => x.sec)].join("\n")
}

export async function buildBoard(t: Town, opts: { foresight?: boolean } = {}): Promise<string> {
  mkdirSync(join(outDir, "img"), { recursive: true })
  const answers = await readAnswers()
  // C40 to C42: the survivors' tale of the road just walked, and its lessons kept before this week is advised
  let tale: Tale | undefined
  if (t.back) {
    const snaps = await chronicleFor(t.back), fellNames = t.back.heroes.filter((h) => h.died).map((h) => h.name)
    // C45: the whole debrief folded into the tale: traps, obstacles, criticals, curios and quirks take their place among the beats;
    // a fall of light the obstacle caused, and a leap of stress the trap caused, are told once, by their cause
    const db = snaps.length > 1 ? await debrief(snaps) : undefined
    const extra = db?.beats ?? []
    const bs = [...beats(snaps, fellNames).filter((x) => !(x.kind === "dark" && extra.some((e) => e.kind === "obstacle" && e.i === x.i))
      && !(x.kind === "spike" && extra.some((e) => e.kind === "trap" && e.who === x.who && Math.abs(e.i - x.i) <= 1))), ...extra].sort((x, y) => x.i - y.i)
    const healer = (await Promise.all(t.back.heroes.map(async (bh) => {
      const h = [...t.heroes, ...t.fallen].find((x) => x.guid === bh.guid), sk = h ? (await heroClass(h.cls)).skills : undefined
      return !!h && h.skills.some((s) => sk?.get(s.id)?.targetsAllies && sk.get(s.id)!.healAvg >= RULE.realHeal)
    }))).some(Boolean)
    const first = snaps[0]
    const j = judge(snaps, bs, { dungeon: t.back.dungeon, dungeonName: t.back.dungeonName, difficulty: first?.difficulty ?? 0, length: t.back.length, week: t.week - 1, success: t.back.success, healer })
    if (snaps.length > 1) await remember(j.lessons)
    tale = { snaps: snaps.length, beats: bs, ...j, debrief: db }
  }
  t.ledger = await loadLedger()
  const a = await advise(t)
  // a party Soushi named in a note, seated for the expedition he picked
  let own: Party | undefined
  const quest = ((answers.expedition && a.parties.find((p) => questLabel(p) === answers.expedition)) || a.best)?.quest
  if (answers.partyNames?.length && quest) {
    const heroes = answers.partyNames.map((n) => t.heroes.find((h) => h.name.toLowerCase() === n.toLowerCase())).filter((h): h is HeroView => !!h)
    // four names that are all on the roster, or the note is not a party
    if (heroes.length === 4) own = await seatParty(heroes, quest)
  }
  const checks = reconcile(await loadPicks(outDir), t)
  // the week's first board keeps the Hamlet as it found it (C26)
  const wsFile = Bun.file(join(outDir, "week-start.json"))
  let start = (await wsFile.exists()) ? ((await wsFile.json()) as WeekStart) : undefined
  if (!start || start.week !== t.week) {
    start = { week: t.week, heroes: t.heroes.map((h) => ({ guid: h.guid, name: h.name })), bought: [...t.bought], gold: t.wallet.gold ?? 0, purchases: t.purchases.map((p) => `${p.guid}|${p.key}`) }
    await Bun.write(wsFile, JSON.stringify(start, null, 1))
  }
  const { board, sources } = source(t, a, { foresight: !!opts.foresight, answers, own, checks, prices: await supplyPrices(), soFar: weekSoFar(t, start), tale })
  // C38: every build is read back for advice that contradicts itself; the live session is told through coherence.json
  const clash = contradictions(board)
  await Bun.write(join(outDir, "coherence.json"), JSON.stringify({ week: t.week, contradictions: clash }, null, 1))
  if (clash.length) console.log(`INCOHERENT week ${t.week}: ${clash.join(" | ")}`)
  // what the Caretaker proposed this week, for the farewell to judge the departure against (C24)
  const chosen = own ?? ((answers.expedition && a.parties.find((p) => questLabel(p) === answers.expedition)) || a.best)
  if (chosen) await Bun.write(join(outDir, "proposal.json"), JSON.stringify({ week: t.week, dungeon: chosen.quest.dungeon, length: chosen.quest.length, type: chosen.quest.type, label: questLabel(chosen), party: chosen.seats.map((x) => x.hero.guid), own: !!own }, null, 1))
  return compile(board, sources)
}

async function compile(board: string, sources: string): Promise<string> {
  const src = join(outDir, "town.md")
  await Bun.write(src, board)
  await Bun.write(join(outDir, "sources.md"), sources)
  await buildSkin()
  const out = join(outDir, "town.html")
  const proc = Bun.spawnSync(["bun", BOARD, src, "--no-sketch", "--out", out], { stdout: "pipe", stderr: "pipe" })
  if (proc.exitCode !== 0) throw new Error(`board build failed: ${proc.stderr.toString()}`)
  return out
}

export interface Proposal { week: number; dungeon: string; length: number; type: string; label: string; party: number[]; own: boolean }

/** The farewell (C24): once the party has left, the board turns into the Caretaker's last word before the dark: how they were
 *  sent against what he proposed and what was picked, what they carry against his habit, the foes known there, when he would
 *  turn back, and a send-off. In his voice like the town board (C13); its figures go to sources.md (C14). */
export function farewellSource(t: Town, r: NonNullable<Town["raid"]>, opts: { proposal?: Proposal; checks: Check[]; prices: Map<string, number> }): { board: string; sources: string } {
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
  L.push(`headline: ${y(`${q.dungeonName}, ${(LENGTH[q.length] ?? "").toLowerCase()} ${q.type},\nwith ${names.join(", ")}.`)}`)
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
  L.push(`Their packs against what I would carry on a ${LENGTH[len]?.toLowerCase()} road (my habit), and what the coffers kept: ${coin(t.wallet.gold ?? 0)}.`, "")
  L.push("```board-stickies")
  for (const i of habit) {
    const has = r.carried[i.id] ?? 0
    L.push(`- title: ${y(`${i.label}: ${has} carried, ${i.count} by my habit`)}`, `  kind: ${has >= i.count ? "works" : "risk"}`, `  body: ${y(has >= i.count ? "Enough, by my reckoning." : has === 0 ? `None at all. ${i.id === "bandage" ? "Foes you know there have bled you before." : i.id === "antivenom" ? "Foes you know there have poisoned you before." : "Spend what else they carry with care."}` : `${i.count - has} short of what I would carry. Spend ${i.label.toLowerCase()} only when you must.`)}`)
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
  for (const i of habit) rows.push([`${i.count}`, `${i.label}, my habit`, "RULE_FOOD in `advise.ts`"])
  rows.push([`${t.wallet.gold ?? 0}`, "gold in the coffers", "`persist.estate.json` wallet"])
  for (const [n, what, from] of rows) S.push(`| ${n} | ${what} | ${from} |`)
  return { board: L.join("\n"), sources: S.join("\n") }
}

/** Builds the farewell board for the expedition under way. */
export async function buildFarewell(t: Town): Promise<string> {
  mkdirSync(join(outDir, "img"), { recursive: true })
  const f = Bun.file(join(outDir, "proposal.json"))
  const proposal = (await f.exists()) ? ((await f.json()) as Proposal) : undefined
  const { board, sources } = farewellSource(t, t.raid!, { proposal, checks: reconcile(await loadPicks(outDir), t), prices: await supplyPrices() })
  return compile(board, sources)
}
