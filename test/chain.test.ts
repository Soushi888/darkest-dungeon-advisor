// C75: the road to a saved-for upgrade, from the game's upgrade files (Soushi, 2026-10-11 06:16: "detail better the target we
// save for. For example, we need armorsmith first for Stage Coach seasoned recruits").
import { describe, expect, test } from "bun:test"
import { buildingTrees } from "../src/game.ts"
import { savingPlan } from "../src/board.ts"

describe("C75: the whole road to what we save for", () => {
  test("the game's files make seasoned recruits wait on the Guild and both trees of the Blacksmith", async () => {
    const a = (await buildingTrees("stage_coach")).get("stage_coach.upgraded_recruits")!.find((r) => r.code === "a")!
    expect(a.pre).toEqual([{ tree: "guild.skill_levels", code: "b" }, { tree: "blacksmith.weapon", code: "b" }, { tree: "blacksmith.armour", code: "b" }])
  })

  test("the plan lays out every step in order, what each costs, which is buyable tonight, and the whole road against what is held", () => {
    const step = (tree: string, code: string, label: string, cost: [string, number][], ready: boolean, waits: string[] = []) =>
      ({ tree, code, label, cost: cost.map(([type, amount]) => ({ type, amount })), ready, waits })
    const chain = [
      step("guild.skill_levels", "b", "Guild: higher teachings, second tier", [["portrait", 15], ["crest", 38]], true),
      step("blacksmith.armour", "a", "Blacksmith: better armour, first tier", [["deed", 8], ["crest", 8]], false),
      step("blacksmith.armour", "b", "Blacksmith: better armour, second tier", [["deed", 20], ["crest", 21]], false, ["blacksmith.armour a"]),
      step("stage_coach.upgraded_recruits", "a", "Stage Coach: seasoned recruits, first tier", [["bust", 9], ["crest", 12]], false, ["guild.skill_levels b", "blacksmith.armour b"]),
    ]
    const target = { tree: "stage_coach.upgraded_recruits", code: "a", label: "Stage Coach: seasoned recruits", cost: chain[3]!.cost, affordable: false, blockedBy: "needs guild.skill_levels b, blacksmith.armour b", chain }
    const t = { wallet: { crest: 71, bust: 6, portrait: 20, deed: 7 }, quests: [] } as any
    const body = savingPlan(t, { heirlooms: [] } as any, target as any, {}).join("\n")
    expect(body).toContain("My plan for the seasoned recruits")
    expect(body).toContain("It waits on 3 other upgrades first. In an order the Hamlet allows: 1. Guild: higher teachings, second tier, 15 portraits and 38 crests, buyable tonight; 2. Blacksmith: better armour, first tier, 8 deeds and 8 crests, 1 deed short; 3. Blacksmith: better armour, second tier, 20 deeds and 21 crests, after step 2; 4. Stage Coach: seasoned recruits, first tier, 9 busts and 12 crests, after step 1 and step 3.")
    expect(body).toContain("The whole road costs 15 portraits (you hold 20), 79 crests (you hold 71), 28 deeds (you hold 7), 9 busts (you hold 6).")
    expect(body).toContain("8 crests short.")
  })

  test("an upgrade with nothing to wait on says so", () => {
    const target = { tree: "abbey.slots", code: "a", label: "Abbey: more beds", cost: [{ type: "crest", amount: 99 }], affordable: false, blockedBy: "", chain: [] }
    expect(savingPlan({ wallet: { crest: 1 }, quests: [] } as any, { heirlooms: [] } as any, target as any, {}).join("\n")).toContain("the game asks for no other upgrade first")
  })
})
