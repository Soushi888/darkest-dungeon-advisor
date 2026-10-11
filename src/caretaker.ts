// bun run caretaker (C64): the Caretaker comments the road by himself, one rung down, so the agent watching a live session
// no longer spends a full turn on every page (Soushi, 2026-10-11 04:52: apply the token recommendations). It runs the live
// stream under its own mark, and on each CHRON block (the page whole, C63) and each ASK from the road it builds a short
// prompt (the page as bun run now prints it, the last ten lines of the thread, the boundary and voice rules) and asks the
// PAI Inference tool, then posts the answer through say(). A call that fails or times out posts nothing and prints a WARN.
// It never imports a model SDK and never spawns claude; it only writes the road thread (ISA A1).
import { homedir } from "node:os"
import { join } from "node:path"
import { appendFileSync, statSync } from "node:fs"
import { nowText } from "./now.ts"
import { current, feed, say, sayRecap } from "./road.ts"
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
  "Use only what the page and the thread say. Never name a foe, a trap, a curio or what lies ahead unless the page names it; never say what a curio would give before it was searched; never give a number that is not on the page.",
  "Never use an em dash. Never name a save, a file, a field, a page number, a tool or a model: stay in the Hamlet's words.",
  "THE HEIR'S WAYS are habits he has told you; follow them in what you advise, and never advise against one.",
].join(" ")

/** The prompt for one page or one question: the page whole, then the last lines of the thread, then what to answer. */
export async function promptFor(kind: "page" | "ask", snapshot: string, ask = ""): Promise<string> {
  const thread = (await feed()).lines.slice(-10).map((l) => `${l.from === "soushi" ? "The Heir" : "The Caretaker"}: ${l.text}`).join("\n")
  const ways = await readWays()
  return [ways.length ? `THE HEIR'S WAYS\n${ways.map((w) => `- ${w}`).join("\n")}` : "", `THE PAGE\n${snapshot}`, thread ? `THE THREAD SO FAR\n${thread}` : "",
    kind === "ask" ? `THE HEIR ASKS\n${ask}\nAnswer him. If he states a standing habit of his own, end with one last line \"WAY: <the habit, in one short line>\"; otherwise do not.` : "Comment this page."].filter(Boolean).join("\n\n")
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
export async function comment(kind: "page" | "ask", snapshot: string, page: string, question = ""): Promise<boolean> {
  const r = await ask(SYSTEM, await promptFor(kind, snapshot, question))
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
  if (kind === "page") await sayRecap(page, { advice: text })
  else say(text, page)
  console.log(`SAID ${clock()} page ${page}: ${r.text.replace(/\s+/g, " ").slice(0, 160)}`)
  return true
}

async function snapshotNow(): Promise<{ text: string; page: string } | undefined> {
  const c = current()
  if (!c.file) return undefined
  const p = (await Bun.file(c.file).json()) as Snap, raw = await Bun.file(c.file.replace(/\.json$/, ".raw.json")).json().catch(() => undefined)
  return { text: await nowText(p, raw, c.page!, statSync(c.file).mtimeMs), page: c.page! }
}

if (import.meta.main) {
  // the live stream under the caretaker's own mark, so the agent's stream keeps its own place (C62)
  const live = Bun.spawn(["bun", join(import.meta.dir, "live.ts")], { env: { ...process.env, DD_LIVE_MARK: "caretaker-last.txt" }, stdout: "pipe" })
  console.log(`CARETAKER ${clock()} commenting CHRON pages and ASKs through ${inference()} at ${level()}`)
  // stopping the Caretaker stops his stream too, so no live process is left behind
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => { live.kill(); process.exit(0) })
  let buf = "", block: string[] = []
  const flush = async () => {
    if (!block.length) return
    const lines = block; block = []
    const page = lines[0]!.match(/#(\d+)/)?.[1]
    // the page whole, as the MORE lines carry it; the head line's own changes go first
    if (page) await comment("page", lines.map((l) => l.replace(/^MORE /, "")).join("\n"), page)
  }
  const decoder = new TextDecoder()
  for await (const chunk of live.stdout) {
    buf += decoder.decode(chunk)
    const parts = buf.split("\n"); buf = parts.pop() ?? ""
    for (const l of parts) {
      if (l.startsWith("MORE ") && block.length) { block.push(l); continue }
      await flush()
      if (l.startsWith("CHRON ")) block.push(l)
      else if (l.startsWith("ASK ")) { const s = await snapshotNow(); if (s) await comment("ask", s.text, s.page, l.replace(/^ASK \S+ page \S+: /, "")) }
    }
    // a CHRON block arrives in one write, so the end of a chunk closes it
    await flush()
  }
}
