// Writes the town board: a niceboard source in the Caretaker's voice, the portraits it shows, and the
// compiled page. One fixed file name, so the picks a reader makes survive every rebuild of the board.
// The board speaks only as the Caretaker, in the Hamlet's own words (C13): no file, field or save is named on it.
// Where each figure comes from goes to sources.md beside it (C14).
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { advise, seatParty, RULE, type Advice, type Party } from "./advise.ts"
import { install, root } from "./paths.ts"
import { DIFFICULTY, LENGTH, type HeroView, type Town } from "./town.ts"
import { buildSkin } from "./skin.ts"
import { loadPicks, reconcile, type Check } from "./reconcile.ts"

export const outDir = join(root, ".local", "town")
const BOARD = process.env.NICEBOARD ?? join(homedir(), ".claude/skills/Niceboard/Tools/Board.ts")
const y = (s: string) => JSON.stringify(s) // a JSON string is a valid YAML scalar, quotes and colons included
const RULE_FOOD = [0, 8, 12, 16] // RULE: food and torches by expedition length
const HABIT = "(my habit)" // how a RULE number is labelled on the board, in his voice (A2)
const coin = (n: number) => `${n.toLocaleString("en-US")} gold`

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
  // the trinket reward tells two quests to the same dungeon apart
  return [q.dungeonName, `${LENGTH[q.length] ?? q.length} ${q.type}`, q.rewards[0], q.rewards[q.rewards.length - 1]].filter(Boolean).join(", ")
}

export function source(t: Town, a: Advice, opts: { foresight: boolean; answers: Answers; own?: Party; checks?: Check[] }): { board: string; sources: string } {
  const L: string[] = []
  const picked = (opts.answers.expedition && a.parties.find((p) => questLabel(p) === opts.answers.expedition)) || a.best
  const chosen = opts.own ?? picked
  const gold = t.wallet.gold ?? 0

  L.push(`# The *Hamlet*, week ${t.week}`, "")
  L.push(`You are back, and the estate stands. ${t.heroes.length} names on the roster, ${coin(gold)} in the coffers, ${t.quests_won} of ${t.quests_done} expeditions won. I have gone through the ledgers and walked the streets; here is what I would do before the coach leaves again. Where a number is only my own habit, I say so.`, "")
  L.push("```board-idea")
  L.push(`headline: ${y(chosen ? `${chosen.quest.dungeonName} next,\nwith ${chosen.seats.map((s) => s.hero.name).join(", ")}.` : "Rest first.\nNo four are fit to go.")}`)
  L.push(`detail: ${y(a.afflicted.length ? `${a.afflicted.map((h) => h.name).join(" and ")} cannot be trusted in the dark until the Abbey or the Tavern has had them.` : "Nobody is afflicted. Spend on the party first, the estate second.")}`)
  L.push("```", "")

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

  // expedition first: its cards stay numbered 1 and 2 whatever else changes, so a stored pick never drifts onto them
  L.push("## The next expedition {wide}", "")
  L.push(`The roads the estate can send you down this week. I name only the foes your heroes have fought, in places they have walked; of the rest I say nothing. ${opts.foresight ? "Travellers' tales do reach me, though, and where I repeat one I say so." : ""}`.trim(), "")
  if (a.parties.length) {
    L.push("```board-decisions")
    L.push(`- q: "Which expedition next?"`, `  context: ${y(`Your heroes able to go now (under ${RULE.sendBelow} stress, not afflicted, not ill, not in a building): ${a.ready.map((h) => h.name).join(", ")}.`)}`, "  options:")
    for (const p of a.parties) {
      const q = p.quest
      const foes = q.walked ? (q.known.length ? `foes you know: ${q.known.slice(0, 6).join(", ")}${q.known.length > 6 ? ` and ${q.known.length - 6} more` : ""}; ${q.unknownCount} kind${q.unknownCount === 1 ? "" : "s"} you have not met` : `${q.unknownCount} kind${q.unknownCount === 1 ? "" : "s"} of foe you have not met`) : "you have never walked it; I will not speak of what lives there"
      // foresight speaks only about the expedition being prepared (C7)
      const rumour = opts.foresight && p === chosen && q.unknownCount ? ` Foresight: travellers speak of ${q.unknownTypes.length ? q.unknownTypes.join(" and ") + " things" : "things I cannot name"} there that you have not met.` : ""
      L.push(`    - pick: ${y(questLabel(p))}`, `      effect: ${y(`${DIFFICULTY[q.difficulty] ?? `level ${q.difficulty}`}; rewards ${q.rewards.join(", ")}; ${foes}.${rumour}`)}`)
    }
    const leanIdx = chosen ? a.parties.indexOf(chosen) : 0
    L.push(`  lean: ${Math.max(0, leanIdx)}`, `  lean_why: ${y(`the four I would send fit it best: ${chosen ? chosen.seats.flatMap((s) => s.notes).join(", ") || "ranks and skills line up" : ""}.`)}`)
    if (chosen) {
      L.push(`- q: ${y(`Take this party to the ${chosen.quest.dungeonName}?`)}`)
      L.push(`  context: ${y(`${opts.own ? "The four you named, seated as you gave them. " : ""}Front to back: ${chosen.seats.map((s) => `${s.rank}. ${s.hero.name} (${s.hero.clsName}, ${s.hero.stress} stress)`).join("; ")}. ${chosen.healer ? "A healer is in it." : "No healer in it."} ${chosen.stunner ? "So is a stun." : "No stun."}`)}`, "  options:")
      L.push(`    - pick: "Yes, this four"`, `      effect: ${y("Embark with them in this order; each one's equipped skills reach from their rank.")}`)
      L.push(`    - pick: "No, I choose my own"`, `      effect: ${y("Write your four in the note below, front to back, and send them to me; I will look them over before the coach leaves.")}`)
      L.push(`  lean: 0`, `  lean_why: ${y("of those fit to go, they stand best where I would place them, by my reckoning of what each can do from there.")}`)
    }
    L.push("```", "")
  }
  if (chosen) {
    L.push("```board-stickies")
    for (const s of chosen.seats) {
      L.push(`- title: ${y(`Rank ${s.rank}: ${s.hero.name}`)}`, `  kind: ${s.notes.some((n) => n.startsWith("−")) ? "gotcha" : "works"}`)
      L.push(`  body: ${y(`${s.hero.clsName}, level ${s.hero.level}, ${s.hero.stress} stress. Skills that reach from here: ${s.skills.join(", ")}.${s.notes.length ? ` Quirks that matter here: ${s.notes.join(", ")}.` : ""}`)}`)
    }
    for (const n of chosen.notes) L.push(`- title: ${y("Mind this")}`, "  kind: risk", `  body: ${y(n)}`)
    L.push("```", "")
  }

  // relief
  L.push("## Who rests, who prays {wide}", "")
  L.push(`The ones the dark has worn down, where the Abbey and the Tavern can take them as the estate has built them up, and the places their own habits forbid them. My habit: anyone at ${RULE.restAbove} stress or more rests before going out again.`, "")
  const cards: string[] = []
  for (const r of a.relief) {
    if (!r.options.length) continue
    cards.push(`- q: ${y(`Where does ${r.hero.name} go?`)}`, `  image: ${y(portrait(r.hero))}`)
    cards.push(`  context: ${y(`${r.hero.name}, ${r.hero.clsName} level ${r.hero.level}: ${r.why.join(", ")}.`)}`, "  options:")
    for (const o of r.options) cards.push(`    - pick: ${y(o.activity.name)}`, `      effect: ${y(`${o.note}${r.hero.affliction ? `; ${Math.round(o.activity.cure * 100)}% chance to cure the affliction` : ""}.`)}`)
    cards.push(`    - pick: "Leave them be"`, `      effect: ${y("Free; they stay at their stress and wait for next week.")}`)
    if (a.dismiss.some((d) => d.hero.guid === r.hero.guid)) {
      cards.push(`  lean: ${r.options.length}`, `  lean_why: ${y("I would rather let them go than pay for their rest; see Who stays, who goes.")}`)
    } else {
      const best = r.options.find((o) => o.activity.cost <= gold) ?? r.options[0]!
      cards.push(`  lean: ${r.options.indexOf(best)}`, `  lean_why: ${y(`the cheapest place they accept that has a free seat (${best.note}).`)}`)
    }
  }
  const ward = t.activities.find((x) => x.activity === "disease_treatment")
  let beds = ward ? ward.slots - ward.used : 0
  // the ward's free beds go to the most experienced first; the rest wait
  for (const h of [...a.disease].sort((x, z) => z.level - x.level || z.xp - x.xp)) {
    if (!ward) continue
    const gets = beds > 0
    if (gets) beds--
    const ill = h.quirks.filter((q) => q.disease).map((q) => q.name).join(", ")
    cards.push(`- q: ${y(`Treat ${h.name}'s ${ill}?`)}`, `  image: ${y(portrait(h))}`)
    cards.push(`  context: ${y(`${h.name}, ${h.clsName} level ${h.level}, carries ${ill}. The Medical Ward has ${ward.slots} bed${ward.slots === 1 ? "" : "s"} as the Sanitarium stands, ${ward.slots - ward.used} free this week, for ${a.disease.length} ill.`)}`, "  options:")
    cards.push(`    - pick: "Medical Ward"`, `      effect: ${y(`${coin(ward.cost)}; the disease is treated before the next expedition.`)}`)
    cards.push(`    - pick: "Not this week"`, `      effect: ${y("The disease stays; keep them out of the party.")}`)
    const lean = gets && h.level >= 1 ? 0 : 1
    cards.push(`  lean: ${lean}`, `  lean_why: ${y(!gets ? "the bed goes to a more experienced hero this week." : h.level >= 1 ? "a hero with experience is worth the bed." : "a level 0 hero is cheaper to replace than to cure.")}`)
  }
  const stuck = a.relief.filter((r) => !r.options.length)
  if (cards.length) L.push("```board-decisions", ...cards, "```", "")
  if (stuck.length) {
    L.push("```board-stickies")
    for (const r of stuck) L.push(`- title: ${y(`${r.hero.name} waits`)}`, "  kind: gotcha", `  body: ${y(`${r.why.join("; ")}. ${r.hero.quirks.filter((q) => q.description && /only|not allowed|won't|will not/i.test(q.description)).map((q) => `${q.name}: ${q.description}`).join(" ")}`)}`)
    L.push("```", "")
  }

  // provisions for the chosen expedition
  if (chosen) {
    const q = chosen.quest
    const len = Math.max(1, Math.min(3, q.length))
    L.push("## Provisions for the road {wide}", "")
    L.push(`What to buy at the Provisioner for the ${q.dungeonName}. The counts are my habit for a ${LENGTH[len]?.toLowerCase()} expedition, nothing more; I ask for bandages and antivenom only where foes you know there have already bled or poisoned you.`, "")
    L.push("```board-stickies")
    for (const pv of t.event?.provisions ?? []) {
      const what = pv.item === "provision" ? "Food" : "Torches, shovels and the rest"
      const change = pv.cost ? `cost ${pv.cost <= -1 ? "nothing" : `${Math.round(-pv.cost * 100)}% less`}` : `come in ${Math.round(-pv.amount * 100)}% smaller lots`
      L.push(`- title: ${y(`${what} ${change} this week`)}`, "  kind: idea", `  body: ${y(`The ${t.event!.title}. Buy accordingly.`)}`)
    }
    L.push(`- title: ${y(`Food: ${RULE_FOOD[len]} ${HABIT}`)}`, "  kind: works", `  body: ${y(t.supply.provision ?? "")}`)
    L.push(`- title: ${y(`Torches: ${RULE_FOOD[len]} ${HABIT}`)}`, "  kind: works", `  body: ${y(t.supply.torch ?? "")}`)
    L.push(`- title: ${y(`Shovels: ${len} ${HABIT}`)}`, "  kind: works", `  body: ${y(t.supply.shovel ?? "")}`)
    if (q.bleeders.length) L.push(`- title: ${y(`Bandages: ${len + 1} ${HABIT}`)}`, "  kind: model", `  body: ${y(`${t.supply.bandage ?? ""} Foes you know there whose attacks have bled you: ${q.bleeders.join(", ")}.`)}`)
    if (q.blighters.length) L.push(`- title: ${y(`Antivenom: ${len + 1} ${HABIT}`)}`, "  kind: model", `  body: ${y(`${t.supply.antivenom ?? ""} Foes you know there whose attacks have blighted you: ${q.blighters.join(", ")}.`)}`)
    if (q.length >= 2) L.push(`- title: ${y("Firewood comes with a medium or long expedition")}`, "  kind: idea", `  body: ${y(t.supply.firewood ?? "")}`)
    L.push("```", "")
  }

  // guild and blacksmith
  L.push("## The Guild and the Blacksmith {wide}", "")
  L.push(`What the trainers and the smith can teach the party next, and at what price: the Guild knocks ${Math.round(t.skillDiscount * 100)}% off its lessons and the Blacksmith ${Math.round(t.gearDiscount * 100)}% off his work, for what the estate has already paid them.`, "")
  if (a.buys.length) {
    L.push("```board-decisions")
    L.push(`- q: "What do we train first?"`, `  context: ${y(`You have ${coin(gold)}. These are the party's upgrades you can afford now, cheapest first.`)}`, "  options:")
    for (const u of a.buys.slice(0, 5)) L.push(`    - pick: ${y(`${u.hero}: ${u.label} to level ${u.toLevel}`)}`, `      effect: ${y(`${coin(u.cost.find((c) => c.type === "gold")?.amount ?? 0)} at the ${u.where}.`)}`)
    L.push(`    - pick: "Keep the gold"`, `      effect: ${y("Spend nothing at the Guild this week.")}`)
    const heal = a.buys.findIndex((u) => /medicine|reconstruction|grace|comfort|heal/i.test(u.label))
    L.push(`  lean: ${heal >= 0 && heal < 5 ? heal : 0}`, `  lean_why: ${y(heal >= 0 && heal < 5 ? "the party's healing is what brings everyone home." : "the cheapest step for the hero who fights most.")}`)
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
  L.push(`${t.rosterSize} names on the roster, room for ${t.rosterCap} as the Stage Coach stands. My habit: a hero still at level 0 with ${RULE.dismissNegatives} or more bad quirks, outside the party, is worth letting go. The coach has brought these.`, "")
  const rcards: string[] = []
  for (const d of a.dismiss) {
    rcards.push(`- q: ${y(`Dismiss ${d.hero.name}?`)}`, `  image: ${y(portrait(d.hero))}`, `  context: ${y(`${d.hero.clsName}, ${d.why}.`)}`, "  options:")
    rcards.push(`    - pick: "Dismiss"`, `      effect: ${y("Frees a place on the roster for a fresh recruit.")}`, `    - pick: "Keep"`, `      effect: ${y("They stay; their quirks can be treated at the Sanitarium for gold.")}`)
    rcards.push(`  lean: 0`, `  lean_why: ${y("a recruit costs nothing and comes without these quirks.")}`)
  }
  for (const r of a.recruits) {
    rcards.push(`- q: ${y(`Recruit ${r.hero.name}, ${r.hero.clsName}?`)}`, `  image: ${y(portrait(r.hero))}`, `  context: ${y(`${r.why}.`)}`, "  options:")
    rcards.push(`    - pick: "Recruit"`, `      effect: ${y(`Joins the roster at level ${r.hero.level}.`)}`, `    - pick: "Pass"`, `      effect: ${y(r.hero.from ? "Leave them at the coach." : "The coach brings others next week.")}`)
    const good = r.hero.quirks.filter((q) => q.positive).length >= r.hero.quirks.filter((q) => !q.positive && !q.disease).length
    rcards.push(`  lean: ${good ? 0 : 1}`, `  lean_why: ${y(good ? "more good quirks than bad." : "more bad quirks than good.")}`)
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
      L.push(`    - pick: "Save them"`, `      effect: ${y("Keep the heirlooms for a bigger upgrade later (the Blacksmith's first tier opens weapon upgrades).")}`)
      const san = a.heirlooms.findIndex((u) => u.tree === "sanitarium.disease_quirk_cost" || u.tree === "sanitarium.cost")
      L.push(`  lean: ${san >= 0 ? san : a.heirlooms.length}`, `  lean_why: ${y(san >= 0 ? `${a.disease.length} of your heroes are ill; cheaper treatment pays back quickly.` : "nothing affordable changes much yet.")}`)
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
    rows.push([`${act.slots - act.used} / ${act.slots}`, `${act.name}, free seats`, `${file} slot_upgrades; occupants from \`persist.town.json\``])
  }
  for (const u of a.buys.slice(0, 5)) rows.push([`${u.cost.find((c) => c.type === "gold")?.amount ?? 0}`, `${u.hero}: ${u.label} to level ${u.toLevel}`, `\`upgrades/heroes/${u.tree.split(".")[0]}.upgrades.json\` ${u.tree} code ${u.code}, less ${Math.round((u.where === "Guild" ? t.skillDiscount : t.gearDiscount) * 100)}% from \`${u.where === "Guild" ? "guild" : "blacksmith"}.building.json\``])
  for (const u of a.heirlooms) rows.push([u.cost.map((c) => `${c.amount} ${c.type}`).join(", "), u.label, `\`upgrades/building/${u.tree.split(".")[0]}.upgrades.json\` ${u.tree} code ${u.code}`])
  for (const p of a.parties) rows.push([p.quest.rewards.filter((r) => /^\d/.test(r)).join(", "), `${questLabel(p)}, rewards`, "`persist.quest.json` completion_reward"])
  rows.push([`${t.witnessedSkills}`, "enemy attacks witnessed", "`persist.game_knowledge.json` combat_skills"])
  L.push("## How I keep the accounts {wide}", "")
  L.push(`My habits, so you can weigh them: rest at ${RULE.restAbove} stress, send only under ${RULE.sendBelow}, let go of level 0 heroes with ${RULE.dismissNegatives} or more bad quirks. Your heroes have suffered ${t.witnessedSkills} kinds of blow so far, in ${t.visited.length ? t.visited.length + " of the places beyond the Hamlet" : "no place yet"}. Everything else on this page is what the estate's ledgers and my own eyes tell me.`, "")

  const S: string[] = [`# Where each figure comes from, week ${t.week}`, "", "Every number on the town board beside the save field or game file it was read from (C14). Numbers labelled (my habit) on the board are RULE values and are not here.", ""]
  S.push("| Figure | What | Read from |", "|---|---|---|")
  for (const [n, what, from] of rows) S.push(`| ${n} | ${what.replace(/\|/g, "/")} | ${from} |`)
  S.push("", `Save copied from your Steam profile to \`.dd-runtime/profile/\` and decoded there; your files are never written. Game data read from the install. ${t.witnessedSkills} enemy attacks witnessed, dungeons walked: ${t.visited.join(", ") || "none"}. Rules of mine on this page: rest at ${RULE.restAbove} stress, send under ${RULE.sendBelow}, let go of level 0 heroes with ${RULE.dismissNegatives}+ bad quirks.`, "")
  return { board: L.join("\n"), sources: S.join("\n") }
}

export async function buildBoard(t: Town, opts: { foresight?: boolean } = {}): Promise<string> {
  mkdirSync(join(outDir, "img"), { recursive: true })
  const answers = await readAnswers()
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
  const { board, sources } = source(t, a, { foresight: !!opts.foresight, answers, own, checks })
  const src = join(outDir, "town.md")
  await Bun.write(src, board)
  await Bun.write(join(outDir, "sources.md"), sources)
  await buildSkin()
  const out = join(outDir, "town.html")
  const proc = Bun.spawnSync(["bun", BOARD, src, "--no-sketch", "--out", out], { stdout: "pipe", stderr: "pipe" })
  if (proc.exitCode !== 0) throw new Error(`board build failed: ${proc.stderr.toString()}`)
  return out
}
