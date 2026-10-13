// C108: the golden boards, the net under the refactor (Soushi, 2026-10-13: "src is messy, it is time for a good refactoring"; the
// design is .local/brainstorms/advisor-architecture-brainstorm-2026-10-13.md). A case is a pinned copy of a profile and of the
// advisor's whole state folder beside it (every road's pages, the lessons, the proposals, the answers sent, the week's start, the
// roster ledger, the picks), and every file a build made from them: the board, the warnings, the proposal, the ledgers, the
// sources, and the road page. A refactor step keeps every case byte for byte. Cases hold a personal save, so they live under
// .dd-runtime/golden/ and are never committed (A4).
//   bun run golden pin <name> [--upto=<page>]   copy the live profile and state (the newest road cut after that page), build, keep
//   bun run golden check                        rebuild every case and compare
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, utimesSync } from "node:fs"
import { dirname, join } from "node:path"
import { profileDir, root } from "./paths.ts"

// one set of cases for the main checkout and every worktree, so a refactor step built in a worktree is checked against them
const common = () => { const r = Bun.spawnSync(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root }); return r.exitCode === 0 ? dirname(r.stdout.toString().trim()) : root }
export const goldenDir = () => process.env.DD_GOLDEN ?? join(common(), ".dd-runtime", "golden")
// a case keeps the state folder whole but for what a build only makes (the pages, the art, the warnings, the sources, the farewell's
// mark, the live watchers' marks): those must come from the build under test, never back from the copy
const BUILT = new Set(["town.md", "town.html", "img", "coherence.json", "sources.md", "farewell.key", "live-last.txt", "caretaker-last.txt"])
// what a build writes beside the board, compared like the board: the warnings, the proposal kept for the week, the ledgers
const OUTPUTS = ["town.md", "coherence.json", "proposal.json", "sources.md", "lessons.json", "roster-ledger.json", "week-start.json", "farewell.key"]

/** The newest road's pages: the trip a road page reads, and the one a cut applies to. */
function latestTrip(chron: string): string | undefined {
  if (!existsSync(chron)) return undefined
  return readdirSync(chron).map((d) => join(chron, d)).filter((d) => statSync(d).isDirectory()).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
}

/** Every file under a folder, relative and sorted. */
function files(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).sort().flatMap((f) => statSync(join(dir, f)).isDirectory() ? files(join(dir, f), base) : [join(dir, f).slice(base.length + 1)])
}

/** Copies a tree with the times of its files and of its folders: a road is found by its folder's time, which a plain copy resets. */
function copyTree(src: string, dst: string) {
  cpSync(src, dst, { recursive: true, preserveTimestamps: true })
  const fix = (a: string, b: string) => {
    if (!statSync(a).isDirectory()) return
    for (const f of readdirSync(a)) fix(join(a, f), join(b, f))
    const t = statSync(a); utimesSync(b, t.atime, t.mtime)
  }
  fix(src, dst)
}

/** Seeds an output folder with a case's state, every time kept. */
function seed(stateDir: string, out: string) {
  rmSync(out, { recursive: true, force: true })
  copyTree(stateDir, out)
}

/** Builds a case into `out`: the board and every file beside it, and the road page. A build that fails is an error, never an
 *  empty output to compare; the clock is the Hamlet's own zone, so a page's save time reads the same on any machine. */
async function build(profile: string, out: string): Promise<Record<string, string>> {
  const seeded = Object.fromEntries(files(out).map((f) => [f, statSync(join(out, f)).mtimeMs]))
  const env = { ...process.env, DD_PROFILE: profile, DD_TOWN_OUT: out, TZ: "America/Toronto" }
  const town = Bun.spawnSync(["bun", "src/cli.ts", "town"], { cwd: root, env })
  if (town.exitCode !== 0) throw new Error(`town build failed: ${town.stderr.toString().slice(0, 400)}`)
  const now = Bun.spawnSync(["bun", "src/now.ts"], { cwd: root, env })
  if (now.exitCode !== 0) throw new Error(`road page failed: ${now.stderr.toString().slice(0, 400)}`)
  // only what this build wrote counts: a file the state already held and the build left alone is not an output of the build
  const got: Record<string, string> = { "now.txt": now.stdout.toString() }
  const wrote = (rel: string) => existsSync(join(out, rel)) && (!(rel in seeded) || statSync(join(out, rel)).mtimeMs !== seeded[rel])
  for (const f of [...OUTPUTS, ...files(join(out, "proposals")).map((x) => `proposals/${x}`)]) if (wrote(f)) got[f] = await Bun.file(join(out, f)).text()
  if (!got["town.md"]?.trim()) throw new Error("the build wrote no board")
  return got
}

/** `upto` cuts the newest road's pages after that page, so a case can freeze the road mid-fight (the road page is the last kept). */
export async function pin(name: string, from = profileDir(), state = join(common(), ".local", "town"), upto?: number) {
  const dir = join(goldenDir(), name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, "profile"), { recursive: true }); mkdirSync(join(dir, "state"), { recursive: true })
  for (const f of readdirSync(from)) if (f.startsWith("persist.")) cpSync(join(from, f), join(dir, "profile", f))
  for (const f of readdirSync(state)) if (!BUILT.has(f)) copyTree(join(state, f), join(dir, "state", f))
  const trip = latestTrip(join(dir, "state", "chronicle"))
  if (trip && upto !== undefined) for (const f of readdirSync(trip)) if (Number(f.match(/^(\d+)\./)?.[1] ?? -1) > upto) rmSync(join(trip, f))
  const out = join(dir, "out")
  seed(join(dir, "state"), out)
  const got = await build(join(dir, "profile"), out)
  for (const [f, text] of Object.entries(got)) { mkdirSync(dirname(join(dir, "expect", f)), { recursive: true }); await Bun.write(join(dir, "expect", f), text) }
  rmSync(out, { recursive: true, force: true })
  return dir
}

export interface Drift { name: string; file: string; line: number; want: string; got: string }

/** Rebuilds every pinned case and lists where its outputs moved, file by file; an empty list is a step that changed nothing. */
export async function check(): Promise<{ cases: string[]; drift: Drift[] }> {
  const base = goldenDir()
  if (!existsSync(base)) return { cases: [], drift: [] }
  const cases = readdirSync(base).filter((d) => existsSync(join(base, d, "expect", "town.md"))).sort(), drift: Drift[] = []
  for (const name of cases) {
    const dir = join(base, name), out = join(root, ".dd-runtime", "golden-run", name)
    seed(join(dir, "state"), out)
    const got = await build(join(dir, "profile"), out)
    const want: Record<string, string> = {}
    for (const f of files(join(dir, "expect"))) want[f] = await Bun.file(join(dir, "expect", f)).text()
    for (const file of [...new Set([...Object.keys(want), ...Object.keys(got)])].sort()) {
      if (want[file] === got[file]) continue
      const a = (want[file] ?? "").split("\n"), b = (got[file] ?? "").split("\n")
      let i = a.findIndex((l, k) => l !== b[k])
      if (i < 0) i = a.length // the new output only grew
      const label = !(file in got) ? `${file} (no longer written)` : !(file in want) ? `${file} (newly written)` : file
      drift.push({ name, file: label, line: i + 1, want: (a[i] ?? "").slice(0, 160), got: (b[i] ?? "").slice(0, 160) })
    }
    rmSync(out, { recursive: true, force: true })
  }
  return { cases, drift }
}

if (import.meta.main) {
  const [cmd, name] = process.argv.slice(2), upto = process.argv.find((a) => a.startsWith("--upto="))?.slice(7)
  if (cmd === "pin" && name) console.log(`pinned ${name}: ${await pin(name, undefined, undefined, upto === undefined ? undefined : Number(upto))}`)
  else if (cmd === "check") {
    const { cases, drift } = await check()
    if (!cases.length) { console.log("no golden case pinned: bun run golden pin <name>"); process.exit(0) }
    for (const d of drift) console.log(`DRIFT ${d.name} ${d.file}:${d.line}\n  want ${d.want}\n  got  ${d.got}`)
    console.log(`${cases.length} case${cases.length > 1 ? "s" : ""}, ${drift.length ? `${drift.length} drifted` : "all identical"}`)
    process.exit(drift.length ? 1 : 0)
  } else console.log("bun run golden pin <name> [--upto=<page>] | bun run golden check")
}
