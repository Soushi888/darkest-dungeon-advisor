// C70: a lean to keep the heirlooms comes with a plan (Soushi, 2026-10-11 05:22: "when you propose to save for later, at least
// give a vision"): what is short, which of this week's roads pay it, how many trips at the rate the recorded roads brought it
// home, and what the other heirlooms can pay for now without delaying the target.
import { describe, expect, test } from "bun:test"
import { savingPlan } from "../src/board.ts"

const up = (label: string, cost: [string, number][], tree = "x.y") => ({ tree, label, code: "a", cost: cost.map(([type, amount]) => ({ type, amount })), affordable: true, blockedBy: "" })
const target = { ...up("Stage Coach: seasoned recruits", [["bust", 9], ["crest", 12]], "stage_coach.upgraded_recruits"), affordable: false }
const quest = (dungeonName: string, rewards: string[]) => ({ dungeonName, length: 1, goal: "Scout", plot: false, rewards }) as any
const town = { wallet: { bust: 2, crest: 63, portrait: 20, deed: 7, gold: 100 }, quests: [quest("Weald", ["2 busts", "3000 gold"]), quest("Cove", ["3 crests"])] } as any

describe("C70: the plan behind keeping the heirlooms", () => {
  test("it names the shortfall, the roads that pay it, the trips it takes, and what the rest can buy without delaying it", () => {
    const a = { heirlooms: [up("Tavern: Bar, improved", [["portrait", 4], ["crest", 10]]), up("Guild: higher teachings", [["portrait", 15], ["crest", 55]])] } as any
    const body = JSON.parse(savingPlan(town, a, target as any, { bust: { trips: 3, got: 4 } }).find((l) => l.startsWith("  body: "))!.slice(8))
    expect(body).toContain("7 busts short.")
    expect(body).toContain("This week this road pays them: the Weald, short (Scout), paying 2 busts.")
    expect(body).toContain("brought home 4 busts, about 1.3 a trip; at that rate, 6 more trips.")
    // 63 crests less the 12 the target needs leaves 51: the Bar fits, the higher teachings (55 crests) would delay it
    expect(body).toContain("Tavern: Bar, improved (4 portraits and 10 crests)")
    expect(body).not.toContain("Guild: higher teachings")
  })

  test("with no road paying it and no trip that brought it home, it says so rather than guessing", () => {
    const body = JSON.parse(savingPlan({ ...town, quests: [] }, { heirlooms: [] } as any, target as any, { bust: { trips: 2, got: 0 } }).find((l) => l.startsWith("  body: "))!.slice(8))
    expect(body).toContain("No road this week pays busts.")
    expect(body).toContain("None of the 2 roads I kept the story of brought busts home, so I cannot say how many trips.")
    expect(body).toContain("Nothing else the heirlooms can buy now leaves the target untouched.")
  })
})
