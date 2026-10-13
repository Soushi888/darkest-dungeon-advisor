// C53: a turn is told by what it did. Pages shaped like the Cove trip of 2026-10-11 (page 59: Wissant struck, nothing
// changed, and the foes' dodge counter rose; page 106 likewise for Emory).
import { describe, expect, test } from "bun:test"
import { turnKind } from "../src/road/turns.ts"

const hero = (name: string, hp: number, more: object = {}) => ({ name, guid: 100 + name.charCodeAt(0) * 7 + name.charCodeAt(1), hp, stress: 30, effects: [] as string[], ...more })
const foe = (name: string, guid: number, hp: number, more: object = {}) => ({ name, guid, hp, effects: [] as string[], ...more })
const before = { heroes: [hero("Wissant", 26), hero("Emory", 18), hero("Guernon", 19), hero("Fossard", 15)], foes: [foe("Drowned Thrall", 10, 7), foe("Deep Stinger", 11, 10)] }
const after = (f: (s: typeof before) => void) => { const s = structuredClone(before); f(s); return s }

describe("C53: what a turn did", () => {
  test("a blow that lands is a hit, a blow the foe dodged is a dodge, never a miss", () => {
    expect(turnKind(before, after((s) => { s.foes[0]!.hp = 2 }), { name: "Wissant", side: "hero" }, [0, 0]).kind).toBe("hit")
    const d = turnKind(before, after(() => {}), { name: "Emory", side: "hero" }, [0, 1])
    expect(d.kind).toBe("dodge")
    expect(d.said).toBe("Emory struck, and the foe dodged")
    // the counter held, not rose: that turn was not a dodge
    expect(turnKind(before, after(() => {}), { name: "Emory", side: "hero" }, [1, 1]).kind).toBe("unknown")
  })

  test("a foe that falls was struck, and a mark or a stun laid on it counts as a hit", () => {
    expect(turnKind(before, after((s) => { s.foes.shift() }), { name: "Fossard", side: "hero" }, [0, 0]).kind).toBe("hit")
    expect(turnKind(before, after((s) => { s.foes[1]!.effects = ["damage_low vs tagged 0.2 (3)"] }), { name: "Fossard", side: "hero" }, [0, 0]).kind).toBe("hit")
  })

  test("a turn that only shuffles the ranks is a move; one that mends is a heal; one that strengthens is a buff", () => {
    expect(turnKind(before, after((s) => { s.heroes.reverse() }), { name: "Emory", side: "hero" }, [0, 0]).kind).toBe("move")
    expect(turnKind(before, after((s) => { s.heroes[1]!.hp = 28 }), { name: "Guernon", side: "hero" }, [0, 0]).kind).toBe("heal")
    expect(turnKind(before, after((s) => { s.heroes[0]!.effects = ["speed_rating 1 (3)"] }), { name: "Wissant", side: "hero" }, [0, 0]).kind).toBe("buff")
  })

  test("a foe's turn is a hit on health or stress, and one that changes nothing is never called a dodge", () => {
    expect(turnKind(before, after((s) => { s.heroes[3]!.stress = 40 }), { name: "Deep Stinger", side: "foe" }, [0, 0]).kind).toBe("hit")
    const m = turnKind(before, after(() => {}), { name: "Deep Stinger", side: "foe" }, [0, 1])
    expect(m.kind).toBe("unknown")
    expect(m.said).toBe("Deep Stinger missed, or did what I cannot see")
    expect(m.said).not.toMatch(/dodg/)
  })
})
