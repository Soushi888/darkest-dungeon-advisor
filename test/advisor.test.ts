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
import { boardOptions, mergePicks, parseAnswers, reconcile } from "../src/reconcile.ts"
import { road, source } from "../src/board.ts"
import { supplyPrices } from "../src/game.ts"
import { advise } from "../src/advise.ts"

let profile = ""
try { profile = profileDir() } catch {}
const has = !!profile && existsSync(profile)
const fake = join(root, ".dd-runtime", "test-profile")
// every board a test builds lands here, never in .local/town where the live board and its picks live
const townOut = join(root, ".dd-runtime", "test-town")
process.env.DD_TOWN_OUT = townOut

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
    const proc = Bun.spawnSync(["bun", "src/cli.ts", "town"], { cwd: root, env: { ...process.env } })
    expect(proc.exitCode).toBe(0)
    const after = readdirSync(profile).map((f) => statSync(join(profile, f)).mtimeMs)
    expect(after).toEqual(before)
  })

  test("C6, A3: with foresight off, the board names no foe you have not fought where you have walked", async () => {
    const dir = copyProfile()
    const proc = Bun.spawnSync(["bun", "src/cli.ts", "town"], { cwd: root, env: { ...process.env, DD_PROFILE: dir } })
    expect(proc.exitCode).toBe(0)
    const md = await Bun.file(join(townOut, "town.md")).text()
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
    const board = join(townOut, "town.md")
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

  test("C18: each pick the save can confirm reads done, not yet, or not as chosen; a new week starts clean", async () => {
    const t = await town(await readSave(copyProfile()))
    const free = t.heroes.find((h) => !h.busy)!
    const act = t.activities.find((a) => a.heal > 0)!
    const busy = t.heroes.find((h) => h.busy)
    const other = t.activities.find((a) => a.heal > 0 && a.name !== busy?.busy)!
    const recruit = t.recruits[0]
    const up = t.heroUpgrades[0]!
    const lines = [
      "## Soushi's answers: town", "",
      `- **3. Where does ${free.name} go?** ${act.name}`, "  - Note (refines or overrides the pick): if there is room",
      `- **4. Where does ${free.name}'s twin go?** Leave them be`,
      `- **5. Dismiss ${free.name}?** Keep`,
      `- **6. What do we train first?** ${up.hero}: ${up.label} to level ${up.toLevel}`,
    ]
    if (busy) lines.push(`- **7. Where does ${busy.name} go?** ${other.name}`)
    if (recruit) lines.push(`- **8. Recruit ${recruit.name}, ${recruit.clsName}?** Recruit`)
    const text = lines.join("\n")
    const parsed = parseAnswers(text)
    expect(parsed[`Where does ${free.name} go?`]).toEqual({ pick: act.name, note: "if there is room" })
    const status = Object.fromEntries(reconcile(mergePicks(undefined, text, t), t).map((c) => [c.question, c.status]))
    expect(status[`Where does ${free.name} go?`]).toBe("pending")
    expect(status[`Where does ${free.name}'s twin go?`]).toBe("contrary") // not on the roster
    expect(status[`Dismiss ${free.name}?`]).toBe("done")
    expect(status["What do we train first?"]).toBe("pending")
    if (busy) expect(status[`Where does ${busy.name} go?`]).toBe("contrary")
    if (recruit) expect(status[`Recruit ${recruit.name}, ${recruit.clsName}?`]).toBe("pending")
    // the same pick, once the save shows it done
    const placed = { ...t, heroes: t.heroes.map((h) => h.guid === free.guid ? { ...h, busy: act.name } : h) }
    expect(reconcile(mergePicks(undefined, text, t), placed).find((c) => c.question === `Where does ${free.name} go?`)?.status).toBe("done")
    // a later export keeps the earlier picks of the same week, and last week's picks are dropped
    const merged = mergePicks(mergePicks(undefined, text, t), `- **1. Dismiss ${free.name}?** Dismiss`, t)
    expect(merged.picks[`Where does ${free.name} go?`]?.pick).toBe(act.name)
    expect(merged.picks[`Dismiss ${free.name}?`]?.pick).toBe("Dismiss")
    expect(reconcile(merged, { ...t, week: t.week + 1 })).toEqual([])
  })

  test("C18: answers sent from the page come back as a checked list on the next board", async () => {
    const dir = copyProfile()
    const port = 4392
    const out = join(townOut)
    rmSync(join(out, "picks.json"), { force: true })
    const w = Bun.spawn(["bun", "src/cli.ts", "watch", `--port=${port}`], { cwd: root, env: { ...process.env, DD_PROFILE: dir }, stdout: "pipe" })
    try {
      for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${port}/version`); break } catch { await Bun.sleep(250) } }
      const t = await town(await readSave(dir))
      const h = t.heroes.find((x) => !x.busy)!
      const r = await fetch(`http://127.0.0.1:${port}/answers`, { method: "POST", body: `- **9. Where does ${h.name} go?** Leave them be` })
      expect(await r.text()).toBe("ok")
      const picks = await Bun.file(join(out, "picks.json")).json()
      expect(picks.week).toBe(t.week)
      const md = await Bun.file(join(out, "town.md")).text()
      expect(md).toContain("## Did you do what you chose?")
      expect(md).toContain(`Done: Where does ${h.name} go?`)
      // the check is stickies: the expedition cards keep numbers 1 and 2
      expect(md.indexOf("Which expedition next?")).toBeGreaterThan(md.indexOf("Did you do what you chose?"))
    } finally {
      w.kill()
      rmSync(join(out, "picks.json"), { force: true })
      rmSync(join(out, "answers.md"), { force: true })
      rmSync(join(out, "answers-log.md"), { force: true })
    }
  }, 30_000)

  test("C13: the board speaks in the Caretaker's voice: no save, file, field or tool is named on it", async () => {
    const dir = copyProfile()
    const proc = Bun.spawnSync(["bun", "src/cli.ts", "town"], { cwd: root, env: { ...process.env, DD_PROFILE: dir } })
    expect(proc.exitCode).toBe(0)
    // what a reader sees: the board's markdown without its block fences
    const md = (await Bun.file(join(townOut, "town.md")).text()).replace(/^```.*$/gm, "").replace(/^\s*image: .*$/gm, "")
    const meta = [/persist/i, /\.json/, /`/, /\bRULE\b/, /\bfiles?\b/i, /\bsav(e|ed|es)\b(?! them)/i, /\bboard\b/i, /\bgame\b/i, /\bsteam\b/i, /\bcode\b/i, /\b[a-z_]+\.[a-z_]+\b/]
    expect(meta.flatMap((re) => md.match(new RegExp(`.{0,30}${re.source}.{0,10}`, re.flags)) ?? [])).toEqual([])
    // the sources still exist, off the board (C14)
    expect(await Bun.file(join(townOut, "sources.md")).text()).toContain("`persist.estate.json` wallet")
  })

  test("C20: this week's town event is read, its bonus recruits offered, and its prices and closed doors applied", async () => {
    const save = await readSave(copyProfile())
    const t = await town(save)
    const te = save.town_event as any
    const bonus = Object.values<any>(te?.bonus_hero_entries ?? {}).map((h) => h.actor.name)
    if (t.event) for (const n of bonus) expect(t.recruits.find((r) => r.name === n)?.from).toBe(t.event.title)
    // the same save, as if the week's event had been Tavern Troubles: the Bar shut, the rest half price
    const chapters = Object.values<any>((save.campaign_log as any).chapters)
    const week = Object.values<any>(chapters[chapters.length - 1]).find((x) => x && typeof x === "object" && "town_event_result_id" in x)
    if (!week) return
    week.town_event_result_id = te.current_result_event_id = "lock_bar_discount_tavern"
    const u = await town(save)
    const bar = u.activities.find((a) => a.activity === "bar")!, gamble = u.activities.find((a) => a.activity === "gambling")!
    expect(bar.locked).toBe(true)
    expect(gamble.cost).toBe(Math.round(gamble.baseCost * 0.5))
    expect(u.event?.lines).toContain(`${bar.name} is Locked`)
    expect(u.event?.lines.some((l) => l.startsWith(gamble.name) && l.includes("-50%"))).toBe(true)
    const a = await advise(u)
    expect(a.relief.flatMap((r) => r.options.map((o) => o.activity.activity))).not.toContain("bar")
    // an event from another week is not this week's
    week.town_event_result_id = "arena_first"
    expect((await town(save)).event).toBeUndefined()
  })

  test("C21: the fallen are never advised: every hero the campaign log records as died is off the roster and off the board", async () => {
    const dir = copyProfile()
    const save = await readSave(dir)
    const died = new Set<number>()
    const scan = (o: any): void => { if (o && typeof o === "object") { if (o.died === true) died.add(o.guid); Object.values(o).forEach(scan) } }
    scan(save.campaign_log)
    const t = await town(save)
    expect(t.heroes.filter((h) => died.has(h.guid))).toEqual([])
    expect(t.fallen.map((h) => h.guid).sort()).toEqual([...died].filter((g) => (save.roster as any).heroes[g]).sort())
    // the save's own mark agrees: status 3 is exactly the fallen
    const three = Object.entries<any>((save.roster as any).heroes).filter(([, h]) => h.hero_file_data.raw_data["roster.status"] === 3).map(([g]) => Number(g)).sort()
    expect(three).toEqual(t.fallen.map((h) => h.guid).sort())
    const proc = Bun.spawnSync(["bun", "src/cli.ts", "town"], { cwd: root, env: { ...process.env, DD_PROFILE: dir } })
    expect(proc.exitCode).toBe(0)
    const md = await Bun.file(join(townOut, "town.md")).text()
    for (const h of t.fallen) expect(t.heroes.some((x) => x.name === h.name) || !md.includes(h.name)).toBe(true)
  })

  test("C22: the road is priced from the Provisioner's list and paid for first; no lean spends what it needs", async () => {
    const t = await town(await readSave(copyProfile()))
    const a = await advise(t)
    const prices = await supplyPrices()
    expect(prices.get("provision")).toBeGreaterThan(0)
    const items = road(t, a.best, prices)
    const reserve = items.reduce((x, i) => x + i.count * i.price, 0)
    for (const i of items) expect(i.price).toBe(prices.get(i.id)!)
    // what a board leans on, in gold: every lean must fit in what the road leaves
    const spent = (md: string) => {
      let total = 0
      for (const block of md.split(/\n- q: /).slice(1)) {
        const picks = [...block.matchAll(/- pick: (".*")\n\s+effect: (".*")/g)].map((m) => JSON.parse(m[2]!) as string)
        const lean = Number(block.match(/\n\s+lean: (\d+)/)?.[1] ?? -1)
        const fx = picks[lean] ?? ""
        if (/^Which expedition|^Take this party/.test(block)) continue
        const g = fx.match(/^([\d,]+) gold/)
        if (g) total += Number(g[1]!.replace(/,/g, ""))
      }
      return total
    }
    for (const gold of [t.wallet.gold ?? 0, reserve - 1, reserve + 2000, 100_000]) {
      const rich = { ...t, wallet: { ...t.wallet, gold } }
      const md = source(rich, await advise(rich), { foresight: false, answers: {}, prices }).board
      expect(spent(md)).toBeLessThanOrEqual(Math.max(0, gold - reserve))
      expect(md).toContain(gold >= reserve ? "kept for the road" : "cannot pay for the road")
    }
  })

  test("C18: a pick that is not one of its card's options is dropped, its note kept", () => {
    const md = ['- q: "Where do the heirlooms go?"', "  options:", '    - pick: "Save them"', '      effect: "x"', '- q: "Dismiss Cioches?"', "  options:", '    - pick: "Dismiss"', '    - pick: "Keep"'].join("\n")
    const o = boardOptions(md)
    expect(o.get("Dismiss Cioches?")).toEqual(["Dismiss", "Keep"])
    const text = ["- **6. Where do the heirlooms go?** Recruit", "  - Note (refines or overrides the pick): mine", "- **7. Dismiss Cioches?** Recruit", "- **8. Dismiss Cioches?** Keep"].join("\n")
    expect(parseAnswers(text, o)).toEqual({ "Where do the heirlooms go?": { pick: "", note: "mine" }, "Dismiss Cioches?": { pick: "Keep" } })
  })
})
