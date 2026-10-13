// C38: the board never contradicts itself. Reads the finished board the way Soushi does (its cards, their leans, its
// notes) and names every pair of advice that cannot both be followed. Run on every build; a board with a contradiction
// is still written, and the contradictions go to coherence.json and the watcher's log for the live session to fix.

interface Card { q: string; picks: { pick: string; effect: string }[]; lean: number; context: string; why: string }

function cards(md: string): Card[] {
  const out: Card[] = []
  for (const block of md.matchAll(/```board-decisions\n([\s\S]*?)```/g)) {
    for (const raw of block[1]!.split(/\n(?=- q: )/)) {
      const q = raw.match(/^- q: "?(.*?)"?$/m)?.[1]
      if (!q) continue
      const picks = [...raw.matchAll(/^ {4}- pick: "?(.*?)"?\n {6}effect: "?(.*?)"?$/gm)].map((m) => ({ pick: m[1]!, effect: m[2]! }))
      out.push({ q, picks, lean: Number(raw.match(/^ {2}lean: (\d+)/m)?.[1] ?? -1), context: raw.match(/^ {2}context: "?(.*?)"?$/m)?.[1] ?? "", why: raw.match(/^ {2}lean_why: "?(.*?)"?$/m)?.[1] ?? "" })
    }
  }
  return out
}
const leaned = (c: Card) => c.picks[c.lean]?.pick
const gold = (s: string) => Number(s.match(/([\d,]+) gold/)?.[1]?.replace(/,/g, "") ?? 0)
const list = (s: string) => s.split(/, | and /).map((x) => x.trim()).filter(Boolean)

/** Words a reader sees that are a raw name from the game's files (snake case), off the board's own keys and image paths (C55). */
export function rawNames(md: string): string[] {
  const seen = md.replace(/^\s*-?\s*[a-z_]+:\s?/gm, "").replace(/img\/[\w.-]+/g, "")
  return [...new Set(seen.match(/\b[a-z]+_[a-z0-9_]+\b/g) ?? [])]
}

export function contradictions(md: string): string[] {
  const all = cards(md), found: string[] = []
  for (const w of rawNames(md)) found.push(`a raw name is on the board: ${w}`)
  // no hero is offered the same trinket twice (U23)
  // a trinket sticky is "<trinket> to <hero>", and only in the trinkets' own zone: a road lesson ("called ... to its side") is not one
  const trinketZone = md.match(/\n## Heirlooms and trinkets[^\n]*\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? ""
  const offered = [...trinketZone.matchAll(/- title: "(.+?) to ([^"]+)"\n {2}kind: idea/g)].map((m) => `${m[1]} to ${m[2]}`)
  for (const o of new Set(offered.filter((x, i) => offered.indexOf(x) !== i))) found.push(`the same trinket is offered twice: ${o}`)
  const party = all.find((c) => c.q.startsWith("Take this party"))
  const four = party ? [...party.context.matchAll(/\d\. ([^(;]+?) \(/g)].map((m) => m[1]!.trim()) : []
  const going = (n: string) => four.includes(n)

  // the four named everywhere are the same four
  const head = md.match(/headline: "[^\n]*?with ([^"]+?)\."/)?.[1]
  if (head && four.length && list(head).join("|") !== four.join("|")) found.push(`the headline sends ${head}, the party card ${four.join(", ")}`)
  const bridge = md.match(/So this week I would send (.+?) to the /)?.[1]
  if (bridge && four.length && list(bridge).join("|") !== four.join("|")) found.push(`the return section sends ${bridge}, the party card ${four.join(", ")}`)
  // a rank note may carry a warning after the name ("Emory (mind the quirk)"); the name is what is compared
  const stick = [...md.matchAll(/title: "Rank \d: ([^"]+)"/g)].map((m) => m[1]!.replace(/ \([^)]*\)$/, "").replace(/, .*$/, ""))
  if (stick.length && four.length && [...stick].sort().join("|") !== [...four].sort().join("|")) found.push(`the rank notes seat ${stick.join(", ")}, the party card ${four.join(", ")}`)

  // nobody in the four is also sent to a building, the ward, or away
  for (const c of all) {
    const who = c.q.match(/^Where does (.+) go\?$/)?.[1] ?? c.q.match(/^Treat (.+?)'s .+\?$/)?.[1] ?? c.q.match(/^Dismiss (.+)\?$/)?.[1]
    const pick = leaned(c)
    if (!who || !pick || !going(who)) continue
    if (/^(Leave them be|Not this week|Keep)$/.test(pick)) continue
    // a hero of the four already in that building this week, which the party card names as it leans away from this four
    if (party && leaned(party) !== party.picks[0]?.pick && party.why.includes(`${who} is in the ${pick} this week`)) continue
    found.push(`${who} is in the four, and also leaned to "${pick}"`)
  }

  // trinkets and training are for the four
  for (const m of trinketZone.matchAll(/title: "(.+?) to ([^"]+)"\n {2}kind: idea/g)) if (four.length && !going(m[2]!)) found.push(`${m[1]} goes to ${m[2]}, who is not in the four`)
  const train = all.find((c) => c.q === "What do we train first?"), tp = train && leaned(train)
  if (tp && tp !== "Keep the gold") { const who = tp.split(":")[0]!; if (four.length && !going(who)) found.push(`training leans on ${who}, who is not in the four`) }

  // the leans together stay within the gold left after the road
  const free = gold(md.match(/([\d,]+ gold) is free to spend/)?.[1] ?? "")
  if (free || /is free to spend/.test(md)) {
    const spend = all.reduce((sum, c) => (c.q === "Which expedition next?" || c.q === "Where do the heirlooms go?" || /already there this week, and paid for/.test(c.why) ? sum : sum + gold(c.picks[c.lean]?.effect ?? "")), 0)
    if (spend > free) found.push(`the leans spend ${spend.toLocaleString("en-US")} gold, and only ${free.toLocaleString("en-US")} is free after the road`)
  }

  // no more recruits than places
  const places = Number(md.match(/: (\d+) places? free/)?.[1] ?? NaN), freed = all.filter((c) => c.q.startsWith("Dismiss ") && leaned(c) === "Dismiss").length
  const taken = all.filter((c) => c.q.startsWith("Recruit ") && leaned(c) === "Recruit").length
  if (!Number.isNaN(places) && taken > places + freed) found.push(`${taken} recruits leaned for ${places + freed} places`)

  // the readiness table and the party card agree about the healer and the stun
  if (party) {
    const healRow = md.match(/\| (Ready|\*\*Not yet\*\*) \| A healer goes with them \|/)?.[1]
    if (healRow && (healRow === "Ready") !== /A healer is in it/.test(party.context)) found.push("the readiness table and the party card disagree about a healer")
    const stunRow = md.match(/\| (Ready|\*\*Not yet\*\*) \| A stun goes with them \|/)?.[1]
    if (stunRow && (stunRow === "Ready") !== /So is a stun/.test(party.context)) found.push("the readiness table and the party card disagree about a stun")
  }

  // an affordable building upgrade the party is waiting on is not left unbought for "Save them"
  const heir = all.find((c) => c.q === "Where do the heirlooms go?")
  if (heir && leaned(heir) === "Save them" && /title: "Waiting on the (Blacksmith|Guild)/.test(md)) {
    const opts = heir.picks.map((p) => p.pick)
    if (opts.some((o) => /^Blacksmith: better (weapons|armour)$/.test(o))) found.push(`the heirlooms lean on "Save them" while the party waits on a Blacksmith upgrade the estate can afford`)
  }
  return found
}
