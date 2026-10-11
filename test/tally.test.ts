// C84: the estate's tally under the headline (Soushi, 2026-10-11 07:10: "I would like the number of expedition won / total
// expedition to be more visible").
import { describe, expect, test } from "bun:test"
import { headerTally } from "../src/board.ts"

describe("C84: won of all, first and large", () => {
  test("the tally sits under the headline: expeditions won of all leading, the roster of its limit, the gold", () => {
    const html = `<head></head><header class="hero"><div><h1>The <em>Hamlet</em>, week 19</h1><div class="md"><p>You are back.</p></div></div></header>`
    const out = headerTally(html, { won: 10, done: 18, roster: 16, cap: 16, gold: 2100 })
    expect(out).toContain(`<h1>The <em>Hamlet</em>, week 19</h1><div class="estate-tally"><div class="et-lead"><b>10</b><span>of 18</span><small>expeditions won</small></div><div><b>16</b><span>of 16</span><small>on the roster</small></div>`)
    expect(out).toContain("2,100</b><small>gold in the coffers</small>")
    expect(out.indexOf("estate-tally")).toBeLessThan(out.indexOf("You are back."))
    expect(headerTally(html, undefined)).toBe(html)
  })
})
