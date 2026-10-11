// C63: a CHRON line carries the page whole, as bun run now prints it, so the agent comments from the line alone.
import { describe, expect, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { chronBlock, nowText } from "../src/now.ts"
import { root } from "../src/paths.ts"

const hero = (name: string, guid: number) => ({ guid, name, cls: "crusader", hp: 18, maxHp: 26, stress: 40, affliction: "", virtue: "", deathsDoor: false, lastBlow: "", effects: ["speed_rating 1 (2)"] })
const page = (tally: Record<string, number>) => ({ at: "", dungeon: "cove", difficulty: 1, length: 1, quest: "cleanse", key: "k", torch: 70, inBattle: false, supplies: { food: 4, torch: 3 }, tally, heroes: [hero("Reynauld", 1), hero("Dismas", 2)] }) as any

describe("C63: the CHRON line carries the page whole", () => {
  test("every line bun run now prints for the page follows the CHRON line, each as a MORE line under 400 characters", async () => {
    const p = page({ BATTLE_COMPLETED: 1 }), snap = (await nowText(p, undefined, "0007", Date.now())).split("\n")
    const block = await chronBlock(["CHRON 05:00:00 #0007 a battle won"], p, undefined, "0007", Date.now())
    expect(block[0]).toStartWith("CHRON ")
    for (const l of block.slice(1)) { expect(l).toStartWith("MORE "); expect(l.length).toBeLessThanOrEqual(400) }
    const said = block.slice(1).map((l) => l.slice(5)).join(" ")
    for (const l of snap) expect(said).toContain(l.trim())
  })

  test("the stream prints the snapshot with a CHRON page, and not with a PAGE", async () => {
    const out = join(root, ".dd-runtime", "test-chron"), trip = join(out, "chronicle", "generated_1_t")
    rmSync(out, { recursive: true, force: true }); mkdirSync(trip, { recursive: true })
    await Bun.write(join(trip, "0000.json"), JSON.stringify(page({})))
    await Bun.write(join(trip, "0001.json"), JSON.stringify(page({ BATTLE_COMPLETED: 1 })))
    const p = Bun.spawn(["bun", "src/live.ts"], { cwd: root, env: { ...process.env, DD_TOWN_OUT: out, DD_LIVE_REPLAY: "1" }, stdout: "pipe" })
    await Bun.sleep(3500); p.kill()
    const text = await new Response(p.stdout).text()
    rmSync(out, { recursive: true, force: true })
    expect(text).toMatch(/^CHRON .*#0001/m)
    expect(text).toContain("MORE PAGE 0001")
    expect(text).toContain("MORE HEROES front to back:")
    expect(text).toContain("MORE SUPPLIES food 4, torch 3; light 70")
  }, 15_000)
})
