// C72: a PR merges only when every suite run says 0 fail and passed something (PR #38 merged red on 2026-10-11).
import { describe, expect, test } from "bun:test"
import { readRun, refusal } from "../src/ship.ts"

describe("C72: the merge waits on a green suite", () => {
  test("a run is read from bun test's summary", () => {
    expect(readRun("(fail) C49 ...\n\n 101 pass\n 2 fail\n 300 expect() calls\n", 1)).toEqual({ pass: 101, fail: 2, code: 1 })
    expect(readRun(" 103 pass\n 0 fail\n", 0)).toEqual({ pass: 103, fail: 0, code: 0 })
  })

  test("any failure, any non-zero exit, or nothing passed refuses the merge", () => {
    expect(refusal([{ pass: 103, fail: 0, code: 0 }, { pass: 101, fail: 2, code: 1 }])).toBe("run 2: 2 fail")
    expect(refusal([{ pass: 103, fail: 0, code: 1 }])).toMatch(/exited 1/)
    expect(refusal([{ pass: 0, fail: 0, code: 0 }])).toMatch(/nothing passed/)
    expect(refusal([])).toBe("no test run")
  })

  test("only green runs may merge", () => {
    expect(refusal([{ pass: 103, fail: 0, code: 0 }, { pass: 103, fail: 0, code: 0 }])).toBe("")
  })
})
