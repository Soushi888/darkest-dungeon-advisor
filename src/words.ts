// The live stream in words (U2): an effect as a chronicle page keeps it ("speed_rating 1 (3)", "beast_blight_buff_1 0.2 (3)",
// "blight 2 (3) from grave_robber") read back the way the game would say it, from the game's own buff list
// (shared/buffs/base.buffs.json), and a long line cut into lines short enough for a notification to carry whole.
import { nameOf, strings, text } from "./game.ts"

let lib: Map<string, any> | undefined
const buffs = async () => (lib ??= new Map(JSON.parse(await text("shared/buffs/base.buffs.json")).buffs.map((b: any) => [b.id, b])))

// what each stat is called, and how its amount reads: "pct" a share shown as a percent, "pts" a share shown as points, "abs" as is
const STAT: Record<string, [string, "pct" | "pts" | "abs"]> = {
  attack_rating: ["accuracy", "pts"], crit_chance: ["crit", "pct"], defense_rating: ["dodge", "pts"], protection_rating: ["protection", "pct"],
  speed_rating: ["speed", "abs"], damage_low: ["damage", "pct"], damage_high: ["damage", "pct"], max_hp: ["max health", "pct"],
}
const RESIST: Record<string, string> = { poison: "blight", bleed: "bleed", stun: "stun", move: "move", debuff: "debuff", disease: "disease", death_blow: "deathblow", trap: "trap" }
const OTHER: Record<string, string> = {
  bleed_chance: "bleed chance", poison_chance: "blight chance", stun_chance: "stun chance", debuff_chance: "debuff chance", move_chance: "move chance",
  damage_received_percent: "damage taken", stress_dmg_received_percent: "stress taken", stress_dmg_percent: "stress dealt", hp_heal_received_percent: "healing received",
  hp_heal_percent: "healing given", stress_heal_received_percent: "stress relief received", crit_received_chance: "crits taken", scouting_chance: "scouting chance",
}
// the condition an effect holds under, as its rule data names it
const RULE: Record<string, string> = { tagged: "against the marked", poisoned: "against the blighted", bleeding: "against the bleeding", stunned: "against the stunned", beast: "against beasts", human: "against men", eldritch: "against the eldritch", unholy: "against the unholy", mankind: "against men" }

const words = (id: string) => id.replace(/_/g, " ").toLowerCase()
const signed = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n * 100) / 100}`

function amount(key: string, kind: "pct" | "pts" | "abs", n: number) {
  return kind === "abs" ? `${key} ${signed(n)}` : kind === "pts" ? `${key} ${signed(n * 100)}` : `${key} ${signed(n * 100)}%`
}

/** One effect as a page keeps it, in words: "speed +1 for 3 rounds", "blight resist +20% for 3 rounds". */
export async function effectWords(s: string): Promise<string> {
  const m = s.match(/^(.+?) (-?[\d.]+)(?: \((\d+)\))?(?: from (.+))?$/)
  if (!m) return words(s)
  const [, what, amt, dur, from] = m, n = Number(amt), rounds = dur ? ` for ${dur} round${dur === "1" ? "" : "s"}` : ""
  // a foe that laid it is named as the game names monsters, a hero by calling
  // a curio or a trap is kept already named ("the Knife Rack", pm#18)
  const by = !from ? "" : /^(the|a) /.test(from) ? `, from ${from}` : `, from the ${/_[A-Z]$/.test(from) ? await nameOf("monster", from) : await nameOf("class", from)}`
  // damage over time: the amount is what it deals each round
  if (what === "blight" || what === "bleed") return `${what} ${n} a round${rounds}${by}`
  let type = "", sub = "", rule = ""
  const vs = what!.match(/^(\w+) vs (\w+)$/)
  const b = (await buffs()).get(what!)
  if (vs) [sub, rule] = [vs[1]!, vs[2]!]
  else if (b) [type, sub, rule] = [String(b.stat_type), String(b.stat_sub_type ?? ""), String(b.rule_data?.string ?? "")]
  else if (STAT[what!] || OTHER[what!]) sub = what!
  else if (/^stat \d+$/.test(what!)) return `an effect I cannot read yet${rounds}`
  else return `${words(what!)} ${signed(n)}${rounds}`
  const cond = rule ? ` ${RULE[rule] ?? `with ${await nameOf("skill", rule).catch(() => words(rule))}`}` : ""
  let said: string
  if (type === "resistance" || (RESIST[sub] && !STAT[sub])) said = amount(`${RESIST[sub] ?? words(sub)} resist`, "pct", n)
  else if (STAT[sub]) said = amount(STAT[sub]![0], type === "combat_stat_multiply" && sub === "defense_rating" ? "pct" : STAT[sub]![1], n)
  else if (OTHER[type] || OTHER[sub]) said = amount(OTHER[type] ?? OTHER[sub]!, "pct", n)
  else said = amount(words(type || sub), "pct", n)
  return `${said}${cond}${rounds}${by}`
}

/** A supply, a curio or any id the game names in snake case, in plain words. */
export const plain = (id: string) => words(id)

// a journal page the party carries, as the chronicle keys it ("journal page 13"): a page of the estate's story, which the game
// prices nowhere (pm, 2026-10-11), so it is never counted as loot with a value
export const journalPage = (key: string) => key.match(/^journal[ _]page[ _](\d+)$/)?.[1]

/** The game's own title for a journal page, "A Trampled Journal (2/4)", or its plain inventory title "Journal Page". */
export async function pageTitle(n: string): Promise<string> {
  const s = await strings()
  return s.get(`journal_page_title_${n}`) ?? s.get("str_inventory_title_journal_page") ?? "Journal Page"
}

/** One event cut at its own seams into lines of at most `max` characters; every line after the first starts with "MORE ". */
export function wrap(line: string, max = 400): string[] {
  if (line.length <= max) return [line]
  // cut after "; " or before " || ", and drop the seam itself from the line it ends
  const parts = line.split(/(?<=; )|(?= \|\| )/), out: string[] = []
  const done = (l: string) => out.push(l.replace(/;\s*$/, "").trimEnd())
  let cur = ""
  for (const p of parts) {
    if ((cur + p).length > max && cur) { done(cur); cur = `MORE ${p.trimStart()}` }
    else cur += p
    while (cur.length > max) { done(cur.slice(0, max)); cur = `MORE ${cur.slice(max)}` }
  }
  if (cur) done(cur)
  return out
}
