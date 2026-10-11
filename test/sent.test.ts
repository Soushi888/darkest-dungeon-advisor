// C61: on return, the road and four that left are named against what was proposed the week they left, each difference marked,
// and whose choice it was (issue #3).
import { describe, expect, test } from "bun:test"
import { sentAgainst, type Proposal } from "../src/board.ts"

const names: Record<number, string> = { 24: "Poussin", 69: "Burci", 60: "Azor", 67: "Petremol", 19: "Guernon" }
const name = (g: number) => names[g] ?? ""
const back = (dungeon: string, length: number, party: number[]) => ({ dungeon, dungeonName: dungeon === "warrens" ? "Warrens" : "Cove", quest: "explore", length, success: true, heroes: party.map((g) => ({ guid: g, name: name(g), cls: "x", died: false })) })
const proposal: Proposal = { week: 16, dungeon: "warrens", length: 1, type: "explore", label: "Warrens, short (Scout): Unmovable Helmet, 3 crests, 3000 gold", party: [24, 69, 60, 67], own: false }

describe("C61: who went, against what was proposed", () => {
  test("a trip sent as proposed says so, and whose choice it was", () => {
    expect(sentAgainst(back("warrens", 1, [24, 69, 60, 67]), proposal, name)).toBe("**Who went, against what was proposed.** Poussin, Burci, Azor, Petremol went to the Warrens, short. As proposed, my own lean.")
    expect(sentAgainst(back("warrens", 1, [24, 69, 60, 67]), { ...proposal, picked: true }, name)).toContain("As proposed, the road and four you picked.")
  })

  test("a trip sent otherwise marks the other road and each hero who went in another's place", () => {
    const said = sentAgainst(back("cove", 2, [24, 69, 60, 19]), proposal, name)
    expect(said).toContain("Poussin, Burci, Azor, Guernon went to the Cove, medium.")
    expect(said).toContain("they went to the Cove, medium, not the Warrens, short (Scout)")
    expect(said).toContain("Guernon went in place of Petremol")
  })

  test("nothing is said when nothing was proposed that week", () => {
    expect(sentAgainst(back("warrens", 1, [24]), undefined, name)).toBe("")
  })
})
