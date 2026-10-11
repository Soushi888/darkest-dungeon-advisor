// bun run caretaker (C64): the Caretaker comments the road by himself, one rung down, so the agent watching a live session
// no longer spends a full turn on every page (Soushi, 2026-10-11 04:52: apply the token recommendations). It runs the live
// stream under its own mark, and on each CHRON block (the page whole, C63) and each ASK from the road it builds a short
// prompt (the page as bun run now prints it, the last ten lines of the thread, the boundary and voice rules) and asks the
// PAI Inference tool, then posts the answer through say(). A call that fails or times out posts nothing and prints a WARN.
// It never imports a model SDK and never spawns claude; it only writes the road thread (ISA A1).
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { appendFileSync, statSync } from "node:fs"
import { nowText } from "./now.ts"
import { campBrief, camping } from "./camp.ts"
import { current, feed, say, sayRecap, setCaretaker } from "./road.ts"
import type { Snap } from "./chronicle.ts"
import { outDir } from "./board.ts"

// read at call time, so a test can point them at a stub (the same pattern as NICEBOARD)
const inference = () => process.env.DD_INFERENCE ?? join(homedir(), ".claude/PAI/Tools/Inference.ts")
const level = () => process.env.DD_CARETAKER_LEVEL ?? "standard"
const limit = () => Number(process.env.DD_CARETAKER_TIMEOUT ?? 60_000)
const clock = () => new Date().toLocaleTimeString("en-GB", { hour12: false })

export const SYSTEM = [
  "You are the Caretaker of the Hamlet in Darkest Dungeon. You stay in the Hamlet and speak to the Heir, in the first person, in English, in character, about the four on the road: say \"your four\", \"they\", their names; never \"we\" for the party.",
  // the report beside your words already shows the numbers as bars, icons and a map (C66), so speak, do not tabulate (pm#26)
  "Length follows what happened: a quiet page, nothing fought, found or lost, gets one or two short paragraphs; up to four short paragraphs, one subject each, only after a fight, a curio searched or a crisis. Separate paragraphs with a blank line. Plain prose: no headings, no lists, no capitals for emphasis, and never open with a tally or a page number, the card above your words already shows them.",
  "Write every number as digits (33 health, 38 stress), never in words.",
  "Every change you name in health, stress, light or the packs carries its cause, read from THE PAGE or WHAT HAPPENED SINCE MY LAST WORD: the blow and who struck it with what, a trap or a curio and what it laid, hunger, a bleed or a blight ticking, a heal. Say the cause is unknown only when no page there holds one.",
  "Use only what the page and the thread say. Never name a foe, a trap, a curio or what lies ahead unless the page names it; never say what a curio would give before it was searched; never give a number that is not on the page.",
  "Never use an em dash. Never name a save, a file, a field, a page number, a tool or a model: stay in the Hamlet's words.",
  "THE HEIR'S WAYS are habits he has told you; follow them in what you advise, and never advise against one.",
].join(" ")

// what a page in a fight asks of him: short, and the fight alone
export const FIGHT = "This page is in a fight. Comment the fight alone, in one or two short paragraphs: which foe threatens whom, which foe to strike first and why, and who needs healing. Nothing about the packs, the map or the road ahead."

// C74: the campfire council, his one visit on a road in camp mode (#8; Soushi, 06:09: "Only at the camp ... for bilan of the
// situation and advices")
export const COUNCIL = "Your four have made camp, and you have come out from the Hamlet to their fire for one council; you will not speak again on this road unless the Heir asks. Speak as one who has walked out to them, conversational and clear, to the Heir. Cover, in this order and in short paragraphs: the road so far, from every page since they left (what they fought, found and lost, each with its cause); how each of the four stands now (health, stress, any affliction, disease or quirk the road gave them); the packs; how far the quest has come; what lies ahead, only as far as the page names it; and what to do at this fire: which camping skill on whom, and why, from the skills they took to camp, spending the camp points well. The card beside your words carries the numbers, so name only those that carry your advice."

/** The prompt for one page or one question: the page whole, then the last lines of the thread, then what to answer. */
export async function promptFor(kind: "page" | "ask" | "camp", snapshot: string, ask = "", since: string[] = []): Promise<string> {
  const thread = (await feed()).lines.slice(-10).map((l) => `${l.from === "soushi" ? "The Heir" : "The Caretaker"}: ${l.text}`).join("\n")
  const ways = await readWays()
  // C73: every page told since his last word, in the stream's own words, so a change he names has its cause in front of him
  return [ways.length ? `THE HEIR'S WAYS\n${ways.map((w) => `- ${w}`).join("\n")}` : "", since.length ? `WHAT HAPPENED SINCE MY LAST WORD\n${since.join("\n")}` : "", `THE PAGE\n${snapshot}`, thread ? `THE THREAD SO FAR\n${thread}` : "",
    kind === "ask" ? `THE HEIR ASKS\n${ask}\nAnswer him. If he states a standing habit of his own, end with one last line \"WAY: <the habit, in one short line>\"; otherwise do not.`
      // C71: in a fight he speaks of the fight alone (Soushi, 05:42: "more focused on it and clear")
      : kind === "camp" ? COUNCIL
      : /\nFOES front to back:/.test(snapshot) ? FIGHT : "Comment this page."].filter(Boolean).join("\n\n")
}

// the Heir's ways, one habit a line, kept beside the board (pm#35); the PM writes it, and an answer to a stated habit adds to it
export const waysFile = () => join(outDir(), "ways.md")
export async function readWays(): Promise<string[]> {
  return (await Bun.file(waysFile()).text().catch(() => "")).split("\n").map((l) => l.replace(/^\s*[-*]\s*/, "").trim()).filter(Boolean)
}

/** One inference call; the text, or undefined when it failed, timed out or said nothing. */
export async function ask(system: string, user: string): Promise<{ text?: string; error?: string }> {
  const p = Bun.spawn(["bun", inference(), "--level", level(), system, user], { stdout: "pipe", stderr: "pipe", env: { ...process.env } })
  const timer = setTimeout(() => p.kill(), limit())
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  clearTimeout(timer)
  if (p.signalCode) return { error: `timed out after ${limit() / 1000} s` }
  if (code !== 0) return { error: `exit ${code}: ${err.trim().split("\n").at(-1) ?? ""}` }
  const text = out.trim().replace(/\s*—\s*/g, ", ")
  return text ? { text } : { error: "an empty answer" }
}

/** Comment one page or answer one question, posting through say(); a failure posts nothing and prints a WARN. */
export async function comment(kind: "page" | "ask" | "camp", snapshot: string, page: string, question = "", since: string[] = []): Promise<boolean> {
  // C81: the road page shows him at the fire while a council is being written, and only then
  const mode = process.env.DD_CARETAKER_MODE === "live" ? "live" : "camp"
  if (kind === "camp") setCaretaker({ mode, council: { page, at: new Date().toISOString() } })
  const r = await ask(SYSTEM, await promptFor(kind, snapshot, question, since)).finally(() => { if (kind === "camp") setCaretaker({ mode }) })
  if (!r.text) { console.log(`WARN ${clock()} caretaker: no comment on page ${page} (${r.error})`); return false }
  // a page's comment is his recap, the report beside the conversation (C66); an answer to the Heir is a plain line
  // a tally opener is the card's job, not his (pm#34); a stated habit goes to his ways (pm#35)
  let text = r.text.replace(/^\s*the road so far[^:\n]*:\s*/i, "")
  const way = text.match(/\n?\s*WAY:\s*(.+)\s*$/)
  if (way) {
    text = text.slice(0, way.index).trimEnd()
    const ways = await readWays()
    if (!ways.some((w) => w.toLowerCase() === way[1]!.trim().toLowerCase())) appendFileSync(waysFile(), `- ${way[1]!.trim()}\n`)
  }
  if (kind !== "ask") await sayRecap(page, { advice: text })
  else say(text, page)
  console.log(`SAID ${clock()} page ${page}: ${r.text.replace(/\s+/g, " ").slice(0, 160)}`)
  return true
}

/** The stream read by the Caretaker. In live mode (C73), one report per CHRON page and one answer per ASK, each prompt holding
 *  every page told since his last word (Soushi, 05:59: "It should see all the pages, but only make one report"); a plain PAGE
 *  is only kept, and a CHRON he failed to comment stays kept. In camp mode (C74, the default), every page is kept from the moment
 *  the party leaves the Hamlet, and he speaks once per camp: when a page first shows them at the fire, with the whole road so
 *  far; an ASK is answered at any time and spends nothing. */
export function streamFlow(post: typeof comment, snapshot: () => Promise<{ text: string; page: string } | undefined>,
  opts: { mode?: "live" | "camp"; atCamp?: (page: string) => Promise<{ text: string } | undefined> } = {}) {
  const mode = opts.mode ?? "live"
  let block: string[] = [], since: string[] = [], fire = false, quiet = false
  const end = async () => {
    if (!block.length) return
    const lines = block; block = []
    const page = lines[0]!.match(/#(\d+)/)?.[1], text = lines.map((l) => l.replace(/^MORE /, "")).join("\n")
    if (mode === "camp") {
      since.push(text)
      // a page retold on a restart is kept and never called on: its council, if it had one, was already given (C82)
      if (quiet) { fire = !!(page && opts.atCamp && await opts.atCamp(page)); return }
      const camp = page && opts.atCamp ? await opts.atCamp(page) : undefined
      // one council per camp: the first page at the fire calls him, the pages after it while they rest do not
      if (camp && !fire) fire = await post("camp", camp.text, page!, "", since.slice(0, -1).concat(text))
      if (!camp) fire = false
      return
    }
    if (lines[0]!.startsWith("PAGE ")) { since.push(text); return }
    // the page whole, as the MORE lines carry it; the head line's own changes go first
    if (page && await post("page", text, page, "", since)) since = []
    else since.push(text)
  }
  const line = async (l: string) => {
    if (l.startsWith("MORE ") && block.length) { block.push(l); return }
    await end()
    // a new road: the pages kept are the last road's (camp mode keeps them for the whole road)
    if (l.startsWith("SAVE ") && / dungeon$/.test(l)) { since = []; fire = false; return }
    if (l.startsWith("CHRON ") || l.startsWith("PAGE ")) block.push(l)
    else if (l.startsWith("ASK ")) { const s = await snapshot(); if (s && await post("ask", s.text, s.page, l.replace(/^ASK \S+ page \S+: /, ""), since) && mode === "live") since = [] }
  }
  /** The pages a restart retells (C82): kept as if they had just been told, none of them commented. */
  const seed = async (lines: string[]) => { quiet = true; for (const l of lines) await line(l); await end(); quiet = false }
  return { line, end, seed, kept: () => since.length }
}

/** The page at the fire, whole, with what the four took to camp, or undefined when this page shows no camp (C74). */
async function atCamp(page: string): Promise<{ text: string } | undefined> {
  const c = current()
  if (!c.file) return undefined
  const file = join(dirname(c.file), `${page}.json`), prevFile = join(dirname(c.file), `${String(Number(page) - 1).padStart(page.length, "0")}.json`)
  const p = (await Bun.file(file).json().catch(() => undefined)) as Snap | undefined, raw = await Bun.file(file.replace(/\.json$/, ".raw.json")).json().catch(() => undefined)
  if (!p) return undefined
  const prev = (await Bun.file(prevFile).json().catch(() => undefined)) as Snap | undefined
  const why = camping(prev, p, raw)
  if (!why) return undefined
  console.log(`CAMP ${clock()} page ${page}: ${why}`)
  return { text: `${await nowText(p, raw, page, statSync(file).mtimeMs, file)}\n${await campBrief(p, raw)}` }
}

async function snapshotNow(): Promise<{ text: string; page: string } | undefined> {
  const c = current()
  if (!c.file) return undefined
  const p = (await Bun.file(c.file).json()) as Snap, raw = await Bun.file(c.file.replace(/\.json$/, ".raw.json")).json().catch(() => undefined)
  return { text: await nowText(p, raw, c.page!, statSync(c.file).mtimeMs, c.file), page: c.page! }
}

if (import.meta.main) {
  // the live stream under the caretaker's own mark, so the agent's stream keeps its own place (C62)
  const live = Bun.spawn(["bun", join(import.meta.dir, "live.ts")], { env: { ...process.env, DD_LIVE_MARK: "caretaker-last.txt" }, stdout: "pipe" })
  console.log(`CARETAKER ${clock()} ${process.env.DD_CARETAKER_MODE === "live" ? "commenting CHRON pages" : "keeping the pages for the campfire council"} and answering ASKs through ${inference()} at ${level()}`)
  // stopping the Caretaker stops his stream too, so no live process is left behind
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => { live.kill(); process.exit(0) })
  // camp is the default for now (Soushi, 06:09); DD_CARETAKER_MODE=live brings back a word on every CHRON page
  const mode = process.env.DD_CARETAKER_MODE === "live" ? "live" : "camp"
  setCaretaker({ mode })
  const flow = streamFlow(comment, snapshotNow, { mode, atCamp })
  // C82: restarted mid-road in camp mode, he retells the trip up to the last page he was told, so the council still has the
  // whole road; the live stream then carries on after that page, so no page is kept twice
  const mark = join(outDir(), "caretaker-last.txt"), told = await Bun.file(mark).text().then((t) => t.trim()).catch(() => "")
  if (mode === "camp" && told && current().trip && told.split("/").slice(-2, -1)[0] === current().trip) {
    const r = Bun.spawn(["bun", join(import.meta.dir, "live.ts")], { env: { ...process.env, DD_LIVE_RETELL: told, DD_LIVE_MARK: "caretaker-retell.txt" }, stdout: "pipe" })
    await flow.seed((await new Response(r.stdout).text()).split("\n"))
    console.log(`CARETAKER ${clock()} kept ${flow.kept()} pages of this road from before the restart`)
  }
  let buf = ""
  const decoder = new TextDecoder()
  for await (const chunk of live.stdout) {
    buf += decoder.decode(chunk)
    const parts = buf.split("\n"); buf = parts.pop() ?? ""
    for (const l of parts) await flow.line(l)
    // a CHRON block arrives in one write, so the end of a chunk closes it
    await flow.end()
  }
}
