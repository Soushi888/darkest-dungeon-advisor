// Probes for the ISA's claims, run against a copy of the local profile. Skipped when no profile exists,
// because a save is personal and is never committed (ISA A4).
import { describe, expect, test } from "bun:test"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { decode } from "../src/dson.ts"
import { monster, dungeonMonsters, nameOf, heroClass } from "../src/game.ts"
import { names } from "../src/names.ts"
import { readSave } from "../src/read.ts"
import { town } from "../src/town.ts"
import { profileDir, root } from "../src/paths.ts"
import { boardOptions, mergePicks, parseAnswers, reconcile } from "../src/reconcile.ts"
import { contradictions, rawNames } from "../src/coherence.ts"
import { beats, bearing, capture, chronicleDir, debrief, judge, remember, loadLedger, untried, CHRONICLE_RULE, type Snap } from "../src/chronicle.ts"
import { ACTING_ORDER, outDir, road, source, weekSoFar } from "../src/board.ts"
import { supplyPrices } from "../src/game.ts"
import { advise, fills, readiness, seatParty, skillWorth, RULE } from "../src/advise.ts"

let profile = ""
try { profile = profileDir() } catch {}
const has = !!profile && existsSync(profile)
const fake = join(root, ".dd-runtime", "test-profile")
// every board a test builds lands here, never in .local/town where the live board and its picks live
const townOut = join(root, ".dd-runtime", "test-town")
process.env.DD_TOWN_OUT = townOut

/** A copy of the profile as it reads in the Hamlet, whatever Soushi is doing: an expedition under way is taken out of the copy. */
function copyProfile(): string {
  rmSync(fake, { recursive: true, force: true })
  mkdirSync(fake, { recursive: true })
  for (const f of readdirSync(profile)) if (f.startsWith("persist.") && f !== "persist.raid.json") cpSync(join(profile, f), join(fake, f))
  const p = join(fake, "persist.game.json"), buf = readFileSync(p), at = buf.indexOf("inraid\0")
  if (at >= 0 && buf[at + 7]) { buf[at + 7] = 0; writeFileSync(p, buf) }
  return fake
}

/** The copy with every hero rested (stress 0), for a probe that needs a four fit to send whatever the live roster is this week:
 *  on 2026-10-11 the four were out in the Cove and everyone else over the habit's stress, so no road was offered and five
 *  probes failed on the save rather than on the code. Stress is a float after its name, aligned to four bytes, as dson.ts reads it. */
function restedProfile(): string {
  const dir = copyProfile(), p = join(dir, "persist.roster.json"), buf = readFileSync(p), dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const needle = Buffer.from("m_Stress\0")
  for (let i = buf.indexOf(needle); i >= 0; i = buf.indexOf(needle, i + 1)) { const s = i + needle.length; dv.setFloat32(s + ((4 - (s % 4)) % 4), 0, true) }
  writeFileSync(p, buf)
  return dir
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
    // the build reads a copy, so the game saving the real profile mid-test (Soushi playing, 2026-10-11) cannot look like a write
    const dir = copyProfile()
    const before = readdirSync(dir).map((f) => statSync(join(dir, f)).mtimeMs)
    const proc = Bun.spawnSync(["bun", "src/cli.ts", "town"], { cwd: root, env: { ...process.env, DD_PROFILE: dir } })
    expect(proc.exitCode).toBe(0)
    const after = readdirSync(dir).map((f) => statSync(join(dir, f)).mtimeMs)
    expect(after).toEqual(before)
  })

  test("A1: a test build lands in DD_TOWN_OUT, set after the imports, and never under .local/town", async () => {
    const live = join(root, ".local", "town")
    expect(outDir()).toBe(townOut)
    expect(chronicleDir().startsWith(townOut)).toBe(true)
    // a folder that does not exist yet, as in a fresh worktree: the build's portraits land there, and nowhere near the live board
    const fresh = join(root, ".dd-runtime", "test-town-fresh")
    rmSync(fresh, { recursive: true, force: true })
    // what the live board's portrait folder holds, and when each was written, read before and after the build
    const look = () => existsSync(join(live, "img")) ? readdirSync(join(live, "img")).map((f) => `${f}@${statSync(join(live, "img", f)).mtimeMs}`).join() : ""
    const before = look()
    process.env.DD_TOWN_OUT = fresh
    try {
      const t = await town(await readSave(copyProfile()))
      source(t, await advise(t), { foresight: false, answers: {}, prices: await supplyPrices() })
      expect(outDir()).toBe(fresh)
      expect(readdirSync(join(fresh, "img")).length).toBeGreaterThan(0)
      expect(look()).toBe(before)
    } finally {
      process.env.DD_TOWN_OUT = townOut
      rmSync(fresh, { recursive: true, force: true })
    }
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
    const dir = restedProfile()
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

  test("C46: every hero's stress is drawn as a bar on the gauge of 200, in the rest section and beside the four", async () => {
    const proc = Bun.spawnSync(["bun", "src/cli.ts", "town"], { cwd: root, env: { ...process.env, DD_PROFILE: copyProfile() } })
    expect(proc.exitCode).toBe(0)
    const md = await Bun.file(join(townOut, "town.md")).text()
    const from = md.indexOf("## Who rests, who prays"), rest = md.slice(from, md.indexOf("\n## ", from + 5))
    const bars = [...rest.matchAll(/- n: (\d+)\n {2}label: "([^"]+)'s stress[^"]*"\n {2}pct: (\d+)/g)]
    const t = await town(await readSave(fake))
    expect(bars.length).toBe(t.heroes.filter((h) => h.stress > 0).length)
    for (const [, n, , pct] of bars) expect(Number(pct)).toBe(Math.min(100, Math.round((Number(n) / 200) * 100)))
    expect(md).toContain("on the gauge of 200")
  })

  test("C47: the Survivalist section names each of the four's camping skills and leans to keep the gold on a road that does not camp", async () => {
    const proc = Bun.spawnSync(["bun", "src/cli.ts", "town"], { cwd: root, env: { ...process.env, DD_PROFILE: restedProfile() } })
    expect(proc.exitCode).toBe(0)
    const md = await Bun.file(join(townOut, "town.md")).text()
    const from = md.indexOf("## The Survivalist"), sec = md.slice(from, md.indexOf("\n## ", from + 5))
    expect(from).toBeGreaterThan(0)
    const four = [...(md.match(/Front to back: ([^"]+?)\. A /)?.[1] ?? "").matchAll(/\d\. (\S+) \(/g)].map((m) => m[1]!)
    for (const n of four) expect(sec).toContain(`${n}, `)
    expect(sec).toContain("Takes to camp:")
    if (/does not camp/.test(sec)) { const opts = [...sec.matchAll(/^ {4}- pick: /gm)].length; expect(sec).toContain(`lean: ${opts - 1}`) }
  })

  test("C48: the Caretaker's habits are listed one by one with their values, where the old accounts note was", async () => {
    const md = await Bun.file(join(townOut, "town.md")).text()
    const from = md.indexOf("## The Caretaker's habits"), sec = md.slice(from)
    expect(from).toBeGreaterThan(0)
    expect(md).not.toContain("How I keep the accounts")
    for (const v of [RULE.restAbove, RULE.sendBelow, RULE.frontHp, RULE.healerWorth, RULE.campGuard]) expect(sec).toMatch(new RegExp(`\\| [+−]?${String(v).replace(".", "\\.")} \\|`))
  })

  test("C13: the board speaks in the Caretaker's voice: no save, file, field or tool is named on it", async () => {
    const dir = copyProfile()
    const proc = Bun.spawnSync(["bun", "src/cli.ts", "town"], { cwd: root, env: { ...process.env, DD_PROFILE: dir } })
    expect(proc.exitCode).toBe(0)
    // what a reader sees: the board's markdown without its block fences
    const md = (await Bun.file(join(townOut, "town.md")).text()).replace(/^```.*$/gm, "").replace(/^\s*image: .*$/gm, "")
    const meta = [/persist/i, /\.json/, /`/, /\bRULE\b/, /\bfiles?\b/i, /\bsav(e|ed|es)\b(?! them)/i, /\bboard\b/i, /\bgame\b/i, /\bsteam\b/i, /\bcode\b/i, /\b[a-z_]+\.[a-z_]+\b/]
    expect(meta.flatMap((re) => md.match(new RegExp(`.{0,30}${re.source}.{0,10}`, re.flags)) ?? [])).toEqual([])
    // no raw name from the game's files either, such as a road's goal printed as inventory_activate (C55)
    expect(rawNames(await Bun.file(join(townOut, "town.md")).text())).toEqual([])
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
    // the return section mourns who fell on the last road (C37); nothing after it may advise them
    const full = await Bun.file(join(townOut, "town.md")).text(), at = full.indexOf("## The coach is back")
    const md = at < 0 ? full : full.slice(0, at) + full.slice(full.indexOf("\n## ", at + 5))
    for (const h of t.fallen) expect(t.heroes.some((x) => x.name === h.name) || !md.includes(h.name)).toBe(true)
  })

  test("C22: the road is priced from the Provisioner's list and paid for first; no lean spends what it needs", async () => {
    const t = await town(await readSave(restedProfile()))
    const a = await advise(t)
    const prices = await supplyPrices()
    expect(prices.get("provision")).toBeGreaterThan(0)
    const items = road(t, a.best, prices)
    const reserve = items.reduce((x, i) => x + i.count * i.price, 0)
    // the file's price, with this week's event applied when one changes the Provisioner's prices (C20)
    const change = (id: string) => (t.event?.provisions ?? []).filter((v) => v.item === (id === "provision" ? "provision" : "supply")).reduce((x, v) => x + v.cost, 0)
    for (const i of items) expect(i.price).toBe(Math.max(0, Math.round(prices.get(i.id)! * (1 + change(i.id)))))
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
    // the gold in the coffers changes which road is chosen (C27), so each case is held to its own road's reserve
    for (const gold of [t.wallet.gold ?? 0, reserve - 1, reserve + 2000, 100_000]) {
      const rich = { ...t, wallet: { ...t.wallet, gold } }
      const ra = await advise(rich)
      const own = road(rich, ra.best, prices).reduce((x, i) => x + i.count * i.price, 0)
      const md = source(rich, ra, { foresight: false, answers: {}, prices }).board
      expect(spent(md)).toBeLessThanOrEqual(Math.max(0, gold - own))
      expect(md).toContain(gold >= own ? "kept for the road" : "cannot pay for the road")
    }
  })

  test("C18: a pick that is not one of its card's options is dropped, its note kept", () => {
    const md = ['- q: "Where do the heirlooms go?"', "  options:", '    - pick: "Save them"', '      effect: "x"', '- q: "Dismiss Cioches?"', "  options:", '    - pick: "Dismiss"', '    - pick: "Keep"'].join("\n")
    const o = boardOptions(md)
    expect(o.get("Dismiss Cioches?")).toEqual(["Dismiss", "Keep"])
    const text = ["- **6. Where do the heirlooms go?** Recruit", "  - Note (refines or overrides the pick): mine", "- **7. Dismiss Cioches?** Recruit", "- **8. Dismiss Cioches?** Keep"].join("\n")
    expect(parseAnswers(text, o)).toEqual({ "Where do the heirlooms go?": { pick: "", note: "mine" }, "Dismiss Cioches?": { pick: "Keep" } })
  })

  // a dungeon save kept from a real departure (2026-10-10, the Cove); skipped where none was captured
  const raidCopy = join(root, ".dd-runtime", "raid-capture")
  test.skipIf(!existsSync(join(raidCopy, "persist.raid.json")))("C24: the first save on the road turns the board into a farewell, once per expedition, in his voice", async () => {
    const dir = join(root, ".dd-runtime", "test-raid")
    rmSync(dir, { recursive: true, force: true }); cpSync(raidCopy, dir, { recursive: true })
    rmSync(join(townOut, "farewell.key"), { force: true })
    const t = await town(await readSave(dir))
    const run = () => Bun.spawnSync(["bun", "src/cli.ts", "town"], { cwd: root, env: { ...process.env, DD_PROFILE: dir } }).stdout.toString()
    expect(run()).toContain("farewell")
    const md = await Bun.file(join(townOut, "town.md")).text()
    expect(md).toContain(`The coach has left for the *${t.raid!.quest.dungeonName}*`)
    // the party as it stands in the game, rank 4 first on the page and rank 1 last
    const order = t.raid!.party.map((g) => t.heroes.find((h) => h.guid === g)!.name)
    const at = order.map((n) => md.indexOf(`: ${n},`))
    expect(at.every((x) => x > 0)).toBe(true)
    expect(at).toEqual([...at].sort((a, b) => b - a))
    // a second save on the same road leaves the board as it is (C16)
    expect(run()).toContain("You are not back yet")
    // and the voice test holds on the farewell too
    const seen = md.replace(/^```.*$/gm, "")
    expect([/persist/i, /\.json/, /`/, /\bRULE\b/, /\bsav(e|ed|es)\b/i, /\bgame\b/i].filter((re) => re.test(seen)).map(String)).toEqual([])
  })

  test("C25: the Treatment Ward is offered only by my habit, priced by whether the quirk has set in, one card per free seat", async () => {
    const t = await town(await readSave(copyProfile()))
    const a = await advise(t)
    const ward = t.activities.find((x) => x.activity === "treatment")!
    const inParty = new Set(a.best?.seats.map((x) => x.hero.guid))
    for (const tr of a.treat) {
      expect(tr.hero.busy).toBe("")
      expect(tr.quirk.positive || tr.quirk.disease).toBe(false)
      expect(tr.hero.level > 0 || inParty.has(tr.hero.guid)).toBe(true)
      expect(tr.cost).toBe(tr.quirk.locked ? ward.lockedQuirkCost ?? ward.cost : ward.cost)
    }
    const md = source(t, a, { foresight: false, answers: {}, prices: await supplyPrices() }).board
    const cards = a.treat.filter((tr) => md.includes(`Treat ${tr.hero.name}'s ${tr.quirk.name}?`)).length
    expect(cards).toBeLessThanOrEqual(Math.max(0, ward.slots - ward.used))
    if (a.treat.length > cards) expect(md).toContain(`The ${ward.name} is full this week`)
  })

  test("C26: what was done this week comes from the saves, against the Hamlet as the week found it", async () => {
    const t = await town(await readSave(copyProfile()))
    const [first, ...rest] = t.heroes
    const start = { week: t.week, heroes: [...rest.map((h) => ({ guid: h.guid, name: h.name })), { guid: -7, name: "Ghost" }], bought: [...t.bought].filter((b) => b.endsWith(":0")), gold: (t.wallet.gold ?? 0) + 500 }
    const lines = weekSoFar(t, start).join("\n")
    expect(lines).toContain(`Joined the roster: ${first!.name}`)
    expect(lines).toContain("Gone from the roster: Ghost")
    expect(lines).toContain("500 gold spent")
    expect(lines).not.toMatch(/:0\b|\b0 step/)
    // another week's baseline says nothing but who is in the buildings
    expect(weekSoFar(t, { ...start, week: t.week - 1 }).every((l) => l.startsWith("In the buildings"))).toBe(true)
  })

  test("C27: the road is chosen with the gold it leaves and the party's experience in mind", async () => {
    const t = await town(await readSave(restedProfile()))
    const a = await advise(t)
    for (const p of a.parties) expect(p.left).toBeDefined()
    // a green party never gets a longer road where a short one scores within the habit's penalty
    const best = a.best!
    if (best.green) expect(best.quest.length).toBe(Math.min(...a.parties.filter((p) => p.green).map((p) => p.quest.length)))
    // a road the coffers cannot provision is never first while one they can is on offer
    if (a.parties.some((p) => p.left! >= 0)) expect(best.left!).toBeGreaterThanOrEqual(0)
    const broke = { ...t, wallet: { ...t.wallet, gold: 0 } }
    const b = await advise(broke)
    expect(b.parties.every((p) => p.left! < 0)).toBe(true)
  })

  test("C28: readiness counts my conditions from the save, and falls when one of them fails", async () => {
    const t = await town(await readSave(restedProfile()))
    const a = await advise(t)
    const p = a.best!
    const reserve = road(t, p, await supplyPrices()).reduce((x, i) => x + i.count * i.price, 0)
    const r = readiness(t, p, reserve)
    expect(r.met).toBe(r.checks.filter((c) => c.met).length)
    expect(r.pct).toBe(Math.round((r.met / r.of) * 100))
    // no gold: the road is not paid for, and readiness drops by exactly that condition
    const poor = readiness({ ...t, wallet: { ...t.wallet, gold: 0 } }, p, reserve)
    expect(poor.checks.find((c) => c.label === "The road is paid for")!.met).toBe(reserve <= 0)
    if (reserve > 0) expect(poor.met).toBe(r.met - (r.checks[0]!.met ? 1 : 0))
    // a worn-out party is not rested
    const worn = { ...p, seats: p.seats.map((s) => ({ ...s, hero: { ...s.hero, stress: 99 } })) }
    expect(readiness(t, worn, reserve).checks.find((c) => c.label === "Rested")!.met).toBe(false)
  })

  test("C29: recruits share the roster's places; a full roster leans Pass unless a clear swap is worth it", async () => {
    const t = await town(await readSave(copyProfile()))
    const a = await advise(t)
    const prices = await supplyPrices()
    const leans = (md: string) => [...md.matchAll(/- q: "(Recruit|Dismiss) ([^,?]+)[^"]*"[\s\S]*?\n\s+lean: (\d)/g)].map((m) => ({ kind: m[1]!, name: m[2]!, lean: Number(m[3]) }))
    // as many recruits taken as there are places, counting the dismissals the board leans on
    const check = (tt: typeof t) => {
      const md = source(tt, a, { foresight: false, answers: {}, prices }).board
      const l = leans(md)
      const takes = l.filter((x) => x.kind === "Recruit" && x.lean === 0).length
      const lets = l.filter((x) => x.kind === "Dismiss" && x.lean === 0).length
      expect(takes).toBeLessThanOrEqual(Math.max(0, tt.rosterCap - tt.rosterSize) + lets)
    }
    check(t)
    check({ ...t, rosterCap: t.rosterSize })
    check({ ...t, rosterCap: t.rosterSize + 1 })
  })

  test("C43: a recruit who brings the true healer the four lack leans Recruit, and frees a place when the roster is full", async () => {
    const card = (md: string, q: string) => md.match(new RegExp(`- q: "${q}"[\\s\\S]*?\\n  lean: (\\d+)\\n  lean_why: "(.*)"`))
    const build = async (holdHealers: boolean, cap: (t: Awaited<ReturnType<typeof town>>) => number, tendSpare = false) => {
      const t = await town(await readSave(copyProfile()))
      // nobody fit to go carries a true heal: every hero who has learned one is held in town
      if (holdHealers) for (const h of t.heroes) { const sk = (await heroClass(h.cls)).skills; if ((h.learned ?? h.skills).some((s) => sk.get(s.id)?.targetsAllies && sk.get(s.id)!.healAvg >= RULE.realHeal)) h.busy = "the Abbey" }
      const base = t.recruits[0] ?? t.heroes[0]!
      const ids = ["judgement", "dazzling_light", "divine_grace", "divine_comfort"]
      const vestal = { ...base, guid: 990001, name: "Aldith", cls: "vestal", clsName: "Vestal", level: 0, quirks: [], from: undefined, learned: undefined, skills: await Promise.all(ids.map(async (id) => ({ id, name: await nameOf("skill", id, "vestal"), level: 0 }))) }
      // the Vestal is the only one at the coach, so the week's own recruits never take the place she is tested for (week 17's
      // coach brought nine, and Godefroy took the one free place: the test was about the save, not the code)
      t.recruits = [vestal]
      t.rosterCap = cap(t)
      const a = await advise(t)
      // a level 0 hero outside the four, with nothing to recommend them, for a full roster to let go: joined after the advice, so it
      // does not seat them, with the cap raised alongside so the places free stay as built
      const spare = { ...t.heroes[0]!, guid: 990002, name: "Osric", level: 0, quirks: [] as typeof t.heroes[0]["quirks"], busy: "" }
      t.heroes.push(spare); t.rosterSize++; t.rosterCap++
      // the same spare, made the worst on the roster and sent to the Sanitarium this week, so the swap has to look past them
      const bad = t.heroes.flatMap((h) => h.quirks).find((q) => !q.positive && !q.disease)
      if (tendSpare && bad) { spare.quirks = [bad, bad, bad, bad, bad]; a.disease.push(spare) }
      return { t, a, md: source(t, a, { foresight: false, answers: {}, prices: await supplyPrices() }).board, spare }
    }
    // a place free: the Vestal leans Recruit, and the reason names the missing healer and her heal
    const open = await build(true, (t) => t.rosterSize + 1)
    if (!open.a.best) return
    expect(open.a.best.healer).toBe(false)
    const c = card(open.md, "Recruit Aldith, Vestal\\?")!
    expect(c[1]).toBe("0")
    expect(c[2]).toMatch(/no true healer, and Aldith carries Divine Grace, about [\d.]+ hit points a cast/)
    expect(contradictions(open.md)).toEqual([])
    // the roster full: the place is freed by letting go of a level 0 hero outside the four, and the board still agrees with itself
    const full = await build(true, (t) => t.rosterSize)
    // the one let go is the weakest level 0 hero outside the four, whoever that is on this save; never one the board tends this week
    const freed = (md: string) => [...md.matchAll(/- q: "Dismiss (.+?)\?"\n[\s\S]*?context: "[^"]*Aldith at the coach brings the true healer the four lack/g)].map((m) => m[1])
    expect(card(full.md, "Recruit Aldith, Vestal\\?")![1]).toBe("0")
    expect(freed(full.md)).toHaveLength(1)
    expect(contradictions(full.md)).toEqual([])
    const tended = await build(true, (t) => t.rosterSize, true)
    expect(freed(tended.md)).not.toContain("Osric")
    // the stun the same way: a recruit who carries one is named for a four without one, and one gap goes to one recruit only
    const r = (guid: number, own: boolean) => ({ hero: { guid, name: `R${guid}` }, why: "", stun: { skill: "Stunning Blow", own } }) as any
    const f = fills({ healer: true, stunner: false } as any, [r(1, false), r(2, true)])
    expect([...f.keys()]).toEqual([2])
    expect(f.get(2)!.text).toBe("the four have no stun, and R2 carries Stunning Blow")
    // the falsifier: with a true healer in the four, the same Vestal is weighed by her quirks alone
    const healed = await build(false, (t) => t.rosterSize + 1)
    if (healed.a.best?.healer) expect(card(healed.md, "Recruit Aldith, Vestal\\?")![2]).not.toMatch(/healer/)
  })

  test("C18: a stored pick follows its question when cards come or go between builds", async () => {
    const dir = copyProfile()
    const port = 4393
    const w = Bun.spawn(["bun", "src/cli.ts", "watch", `--port=${port}`], { cwd: root, env: { ...process.env, DD_PROFILE: dir }, stdout: "pipe" })
    try {
      let html = ""
      for (let i = 0; i < 40; i++) { try { html = await (await fetch(`http://127.0.0.1:${port}/`)).text(); if (html.includes("ddCards")) break } catch {} await Bun.sleep(250) }
      const script = html.match(/<head><script>([\s\S]*?)<\/script>/)![1]!
      const cards = JSON.parse(script.match(/C=(\[[\s\S]*?\]),st=/)![1]!) as { q: string; o: string[] }[]
      expect(cards.length).toBeGreaterThan(2)
      // the last build had one more card at the front: every stored number is one too high for this build
      const store = new Map<string, string>()
      const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
      const key = "brainstorm:town.html:v1"
      store.set("ddCards", JSON.stringify(["A card that is gone", ...cards.map((c) => c.q)]))
      store.set(key, JSON.stringify({ dec: { "3": { pick: cards[1]!.o[0] }, "4": { pick: "not an option here", note: "kept" } } }))
      new Function("localStorage", script)(ls)
      const dec = JSON.parse(store.get(key)!).dec
      expect(dec["2"]).toEqual({ pick: cards[1]!.o[0] }) // followed its question from card 3 to card 2
      expect(dec["3"]).toEqual({ note: "kept" }) // a pick that is not an option is dropped, its note kept
      expect(JSON.parse(store.get("ddCards")!)).toEqual(cards.map((c) => c.q))
    } finally { w.kill() }
  }, 30_000)

  test("C86: a four leaves without a true healer only when none of the ready heroes is one", async () => {
    const t = await town(await readSave(copyProfile()))
    const a = await advise(t)
    const ready = t.heroes.filter((h) => !h.busy && !h.affliction && h.stress < RULE.sendBelow && !h.quirks.some((q) => q.disease))
    const healers: string[] = []
    for (const h of ready) {
      const sk = (await heroClass(h.cls)).skills
      if ((h.learned ?? h.skills).some((s) => sk.get(s.id)?.heal && sk.get(s.id)!.targetsAllies && sk.get(s.id)!.healAvg >= RULE.realHeal)) healers.push(h.name)
    }
    expect(a.parties.length).toBeGreaterThan(0)
    // relief and the Medical Ward reach a true healer before anyone else
    const relief = a.relief.map((r) => a.trueHealer.has(r.hero.guid))
    expect(relief).toEqual([...relief].sort((x, y) => Number(y) - Number(x)))
    if (healers.length) for (const p of a.parties) expect({ quest: `${p.quest.dungeonName} ${p.quest.length}`, healer: p.healer }).toEqual({ quest: `${p.quest.dungeonName} ${p.quest.length}`, healer: true })
  })

  test("C30: a healer is judged by how much the heal restores, cast from where they stand", async () => {
    const t = await town(await readSave(copyProfile()))
    // the class files: a Vestal's Divine Grace makes a healer, a Crusader's Battle Heal does not
    expect((await heroClass("vestal")).skills.get("divine_grace")!.healAvg).toBeGreaterThanOrEqual(RULE.realHeal)
    expect((await heroClass("crusader")).skills.get("battle_heal")!.healAvg).toBeLessThan(RULE.realHeal)
    const a = await advise(t)
    for (const p of a.parties) {
      expect(p.healer).toBe(!!p.heal && p.heal.avg >= RULE.realHeal)
      if (p.heal) { const seat = p.seats.find((s) => s.hero.name === p.heal!.by)!; expect(seat.skills).toContain(p.heal.skill) }
    }
    // the four that left for the Weald on 2026-10-10 had only Battle Heal, and now read so
    const crusader = t.heroes.find((h) => h.cls === "crusader" && h.skills.some((s) => s.id === "battle_heal"))
    if (crusader && a.parties[0]) {
      const p = await seatParty([crusader, ...t.heroes.filter((h) => !["vestal", "occultist", "crusader"].includes(h.cls)).slice(0, 3)], a.parties[0].quest)
      if (p.heal?.skill === "Battle Heal") {
        expect(p.healer).toBe(false)
        expect(readiness(t, p, 0).checks.find((c) => c.label === "A healer goes with them")!.met).toBe(false)
      }
    }
  })

  test("C31: the board reads in the order the week is played", async () => {
    const t = await town(await readSave(copyProfile()))
    const md = source(t, await advise(t), { foresight: false, answers: {}, prices: await supplyPrices() }).board
    const heads = [...md.matchAll(/^## (.+?)(?: \{wide\})?$/gm)].map((m) => m[1]!)
    const ranks = heads.map((h) => ACTING_ORDER.findIndex((o) => h.startsWith(o)))
    expect(ranks.every((r) => r >= 0)).toBe(true)
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    // what changes the pool comes before the party; what is spent on the party comes after it
    const at = (h: string) => heads.findIndex((x) => x.startsWith(h))
    expect(at("Who stays, who goes")).toBeLessThan(at("The next expedition"))
    expect(at("Who rests, who prays")).toBeLessThan(at("The next expedition"))
    if (at("Provisions for the") >= 0) expect(at("Provisions for the")).toBeGreaterThan(at("The next expedition"))
  })

  // the best party's score for one road, with the habits as they stand or with one of them set to nothing
  async function scoreWith(key: keyof typeof RULE, value?: number) {
    const t = await town(await readSave(copyProfile()))
    const keep = RULE[key]
    if (value !== undefined) (RULE as any)[key] = value
    try { const a = await advise(t); return a.parties.find((p) => !p.quest.plot && p.quest.length === 1) } finally { (RULE as any)[key] = keep }
  }

  test("C32: the party is judged by whom it can reach, and the card says so", async () => {
    const with_ = await scoreWith("reachPerRank"), without = await scoreWith("reachPerRank", 0)
    if (!with_ || !without) return
    expect(with_.reach!.length).toBeGreaterThan(0)
    expect(with_.score).toBeGreaterThan(without.score)
    const t = await town(await readSave(copyProfile()))
    const md = source(t, await advise(t), { foresight: false, answers: {}, prices: await supplyPrices() }).board
    expect(md).toMatch(/From these seats they can strike (every rank of the enemy line|enemy ranks? [1-4])/)
  })

  test("C33: a seat that survives a shuffle is worth more", async () => {
    const with_ = await scoreWith("shufflePerSide"), without = await scoreWith("shufflePerSide", 0)
    if (!with_ || !without) return
    expect(with_.score).toBeGreaterThan(without.score)
    // the game's own move: Duelist's Advance moves its user forward one rank
    expect((await heroClass("highwayman")).skills.get("duelist_advance")!.move).toEqual([0, 1])
  })

  test("C34: each seat carries the four learned skills that serve it, and the swaps are named", async () => {
    const t = await town(await readSave(copyProfile()))
    for (const h of t.heroes) for (const s of h.skills) expect(h.learned!.map((l) => l.id)).toContain(s.id)
    // a hero carrying a skill useless from the back, with a better one learned, is told to swap it
    const hw = t.heroes.find((h) => h.cls === "highwayman")
    if (!hw) return
    const cls = await heroClass("highwayman"), name = async (id: string) => nameOf("skill", id, "highwayman")
    hw.skills = await Promise.all(["point_blank_shot", "pistol_shot", "grape_shot_blast", "take_aim"].map(async (id) => ({ id, name: await name(id), level: 0 })))
    hw.learned = [...hw.skills, { id: "duelist_advance", name: await name("duelist_advance") }]
    Object.assign(hw, { stress: 0, affliction: "", busy: "", quirks: hw.quirks.filter((q) => !q.disease), level: 5 })
    expect(cls.skills.get("point_blank_shot")!.launch).toEqual([1])
    for (const h of t.heroes) if (h.guid !== hw.guid && h.cls === "highwayman") h.busy = "elsewhere"
    // a sound Crusader holds the front, so the live roster (whoever is tired or away this week) never pushes the Highwayman there
    const front = t.heroes.find((h) => h.cls === "crusader")
    if (front) Object.assign(front, { stress: 0, affliction: "", busy: "", quirks: front.quirks.filter((q) => !q.disease), level: 5 })
    const a = await advise(t)
    const seat = a.parties.flatMap((p) => p.seats).find((s) => s.hero.guid === hw.guid && s.rank > 1)
    expect(seat).toBeDefined()
    // the learned skill goes in, in place of one that cannot be used from the seat
    const swap = seat!.swaps!.find((w) => w.equip === "Duelist's Advance")
    expect(swap).toBeDefined()
    const out = hw.skills.find((x) => x.name === swap!.for)!
    expect(cls.skills.get(out.id)!.launch).not.toContain(seat!.rank)
  })

  test("C50: the Abomination is seated as a man, and every seat strikes a foe", async () => {
    // the beast's own skills launch from nowhere a seat can count on; the man's keep their ranks
    const ab = await heroClass("abomination")
    for (const id of ["rake", "rage", "slam"]) expect(ab.skills.get(id)!.launch).toEqual([])
    expect(ab.skills.get("manacles")!.launch).toEqual([3, 2])
    expect(ab.skills.get("transform")!.launch.length).toBeGreaterThan(0)
    const a = await advise(await town(await readSave(copyProfile())))
    for (const s of a.parties.flatMap((p) => p.seats)) {
      // Transform and Absolution alone reach rank 1 and 4, and neither strikes: Wissant was "really not good at rank 1"
      if (s.hero.cls === "abomination") expect([2, 3]).toContain(s.rank)
      // the Grave Robber's Lunge launches from 4 and 3, her daggers and darts from 4 to 2 (Soushi, 2026-10-11)
      if (s.hero.cls === "grave_robber") expect([3, 4]).toContain(s.rank)
    }
  })

  test("C35: a mark and a hand that strikes the marked count together", async () => {
    expect((await heroClass("bounty_hunter")).skills.get("target_tag")!.marks).toBe(true)
    expect((await heroClass("highwayman")).skills.get("pistol_shot")!.onMarked).toBe(true)
    const with_ = await scoreWith("markPair"), without = await scoreWith("markPair", 0)
    if (!with_?.pair || !without) return
    expect(with_.score).toBeGreaterThan(without.score)
  })

  test("C36: bleed and blight are weighed against what the known foes resist", async () => {
    const vein = (await heroClass("highwayman")).skills.get("opened_vein")!, plain = (await heroClass("highwayman")).skills.get("wicked_slice")!
    expect(vein.bleed).toBe(true)
    const road = (bleed: number, foes: number) => ({ foeResist: { bleed, blight: 0, foes } }) as any
    expect(skillWorth(vein, 1, road(0.2, 5))).toBeGreaterThan(skillWorth(vein, 1, road(0.6, 5)))
    // a road whose foes you have never met says nothing of their resistances
    expect(skillWorth(vein, 1, road(0, 0))).toBe(skillWorth({ ...vein, bleed: false }, 1, road(0, 0)))
    // the resistances come only from foes met on that road
    const t = await town(await readSave(copyProfile()))
    for (const q of t.quests) if (!q.known.length) expect(q.foeResist!.foes).toBe(0)
    expect(plain.bleed).toBe(false)
  })

  test("C37: when the coach is back, the board opens on what the road did and bridges to the week ahead", async () => {
    const t = await town(await readSave(copyProfile()))
    if (!t.back) return
    const md = source(t, await advise(t), { foresight: false, answers: {}, prices: await supplyPrices() }).board
    const heads = [...md.matchAll(/^## (.+?)(?: \{wide\})?$/gm)].map((m) => m[1]!)
    expect(heads[0]).toBe("The coach is back")
    const zone = md.slice(md.indexOf("## The coach is back"), md.indexOf("\n## ", md.indexOf("## The coach is back") + 5))
    for (const h of t.back.heroes) expect(zone).toContain(h.died ? `${h.name} fell in the` : t.heroes.some((x) => x.guid === h.guid) ? `${h.name} is home` : `${h.name} is no longer on the roster`)
    expect(zone).toContain(t.back.success ? "with the work done" : "without the work done")
    expect(zone).toMatch(/So this week (I would send|nobody is fit)/)
  })

  test("C38: the board never contradicts itself, and the check catches a board that does", async () => {
    const t = await town(await readSave(copyProfile()))
    const md = source(t, await advise(t), { foresight: false, answers: {}, prices: await supplyPrices() }).board
    expect(contradictions(md)).toEqual([])
    // the falsifier: one of the four also leaned into a building, and a trinket for someone left home
    const four = [...(md.match(/Front to back: ([^"]+)/)?.[1] ?? "").matchAll(/\d\. ([^(;]+?) \(/g)].map((m) => m[1]!.trim())
    if (!four.length) return
    // a week where nobody needs relief has no "Where does ... go?" card to turn (week 18, every hero rested), so the falsifier
    // plants its own: one of the four leaned into the Abbey
    const relief = /- q: "Where does (.+?) go\?"/.test(md) ? md.replace(/- q: "Where does (.+?) go\?"([\s\S]*?)\n  lean: \d+/, `- q: "Where does ${four[0]} go?"$2\n  lean: 0`)
      : `${md}\n\n\`\`\`board-decisions\n- q: "Where does ${four[0]} go?"\n  context: "planted"\n  options:\n    - pick: "The Abbey"\n      effect: "planted"\n    - pick: "Leave them be"\n      effect: "planted"\n  lean: 0\n  lean_why: "planted"\n\`\`\`\n`
    const bad = relief + `\n\n\`\`\`board-stickies\n- title: "Bleed Stone to Nobody"\n  kind: idea\n\`\`\`\n`
    const found = contradictions(bad)
    expect(found.some((f) => f.includes(`${four[0]} is in the four`))).toBe(true)
    expect(found.some((f) => f.includes("Nobody, who is not in the four"))).toBe(true)
  })

  test.skipIf(!existsSync(join(raidCopy, "persist.raid.json")))("C39: a dungeon save is chronicled once per change, never in the save folder", async () => {
    rmSync(chronicleDir(), { recursive: true, force: true })
    const save = await readSave(raidCopy)
    const first = await capture(save)
    expect(first).toBeDefined()
    expect(first!.startsWith(townOut)).toBe(true)
    expect(await capture(save)).toBeUndefined() // nothing changed, nothing kept
    expect(existsSync(join(profile, "chronicle"))).toBe(false)
    const snap = (await Bun.file(first!).json()) as Snap
    expect(snap.heroes.length).toBeGreaterThan(0)
    expect(snap.torch).toBeGreaterThan(0)
  })

  // a trip that began well and broke in the dark: three saves, as the chronicle would keep them
  const hero = (name: string, o: Partial<Snap["heroes"][number]> = {}) => ({ guid: name.length, name, cls: "vestal", hp: 20, maxHp: 24, stress: 10, affliction: "", virtue: "", deathsDoor: false, lastBlow: "", ...o })
  const snap = (torch: number, battles: number, heroes: Snap["heroes"]): Snap => ({ at: "", dungeon: "cove", difficulty: 1, length: 1, quest: "cleanse", key: "k", torch, inBattle: false, supplies: { food: 4 }, tally: { BATTLE_COMPLETED: battles }, heroes })
  const trip = [
    snap(100, 0, [hero("Ana"), hero("Bo"), hero("Cy")]),
    snap(80, 2, [hero("Ana"), hero("Bo"), hero("Cy")]),
    snap(30, 3, [hero("Ana", { affliction: "Masochistic", stress: 100 }), hero("Bo", { affliction: "Abusive", stress: 100 }), hero("Cy", { deathsDoor: true, lastBlow: "Drowned Thrall" })]),
    snap(20, 3, [hero("Ana", { affliction: "Masochistic", stress: 100 }), hero("Bo", { affliction: "Abusive", stress: 100 })]),
  ]

  test("C40: the survivors' tale tells the trip in order, with its turning point and the foe that struck", () => {
    const bs = beats(trip, ["Cy"])
    expect(bs[0]!.kind).toBe("battle")
    const turn = bs.findIndex((b) => b.bad && b.kind !== "ambush" && b.kind !== "spike")
    expect(turn).toBeGreaterThan(0)
    expect(bs.map((b) => b.text).join(" ")).toContain("Drowned Thrall")
    expect(bs.some((b) => b.kind === "fell" && b.who === "Cy")).toBe(true)
  })

  test("C41: what went well and wrong is tied to the light, the healing and the retreat", () => {
    const j = judge(trip, beats(trip, ["Cy"]), { dungeon: "cove", dungeonName: "Cove", difficulty: 1, length: 1, week: 13, success: false, healer: false })
    expect(j.well.join(" ")).toMatch(/went their way/)
    expect(j.wrong.join(" ")).toMatch(/dark/)
    expect(j.wrong.join(" ")).toMatch(/Two had broken/)
    expect(j.lessons.map((l) => l.kind).sort()).toEqual(["healing", "light", "retreat"])
  })

  test("C44: the tale tells a shuffle once per battle, naming who moved to which rank", () => {
    const at = (s: Snap, inBattle: boolean, order: string[], battles = 0) => ({ ...s, inBattle, tally: { BATTLE_COMPLETED: battles }, heroes: order.map((n) => s.heroes.find((h) => h.name === n) ?? hero(n)) })
    const s0 = snap(100, 0, [hero("Al"), hero("Bea"), hero("Cato")])
    // heroes of distinct name lengths, since the helper keys guids on it. A battle: Al is knocked back two ranks, then Bea steps back once; out of it, Cato and Al trade places by hand
    const shuffled = [at(s0, false, ["Al", "Bea", "Cato"]), at(s0, true, ["Al", "Bea", "Cato"]), at(s0, true, ["Bea", "Cato", "Al"]), at(s0, true, ["Bea", "Cato", "Al"]), at(s0, true, ["Bea", "Al", "Cato"]), at(s0, false, ["Bea", "Al", "Cato"], 1), at(s0, false, ["Bea", "Cato", "Al"], 1)]
    const sh = beats(shuffled).filter((b) => b.kind === "shuffle")
    expect(sh.map((b) => b.text)).toEqual(["Bea took rank 1 and Al rank 2", "Cato took rank 2 and Al rank 3"])
    // a shuffle undone within the battle is not told; a hero who fell leaves a gap, not a shuffle
    expect(beats([at(s0, true, ["Al", "Bea", "Cato"]), at(s0, true, ["Bea", "Al", "Cato"]), at(s0, true, ["Al", "Bea", "Cato"])]).some((b) => b.kind === "shuffle")).toBe(false)
    expect(beats([at(s0, true, ["Al", "Bea", "Cato"]), at(s0, true, ["Bea", "Cato"])], ["Al"]).some((b) => b.kind === "shuffle")).toBe(false)
    // and when a fall and a swap come on the same page, only the swap is told, its ranks counted among those still standing
    expect(beats([at(s0, true, ["Al", "Bea", "Cato", "Edwin"]), at(s0, true, ["Cato", "Bea", "Edwin"])], ["Al"]).filter((b) => b.kind === "shuffle").map((b) => b.text)).toEqual(["Cato took rank 1 and Bea rank 2"])
    // the trip of C40 never changes order, so its tale gains nothing
    expect(beats(trip, ["Cy"]).some((b) => b.kind === "shuffle")).toBe(false)
  })

  test("C42: lessons are kept once, bear only on their dungeon at their level or worse, and change the board with their trip named", async () => {
    rmSync(join(townOut, "lessons.json"), { force: true })
    const j = judge(trip, beats(trip, ["Cy"]), { dungeon: "cove", dungeonName: "Cove", difficulty: 1, length: 1, week: 13, success: false, healer: false })
    await remember(j.lessons); await remember(j.lessons)
    const all = await loadLedger()
    expect(all.length).toBe(j.lessons.length)
    expect(bearing(all, { dungeon: "cove", difficulty: 1 }).length).toBe(all.length)
    expect(bearing(all, { dungeon: "cove", difficulty: 3 }).length).toBe(all.length)
    expect(bearing(all, { dungeon: "weald", difficulty: 1 })).toEqual([])
    expect(bearing([{ ...all[0]!, difficulty: 3 }], { dungeon: "cove", difficulty: 1 })).toEqual([])
    expect(untried(all, { difficulty: 3 }, [{ difficulty: 1 }])).toBe(true)
    expect(untried(all, { difficulty: 1 }, [{ difficulty: 1 }])).toBe(false)
    // the torches on a Cove road rise by the habit, and say which trip taught it
    const t = await town(await readSave(copyProfile()))
    t.ledger = all
    const a = await advise(t), cove = a.parties.find((p) => p.quest.dungeon === "cove")
    if (!cove) return
    const torch = road(t, cove, await supplyPrices()).find((i) => i.id === "torch")!
    t.ledger = []
    const plain = road(t, cove, await supplyPrices()).find((i) => i.id === "torch")!
    expect(torch.count - plain.count).toBe(CHRONICLE_RULE.lessonTorches)
    expect(torch.why).toContain("Cove, week 13")
    rmSync(join(townOut, "lessons.json"), { force: true })
  })
})

// C45 and C46 need no save: the debrief reads pages, and the gauge is a fixed rule
describe("the road's debrief", () => {
  const hero = (o: Partial<Snap["heroes"][number]>): Snap["heroes"][number] => ({ guid: 1, name: "Burci", cls: "bounty_hunter", hp: 20, maxHp: 25, stress: 10, affliction: "", virtue: "", deathsDoor: false, lastBlow: "", ...o })
  const page = (o: Partial<Snap>): Snap => ({ at: "", dungeon: "weald", difficulty: 1, length: 1, quest: "cleanse", key: "debrief-test", torch: 80, inBattle: false, supplies: {}, tally: {}, heroes: [hero({})], ...o })

  test("C45: blight ticking is laid at the foe that cast it, a loss outside a fight is no foe's blow, and the narrator's trap and critical are told", async () => {
    const tick = await debrief([
      page({ inBattle: true, heroes: [hero({ hp: 10, effects: ["blight 2 (3) from fungal_artillery_A"] })] }),
      page({ inBattle: true, heroes: [hero({ hp: 8, lastBlow: "Fungal Artillery", blowCls: "fungal_artillery_A", effects: ["blight 2 (2) from fungal_artillery_A"] })] }),
    ])
    expect(tick.foes[0]).toMatchObject({ name: "Fungal Artillery", blight: 2, blows: 0 })

    const outside = await debrief([page({ heroes: [hero({ hp: 20, lastBlow: "Maggot" })] }), page({ heroes: [hero({ hp: 15, lastBlow: "Maggot", blowCls: "maggot_A" })] })])
    expect(outside.foes).toEqual([])

    const trap = await debrief([page({ narrated: [] }), page({ narrated: ["trap"], heroes: [hero({ stress: 29 })] })])
    expect(trap.beats.find((b) => b.kind === "trap")?.text).toContain("Burci")

    const crit = await debrief([
      page({ inBattle: true, narrated: [], known: ["groping_swipe"], heroes: [hero({ hp: 13 })], battle: { round: 1, foes: [{ name: "Fungal Scratcher", hp: 19, hitBy: "" }] } }),
      page({ inBattle: true, narrated: ["crit_hero"], known: ["groping_swipe"], heroes: [hero({ hp: 5, lastBlow: "Fungal Scratcher", blowCls: "fungal_bloat_A" })], battle: { round: 1, foes: [{ name: "Fungal Scratcher", hp: 19, hitBy: "" }] } }),
    ])
    expect(crit.beats.find((b) => b.kind === "crit")?.text).toContain("critical blow on Burci for 8")
    expect(crit.foes[0]).toMatchObject({ name: "Fungal Scratcher", crits: 1 })
    // only a witnessed attack is named (C5): Rend the Marked was never suffered here
    expect(Object.keys(crit.foes[0]!.attacks).join()).toContain("Groping Swipe")
    expect(Object.keys(crit.foes[0]!.attacks).join()).not.toContain("Rend")
  })
})

describe("the road page", () => {
  test("C49: a line from the road and the Caretaker's answer share one thread, beside the party's latest page", async () => {
    const { ask, feed, say } = await import("../src/road.ts")
    rmSync(join(townOut, "road"), { recursive: true, force: true })
    const trip = join(townOut, "chronicle", "zz_road_test")
    rmSync(trip, { recursive: true, force: true })
    mkdirSync(trip, { recursive: true })
    writeFileSync(join(trip, "0007.json"), JSON.stringify({ dungeon: "cove", torch: 80, supplies: { food: 4, torch: 6 }, tally: { ROOM_VISITED: 2 }, heroes: [{ name: "Emory", cls: "grave_robber", hp: 12, maxHp: 20, stress: 130 }] }))
    ask("Retreat or push on?")
    await Bun.sleep(5)
    say("Push on: the light is high.")
    const f = await feed()
    expect(f.trip).toBe("zz_road_test")
    expect(f.lines.map((l) => [l.from, l.text, l.page])).toEqual([["soushi", "Retreat or push on?", "0007"], ["caretaker", "Push on: the light is high.", "0007"]])
    expect(f.state.heroes[0]).toMatchObject({ name: "Emory", hp: 12, stress: 130 })
    // in a fight, each foe carries its full health from its own monster file (Soushi's pins: foes' life in battle, the good total)
    writeFileSync(join(trip, "0008.json"), JSON.stringify({ dungeon: "cove", torch: 80, heroes: [], battle: { round: 2, foes: [{ name: "Brigand Cutthroat", cls: "brigand_cutthroat_A", hp: 8, guid: 7, stunned: true }] } }))
    // C71 adds whether each foe has acted and its effects in words
    expect((await feed()).state.foes).toEqual([{ name: "Brigand Cutthroat", hp: 8, maxHp: (await monster("brigand_cutthroat_A"))!.hp, stunned: true, dots: [], dead: false, acted: false, effects: [] }])
    expect((await monster("brigand_cutthroat_A"))!.hp).toBeGreaterThan(8)
    // a corpse is marked dead, so a killed foe never reads as one still fighting (Soushi's pin)
    writeFileSync(join(trip, "0009.json"), JSON.stringify({ dungeon: "cove", torch: 80, heroes: [], battle: { round: 3, foes: [{ name: "Corpse", cls: "corpse_A", hp: 6, guid: 9 }] } }))
    expect((await feed()).state.foes[0]).toMatchObject({ name: "Corpse", dead: true })
    // the live board's own folder is never written by a test
    expect(join(townOut, "road")).not.toContain(join(".local", "town"))
    rmSync(trip, { recursive: true, force: true })
  })
})
