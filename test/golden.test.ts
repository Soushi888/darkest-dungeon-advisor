// C108: every refactor step keeps the pinned boards and road pages byte for byte (src/golden.ts). The cases are pinned copies of
// a personal save, so the test is skipped where none is pinned; a skipped check is not a passing one.
import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { check, goldenDir } from "../src/golden.ts"

const has = existsSync(goldenDir()) && readdirSync(goldenDir()).some((d) => existsSync(join(goldenDir(), d, "town.md")))

describe.skipIf(!has)("C108: the golden boards hold", () => {
  test("every pinned case rebuilds byte for byte", async () => {
    const { cases, drift } = await check()
    expect(cases.length).toBeGreaterThan(0)
    expect(drift).toEqual([])
  }, 120_000)
})
