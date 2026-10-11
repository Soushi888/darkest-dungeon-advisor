// `bun run ship <pr>` (C72): the only way a PR reaches main. It checks that the PR's head is the commit checked out here,
// runs the typecheck and the whole suite twice on it, and marks the PR ready and squash-merges it only when every run says
// 0 fail with at least one test passed. PR #38 was merged on 2026-10-11 with a red suite because the merge did not wait
// on the test result; a skipped suite (no local profile) proves nothing, so it refuses too.
import { spawnSync } from "node:child_process"

export interface Run { pass: number; fail: number; code: number }

/** One `bun test` run read from its output: the pass and fail totals, or zeros when the summary is missing. */
export function readRun(output: string, code: number): Run {
  const n = (word: string) => Number(output.match(new RegExp(`^\\s*(\\d+) ${word}$`, "m"))?.[1] ?? 0)
  return { pass: n("pass"), fail: n("fail"), code }
}

/** Why these runs must not merge, or "" when they may: every run exits 0, says 0 fail, and passed something. */
export function refusal(runs: Run[]): string {
  if (!runs.length) return "no test run"
  for (const [i, r] of runs.entries()) {
    if (r.fail > 0) return `run ${i + 1}: ${r.fail} fail`
    if (r.code !== 0) return `run ${i + 1}: bun test exited ${r.code}`
    if (r.pass === 0) return `run ${i + 1}: nothing passed (is the profile there? a skipped suite is not a passing one)`
  }
  return ""
}

const sh = (cmd: string, args: string[]) => {
  const p = spawnSync(cmd, args, { encoding: "utf8", env: process.env })
  return { out: `${p.stdout ?? ""}${p.stderr ?? ""}`, code: p.status ?? 1 }
}

if (import.meta.main) {
  const pr = process.argv[2], times = Number(process.argv.find((a) => a.startsWith("--runs="))?.slice(7) ?? 2)
  if (!pr) { console.error("usage: bun run ship <pr number> [--runs=N]"); process.exit(2) }
  const head = sh("gh", ["pr", "view", pr, "--json", "headRefOid,state", "-q", ".headRefOid + \" \" + .state"]).out.trim().split(" ")
  const here = sh("git", ["rev-parse", "HEAD"]).out.trim()
  if (head[1] !== "OPEN") { console.error(`PR ${pr} is ${head[1] ?? "unknown"}, not open`); process.exit(1) }
  if (head[0] !== here) { console.error(`PR ${pr}'s head is ${head[0]?.slice(0, 7)}, but ${here.slice(0, 7)} is checked out here: test what will merge`); process.exit(1) }
  const tc = sh("bun", ["run", "typecheck"])
  if (tc.code !== 0) { console.error(`REFUSED: typecheck failed\n${tc.out}`); process.exit(1) }
  const runs: Run[] = []
  for (let i = 0; i < times; i++) {
    const t = sh("bun", ["test"])
    runs.push(readRun(t.out, t.code))
    console.log(`run ${i + 1}: ${runs.at(-1)!.pass} pass, ${runs.at(-1)!.fail} fail`)
    if (refusal(runs)) { console.error(t.out.split("\n").filter((l) => l.startsWith("(fail)")).join("\n")); break }
  }
  const why = refusal(runs)
  if (why) { console.error(`REFUSED: ${why}. Nothing merged.`); process.exit(1) }
  for (const args of [["pr", "ready", pr], ["pr", "merge", pr, "--squash"]]) {
    const r = sh("gh", args)
    if (r.code !== 0) { console.error(`gh ${args.join(" ")} failed:\n${r.out}`); process.exit(1) }
  }
  console.log(`MERGED ${sh("gh", ["pr", "view", pr, "--json", "mergeCommit", "-q", ".mergeCommit.oid"]).out.trim()}`)
}
