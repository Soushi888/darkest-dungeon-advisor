// C108: every refactor step keeps the pinned boards and road pages byte for byte (src/golden.ts). The cases are pinned copies of
// a personal save, so the test is skipped where none is pinned; a skipped check is not a passing one.
import { describe, expect, test } from "bun:test"
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { accept, check, goldenDir } from "../src/golden.ts"
import { root } from "../src/sources/paths.ts"

const has = existsSync(goldenDir()) && readdirSync(goldenDir()).some((d) => existsSync(join(goldenDir(), d, "expect", "town.md")))

describe.skipIf(!has)("C108: the golden boards hold", () => {
  test("every pinned case rebuilds byte for byte", async () => {
    const { cases, drift } = await check()
    expect(cases.length).toBeGreaterThan(0)
    expect(drift).toEqual([])
  }, 120_000)
})

// a worktree that defaults to the main checkout's cases must never overwrite them: accept there asks for DD_GOLDEN
describe("C108: golden accept stays out of the main checkout's cases from a worktree", () => {
  test("accept is refused outside the main checkout unless DD_GOLDEN is set", async () => {
    const { acceptRefusal } = await import("../src/golden.ts")
    expect(acceptRefusal("/repo/.claude/worktrees/x", "/repo", undefined)).toContain("DD_GOLDEN")
    expect(acceptRefusal("/repo/.claude/worktrees/x", "/repo", "/tmp/cases")).toBeUndefined()
    expect(acceptRefusal("/repo", "/repo", undefined)).toBeUndefined()
    // and the command itself, run from here: in a worktree with DD_GOLDEN unset it refuses before touching anything
    const env = { ...process.env }; delete env.DD_GOLDEN
    const r = Bun.spawnSync(["bun", "src/golden.ts", "accept"], { cwd: root, env })
    const inWorktree = Bun.spawnSync(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root }).stdout.toString().trim() !== join(root, ".git")
    if (inWorktree) { expect(r.exitCode).not.toBe(0); expect(r.stderr.toString() + r.stdout.toString()).toContain("DD_GOLDEN") }
  })
})

// a step that changes the board on purpose takes its new expectation from each case's own profile and state, never the live ones
describe.skipIf(!has)("C108: golden accept", () => {
  const files = (d: string, base = d): string[] => readdirSync(d).sort().flatMap((f) => statSync(join(d, f)).isDirectory() ? files(join(d, f), base) : [join(d, f).slice(base.length + 1)])
  const snapshot = (d: string) => Object.fromEntries(files(d).map((f) => [f, readFileSync(join(d, f), "latin1")]))

  test("accept rebuilds a case from its stored profile and state, drops what is no longer written, and check then holds", async () => {
    const src = goldenDir(), name = readdirSync(src).filter((d) => existsSync(join(src, d, "expect", "town.md"))).sort()[0]!
    const scratch = join(root, ".dd-runtime", "test-golden-accept"), saved = { golden: process.env.DD_GOLDEN, profile: process.env.DD_PROFILE }
    rmSync(scratch, { recursive: true, force: true })
    cpSync(join(src, name), join(scratch, name), { recursive: true, preserveTimestamps: true })
    const dir = join(scratch, name), kept = { profile: snapshot(join(dir, "profile")), state: snapshot(join(dir, "state")) }
    // an expectation the current code no longer meets, and a file it no longer writes
    writeFileSync(join(dir, "expect", "town.md"), readFileSync(join(dir, "expect", "town.md"), "utf8") + "\nan old line\n")
    writeFileSync(join(dir, "expect", "stale.md"), "written by an older build")
    try {
      process.env.DD_GOLDEN = scratch
      // a live profile that does not exist: a build that read it would fail
      process.env.DD_PROFILE = join(scratch, "no-live-profile")
      expect((await check()).drift.length).toBeGreaterThan(0)
      expect(await accept(name)).toEqual([name])
      expect(existsSync(join(dir, "expect", "stale.md"))).toBe(false)
      expect(readFileSync(join(dir, "expect", "town.md"), "utf8")).not.toContain("an old line")
      expect((await check()).drift).toEqual([])
      // the case's own profile and state are read, never written
      expect(snapshot(join(dir, "profile"))).toEqual(kept.profile)
      expect(snapshot(join(dir, "state"))).toEqual(kept.state)
      await expect(accept("no-such-case")).rejects.toThrow("no golden case named no-such-case")
    } finally {
      for (const [k, v] of [["DD_GOLDEN", saved.golden], ["DD_PROFILE", saved.profile]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v
      rmSync(scratch, { recursive: true, force: true })
    }
  }, 240_000)
})
