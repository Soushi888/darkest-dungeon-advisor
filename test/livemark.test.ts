// C62: a restarted live stream resumes where it left off, by when pages were saved, never by their path. Two trips whose
// folder names sort against their age, as the Warrens trip (generated_2_*) came after the Cove's (generated_3_*).
import { describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, utimesSync } from "node:fs"
import { join } from "node:path"
import { alreadyTold, inOrder } from "../src/livemark.ts"
import { root } from "../src/paths.ts"

const old = (n: number) => ({ path: `/c/generated_3_old/${String(n).padStart(4, "0")}.json`, mtime: 1000 + n })
const now = (n: number) => ({ path: `/c/generated_2_new/${String(n).padStart(4, "0")}.json`, mtime: 5000 + n })
const pages = [...[0, 1, 2, 165].map(old), ...[0, 7, 8, 9, 10].map(now)]

describe("C62: the live stream resumes by save order", () => {
  test("pages are ordered by when they were saved, not by their folder's name", () => {
    expect(inOrder(pages).map((p) => p.path).slice(-5)).toEqual([0, 7, 8, 9, 10].map((n) => now(n).path))
  })

  test("a mark on the new trip tells only its later pages, and none of the old trip", () => {
    const told = alreadyTold(pages, now(8).path)
    expect(pages.filter((p) => !told.has(p.path)).map((p) => p.path)).toEqual([now(9).path, now(10).path])
  })

  test("a mark left on the old trip's last page still tells every page of the new trip", () => {
    const told = alreadyTold(pages, old(165).path)
    expect(pages.filter((p) => !told.has(p.path)).map((p) => p.path)).toEqual([0, 7, 8, 9, 10].map((n) => now(n).path))
  })

  test("a replay tells the last pages saved, and no mark tells nothing again", () => {
    const told = alreadyTold(pages, "", 2)
    expect(pages.filter((p) => !told.has(p.path)).map((p) => p.path)).toEqual([now(9).path, now(10).path])
    expect(alreadyTold(pages, "").size).toBe(pages.length)
  })

  test("the stream itself, restarted with its mark mid-trip, prints only the pages after it", async () => {
    const out = join(root, ".dd-runtime", "test-livemark")
    rmSync(out, { recursive: true, force: true })
    const page = { at: "", dungeon: "warrens", difficulty: 1, length: 1, quest: "explore", key: "k", torch: 80, inBattle: false, supplies: {}, tally: {}, heroes: [] }
    const write = async (trip: string, n: number, t: number) => { const f = join(out, "chronicle", trip, `${String(n).padStart(4, "0")}.json`); mkdirSync(join(out, "chronicle", trip), { recursive: true }); await Bun.write(f, JSON.stringify({ ...page, torch: 80 - n })); utimesSync(f, t, t) }
    for (const n of [0, 1, 2, 3]) await write("generated_3_old", n, 1_000_000 + n)
    for (const n of [0, 1, 2, 3]) await write("generated_2_new", n, 2_000_000 + n)
    await Bun.write(join(out, "live-last.txt"), join(out, "chronicle", "generated_2_new", "0001.json"))
    const p = Bun.spawn(["bun", "src/live.ts"], { cwd: root, env: { ...process.env, DD_TOWN_OUT: out }, stdout: "pipe" })
    await Bun.sleep(3500); p.kill()
    const lines = (await new Response(p.stdout).text()).split("\n").filter((l) => /^(PAGE|CHRON) /.test(l)).map((l) => l.match(/#(\d+)/)![1])
    rmSync(out, { recursive: true, force: true })
    expect(lines).toEqual(["0002", "0003"])
  }, 15_000)
})
