// C108: the golden boards, the net under the refactor (Soushi, 2026-10-13: "src is messy, it is time for a good refactoring"; the
// design is .local/brainstorms/advisor-architecture-brainstorm-2026-10-13.md). A case is a pinned copy of a profile and of the
// advisor's own state beside it (the latest road's pages, the lessons, the week's start, the roster ledger, the picks), and the
// board and the road page that state produced. A refactor step keeps every case byte for byte. Cases hold a personal save, so
// they live under .dd-runtime/golden/ and are never committed (A4).
//   bun run golden pin <name> [--upto=<page>]   copy the live profile and state (the road cut after that page), build, keep the outputs
//   bun run golden check        rebuild every case and compare
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { profileDir, root } from "./paths.ts"

// one set of cases for the main checkout and every worktree, so a refactor step built in a worktree is checked against them
const common = () => { const r = Bun.spawnSync(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root }); return r.exitCode === 0 ? dirname(r.stdout.toString().trim()) : root }
export const goldenDir = () => process.env.DD_GOLDEN ?? join(common(), ".dd-runtime", "golden")
const STATE = ["lessons.json", "week-start.json", "roster-ledger.json", "picks.json", "preferences.json"]

/** The newest road's pages: the only trip a board or a road page reads back. */
function latestTrip(chron: string): string | undefined {
  if (!existsSync(chron)) return undefined
  return readdirSync(chron).map((d) => join(chron, d)).filter((d) => statSync(d).isDirectory()).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
}

/** Seeds an output folder with a case's state, timestamps kept, since the newest road is found by its time. */
function seed(stateDir: string, out: string) {
  rmSync(out, { recursive: true, force: true })
  cpSync(stateDir, out, { recursive: true, preserveTimestamps: true })
}

/** Builds a case into `out` and returns what it produced: the board, and the road page when the case has one. */
async function build(profile: string, out: string): Promise<{ board: string; now: string }> {
  const env = { ...process.env, DD_PROFILE: profile, DD_TOWN_OUT: out }
  const town = Bun.spawnSync(["bun", "src/cli.ts", "town"], { cwd: root, env })
  if (town.exitCode !== 0) throw new Error(`town build failed: ${town.stderr.toString().slice(0, 400)}`)
  const now = Bun.spawnSync(["bun", "src/now.ts"], { cwd: root, env })
  const board = existsSync(join(out, "town.md")) ? await Bun.file(join(out, "town.md")).text() : ""
  return { board, now: now.stdout.toString() }
}

/** `upto` cuts the road's pages after that page, so a case can freeze the road mid-fight (the live page is the last one kept). */
export async function pin(name: string, from = profileDir(), state = join(common(), ".local", "town"), upto?: number) {
  const dir = join(goldenDir(), name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, "profile"), { recursive: true }); mkdirSync(join(dir, "state", "chronicle"), { recursive: true })
  for (const f of readdirSync(from)) if (f.startsWith("persist.")) cpSync(join(from, f), join(dir, "profile", f))
  for (const f of STATE) if (existsSync(join(state, f))) cpSync(join(state, f), join(dir, "state", f), { preserveTimestamps: true })
  const trip = latestTrip(join(state, "chronicle"))
  if (trip) {
    const to = join(dir, "state", "chronicle", trip.split("/").at(-1)!)
    cpSync(trip, to, { recursive: true, preserveTimestamps: true })
    if (upto !== undefined) for (const f of readdirSync(to)) if (Number(f.match(/^(\d+)\./)?.[1] ?? -1) > upto) rmSync(join(to, f))
  }
  const out = join(dir, "out")
  seed(join(dir, "state"), out)
  const got = await build(join(dir, "profile"), out)
  await Bun.write(join(dir, "town.md"), got.board)
  await Bun.write(join(dir, "now.txt"), got.now)
  rmSync(out, { recursive: true, force: true })
  return dir
}

export interface Drift { name: string; file: "town.md" | "now.txt"; line: number; want: string; got: string }

/** Rebuilds every pinned case and lists where its outputs moved; an empty list is a refactor that changed nothing. */
export async function check(): Promise<{ cases: string[]; drift: Drift[] }> {
  const base = goldenDir()
  if (!existsSync(base)) return { cases: [], drift: [] }
  const cases = readdirSync(base).filter((d) => existsSync(join(base, d, "town.md"))).sort(), drift: Drift[] = []
  for (const name of cases) {
    const dir = join(base, name), out = join(root, ".dd-runtime", "golden-run", name)
    seed(join(dir, "state"), out)
    const got = await build(join(dir, "profile"), out)
    for (const file of ["town.md", "now.txt"] as const) {
      const want = await Bun.file(join(dir, file)).text(), has = file === "town.md" ? got.board : got.now
      if (want === has) continue
      const a = want.split("\n"), b = has.split("\n"), i = a.findIndex((l, k) => l !== b[k])
      drift.push({ name, file, line: i + 1, want: (a[i] ?? "").slice(0, 160), got: (b[i] ?? "").slice(0, 160) })
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
  } else console.log("bun run golden pin <name> | bun run golden check")
}
