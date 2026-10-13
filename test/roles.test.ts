// C85: the roster's balance (Soushi, 2026-10-11 07:15: "if we have 2 heroes too similar we can dismiss one and recruit a new one
// that could better complement the roster, even if lower level").
import { describe, expect, test } from "bun:test"
import { alikePairs, gaps, rolesOf, type Member } from "../src/roles.ts"

const sk = (o: Partial<{ heal: boolean; healAvg: number; stun: boolean; marks: boolean; stressHeal: boolean; targetsAllies: boolean; launch: number[]; target: number[] }>) =>
  ({ id: "x", launch: [1, 2], targetsAllies: false, heal: false, healAvg: 0, stun: false, type: "melee", target: [1], move: [0, 0], marks: false, onMarked: false, bleed: false, blight: false, ...o }) as any
const m = (name: string, cls: string, level: number, roles: Member["roles"], bad = 0, stress = 0, guid = name.length * 7 + level): Member =>
  ({ guid, name, cls, clsName: cls, level, bad, stress, roles })

describe("C85: two of the same leave a gap elsewhere", () => {
  test("roles from the skills carried: a true heal, a stun, stress relief, a mark, and where they fight", () => {
    expect(rolesOf([sk({ heal: true, healAvg: 5, targetsAllies: true, target: [], launch: [3, 4] }), sk({ stun: true, launch: [3] }), sk({ launch: [4] })], 4)).toEqual(["healer", "stunner", "back"])
    expect(rolesOf([sk({ heal: true, healAvg: 2, targetsAllies: true, target: [] }), sk({ marks: true }), sk({ launch: [1] })], 4)).toEqual(["marker", "front"])
    expect(rolesOf([sk({ stressHeal: true, targetsAllies: true, target: [] })], 4)).toEqual(["stress"])
  })

  test("a pair is the same class only (C105); the weaker goes, never one of the four leaving", () => {
    const a = m("Patremol", "houndmaster", 1, ["marker", "back"], 4, 0, 1), g = m("Fossard", "houndmaster", 1, ["marker", "back"], 2, 0, 2)
    const d = m("Dismas", "highwayman", 2, ["front", "back"], 0, 0, 3), p = m("Papon", "man_at_arms", 1, ["front", "back"], 0, 0, 4)
    const pairs = alikePairs([a, g, d, p], new Set())
    expect(pairs.map((x) => [x.drop.name, x.keep.name, x.shared])).toEqual([["Patremol", "Fossard", "both houndmasters"]]) // front and back alone are no pair
    expect(pairs[0]!.why).toBe("Patremol carries 4 bad quirks to Fossard's 2")
    expect(alikePairs([a, g], new Set([1]))).toEqual([]) // Patremol leaves with the four: not let go
    expect(alikePairs([m("A", "houndmaster", 2, ["marker"], 0, 0, 5), m("B", "houndmaster", 0, ["marker"], 0, 0, 6)], new Set())[0]!.why).toBe("A is level 2, B level 0")
    // C105: the same roles in two classes are no pair (week 25: Papon, Man-at-Arms, and Wissant, Abomination)
    expect(alikePairs([m("Papon", "man_at_arms", 1, ["stunner", "front", "back"], 4, 0, 9), m("Wissant", "abomination", 1, ["stunner", "front", "back"], 1, 0, 10)], new Set())).toEqual([])
    // C86: two true healers are never too alike, even of one class
    expect(alikePairs([m("Azor", "vestal", 1, ["healer", "back"], 4, 0, 7), m("Gomboult", "vestal", 1, ["healer", "back"], 2, 0, 8)], new Set())).toEqual([])
  })

  test("what the roster would lack without the one let go", () => {
    const r = [m("A", "vestal", 1, ["healer"], 0, 0, 1), m("B", "vestal", 1, ["healer"], 0, 0, 2), m("C", "hellion", 1, ["stunner", "front"], 0, 0, 3)]
    expect(gaps(r, new Set([2]))).toEqual(["stress", "marker", "back", "healer", "stunner", "front"])
  })
})
