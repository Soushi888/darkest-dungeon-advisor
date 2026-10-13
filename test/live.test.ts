// C52: the live stream speaks in words, and a page arrives whole however long it runs.
import { describe, expect, test } from "bun:test"
import { effectWords, wrap } from "../src/voice/words.ts"

// every form a chronicle page kept on the Cove trip of 2026-10-11, and what each reads as
const SEEN: [string, string][] = [
  ["speed_rating 1 (3)", "speed +1 for 3 rounds"],
  ["damage_low 0.1 (2)", "damage +10% for 2 rounds"],
  ["damage_low vs tagged 0.2 (3)", "damage +20% against the marked for 3 rounds"],
  ["damage_high vs poisoned 0.25", "damage +25% against the blighted"],
  ["beast_blight_buff_1 0.2 (3)", "blight resist +20% for 3 rounds"],
  ["rake_buff_1l 0.15 (3)", "damage +15% with Rake for 3 rounds"],
  ["JELLYFISH_BLEEDRESIST_D1 -0.2 (2)", "bleed resist -20% for 2 rounds"],
  ["blight 2 (3) from grave_robber", "blight 2 a round for 3 rounds, from the Grave Robber"],
  ["STUNRECOVERYBUFF 0.5 (2)", "stun resist +50% for 2 rounds"],
  ["on_crit_bleedchance 0.2 (2)", "bleed chance +20% for 2 rounds"],
  ["defense_rating -0.1 (2)", "dodge -10 for 2 rounds"],
  ["townFlagellationDMGLowBuff 0.2", "damage +20%"],
]

describe("C52: the live stream in words", () => {
  test("each effect the trip kept reads as the game would say it, from its buff list", async () => {
    for (const [raw, said] of SEEN) expect(await effectWords(raw)).toBe(said)
  })

  test("no effect is ever told by its code, even one nobody has read yet", async () => {
    for (const raw of [...SEEN.map(([r]) => r), "stat 9 1 (2)", "some_new_buff_7 0.3 (1)"]) {
      const said = await effectWords(raw)
      expect(said).not.toMatch(/_|\bstat \d|[A-Z]{3,}/)
    }
  })

  test("a long page is cut at its seams into lines of 400 at most, every one after the first marked MORE", () => {
    const deltas = Array.from({ length: 40 }, (_, i) => `Wissant gains damage +${i}% against the marked for 3 rounds`)
    const line = `PAGE 04:05:07 #0017 light 64 | Wissant 26/26hp 27st || changed: ${deltas.join("; ")} || in the crossroads where three ways meet`
    const lines = wrap(line)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines[0]).toStartWith("PAGE ")
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(400)
    for (const l of lines.slice(1)) expect(l).toStartWith("MORE ")
    // nothing is lost: every delta and the map survive the cut
    const all = lines.join(" ")
    for (const d of deltas) expect(all).toContain(d)
    expect(all).toContain("in the crossroads where three ways meet")
    expect(lines.some((l) => /;\s*$/.test(l))).toBe(false)
    expect(wrap("PAGE short")).toEqual(["PAGE short"])
  })
})
