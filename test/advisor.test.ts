// Probes for the ISA's claims, run against a copy of the local profile. Skipped when no profile exists,
// because a save is personal and is never committed (ISA A4).
import { describe, expect, test } from "bun:test"
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import { decode } from "../src/dson.ts"
import { monster, dungeonMonsters, nameOf } from "../src/game.ts"
import { names } from "../src/names.ts"
import { readSave } from "../src/read.ts"
import { town } from "../src/town.ts"
import { profileDir, root } from "../src/paths.ts"

let profile = ""
try { profile = profileDir() } catch {}
const has = !!profile && existsSync(profile)
const fake = join(root, ".dd-runtime", "test-profile")

function copyProfile(): string {
  rmSync(fake, { recursive: true, force: true })
  mkdirSync(fake, { recursive: true })
  for (const f of readdirSync(profile)) if (f.startsWith("persist.")) cpSync(join(profile, f), join(fake, f))
  return fake
}

/** Flips persist.game.json's `inraid` bool in a copy, the way a save taken mid-expedition reads. */
async function setInRaid(dir: string, value: boolean) {
  const p = join(dir, "persist.game.json")
  const buf = new Uint8Array(await Bun.file(p).arrayBuffer())
  const needle = new TextEncoder().encode("inraid\0")
  outer: for (let i = 0; i < buf.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (buf[i + j] !== needle[j]) continue outer
    buf[i + needle.length] = value ? 1 : 0
    await Bun.write(p, buf)
    return
  }
  throw new Error("inraid field not found")
}

describe.skipIf(!has)("on the local save", () => {
  test("C3: every persist file decodes", async () => {
    for (const f of readdirSync(profile).filter((f) => f.startsWith("persist."))) {
      expect(() => decode(new Uint8Array(require("node:fs").readFileSync(join(profile, f))))).not.toThrow()
    }
  })

  test("C4: no upgrade tree or hero class stays an unresolved hash", async () => {
    const table = await names()
    const up = decode(new Uint8Array(await Bun.file(join(profile, "persist.upgrades.json")).arrayBuffer()), { names: table }) as any
    const trees = Object.values<any>(up.purchases).map((p) => p.tree_id)
    expect(trees.filter((t) => typeof t === "number")).toEqual([])
    const roster = decode(new Uint8Array(await Bun.file(join(profile, "persist.roster.json")).arrayBuffer()), { names: table }) as any
    for (const h of Object.values<any>(roster.heroes)) expect(typeof h.hero_file_data.raw_data.heroClass).toBe("string")
  })

  test("A1: a town build never writes to the profile", async () => {
    const before = readdirSync(profile).map((f) => statSync(join(profile, f)).mtimeMs)
    const proc = Bun.spawnSync(["bun", "src/cli.ts", "town"], { cwd: root })
    expect(proc.exitCode).toBe(0)
    const after = readdirSync(profile).map((f) => statSync(join(profile, f)).mtimeMs)
    expect(after).toEqual(before)
  })

  test("C6, A3: with foresight off, the board names no foe you have not fought where you have walked", async () => {
    const dir = copyProfile()
    const proc = Bun.spawnSync(["bun", "src/cli.ts", "town"], { cwd: root, env: { ...process.env, DD_PROFILE: dir } })
    expect(proc.exitCode).toBe(0)
    const md = await Bun.file(join(root, ".local", "town", "town.md")).text()
    // the advisor's own boundary: variants in a walked dungeon level with a witnessed attack
    const t = await town(await readSave(dir))
    const knownNames = new Set<string>(), unknownNames = new Set<string>()
    for (const v of t.knownVariants) knownNames.add(await nameOf("monster", v))
    for (const d of ["cove", "weald", "warrens", "crypts", "darkestdungeon"]) {
      for (const level of [1, 3, 5, 6]) {
        for (const v of await dungeonMonsters(d, level)) {
          if (t.knownVariants.includes(v)) continue
          const m = await monster(v)
          if (m) unknownNames.add(await nameOf("monster", m.id))
        }
      }
    }
    // the boundary must not lean on shared attack ids: every known variant lives in a dungeon level the
    // campaign log says was walked (a Bone Veteran shares sword_strike with the Bone Soldier)
    const save = await readSave(dir)
    const walked = new Set<string>()
    const scan = (o: any): void => { if (o && typeof o === "object") { if (typeof o.dungeon_type === "string" && typeof o.difficulty === "number") walked.add(`${o.dungeon_type}.${o.difficulty}`); Object.values(o).forEach(scan) } }
    scan(save.campaign_log)
    const reachable = new Set<string>()
    for (const w of walked) { const [d, l] = w.split("."); for (const v of await dungeonMonsters(d!, Number(l))) reachable.add(v) }
    expect(t.knownVariants.filter((v) => !reachable.has(v))).toEqual([])
    let text = md
    for (const n of [...knownNames].sort((a, b) => b.length - a.length)) text = text.replaceAll(n, "")
    const leaks = [...unknownNames].filter((n) => !knownNames.has(n) && text.includes(n))
    expect(leaks).toEqual([])
  })

  test("C8: a save taken mid-expedition is refused in character, and no board is written", async () => {
    const dir = copyProfile()
    await setInRaid(dir, true)
    const board = join(root, ".local", "town", "town.md")
    const before = existsSync(board) ? statSync(board).mtimeMs : 0
    const proc = Bun.spawnSync(["bun", "src/cli.ts", "town"], { cwd: root, env: { ...process.env, DD_PROFILE: dir } })
    expect(proc.stdout.toString()).toContain("You are not back yet")
    expect(existsSync(board) ? statSync(board).mtimeMs : 0).toBe(before)
  })

  test("C16: the live board rebuilds on a town save and waits through an expedition save", async () => {
    const dir = copyProfile()
    const port = 4391
    const w = Bun.spawn(["bun", "src/cli.ts", "watch", `--port=${port}`], { cwd: root, env: { ...process.env, DD_PROFILE: dir }, stdout: "pipe" })
    const version = async () => Number(await (await fetch(`http://127.0.0.1:${port}/version`)).text())
    try {
      for (let i = 0; i < 40; i++) { try { await version(); break } catch { await Bun.sleep(250) } }
      const v0 = await version()
      // a town save: the game rewrites its persist files
      const roster = join(dir, "persist.roster.json")
      await Bun.write(roster, await Bun.file(roster).arrayBuffer())
      await Bun.sleep(3500)
      const v1 = await version()
      expect(v1).toBe(v0 + 1)
      // an expedition save: the panel waits
      await setInRaid(dir, true)
      await Bun.sleep(3500)
      expect(await version()).toBe(v1)
      // back in the Hamlet: the Caretaker updates it
      await setInRaid(dir, false)
      await Bun.sleep(3500)
      expect(await version()).toBe(v1 + 1)
    } finally {
      w.kill()
    }
  }, 30_000)
})
