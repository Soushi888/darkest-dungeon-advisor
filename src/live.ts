// bun run live: one line per event of a live session, for the agent playing alongside Soushi to watch.
//   SEND <time> <n> picks       the board's "Send to the Caretaker" was pressed (.local/town/answers-log.md grew)
//   SAVE <time> town            a Hamlet save changed the rebuilt board (the game saves often; a save that changes nothing is silent)
//   SAVE <time> dungeon         the party left the Hamlet; the board waits (C16). Said once per expedition
//   CHRON <time> #<n> <summary>   a page of the chronicle that changes the story (C39): a battle, a room, an ambush, the light
//                                 past 50 or 25, a break, a virtue, Death's Door, a fall, a hero under 30% health
//   PAGE <time> #<n> <summary>    any other new page (kept, but not worth waking the agent)
//   WARN <time> <n> contradictions: ...   the rebuilt board advises two things that cannot both be done (C38)
// It only reads the profile (ISA A1). See CLAUDE.md, "Live session".
import { existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { outDir } from "./board.ts"
import { decode } from "./dson.ts"
import { profileDir } from "./paths.ts"

const log = join(outDir, "answers-log.md")
const game = join(profileDir(), "persist.game.json")
const mtime = (p: string) => (existsSync(p) ? statSync(p).mtimeMs : 0)
const now = () => new Date().toLocaleTimeString("en-GB", { hour12: false })

const board = join(outDir, "town.md")
const digest = async () => (existsSync(board) ? Bun.hash(await Bun.file(board).text()).toString() : "")
let sent = mtime(log), saved = mtime(game), seen = await digest(), out = false
const chron = join(outDir, "chronicle")
const pages = () => { try { return readdirSync(chron).flatMap((d) => readdirSync(join(chron, d)).filter((f) => /^\d+\.json$/.test(f)).map((f) => join(chron, d, f))) } catch { return [] } }
const told = new Set(pages())
const last = new Map<string, any>()
const clashes = join(outDir, "coherence.json")
let clashSeen = mtime(clashes)
console.log(`LIVE ${now()} watching ${outDir} and ${game}`)
setInterval(async () => {
  for (const f of pages().filter((f) => !told.has(f)).sort()) {
    told.add(f)
    try {
      const p = await Bun.file(f).json(), tl = p.tally ?? {}
      const who = (p.heroes ?? []).map((h: any) => `${h.name} ${Math.round(h.hp)}/${h.maxHp}hp ${h.stress}st${h.affliction ? ` ${h.affliction}` : ""}${h.virtue ? ` ${h.virtue}` : ""}${h.deathsDoor ? " DD" : ""}`).join(", ")
      // only a page that changes the story wakes the agent (Soushi, 2026-10-11: every turn ends in a spoken line); the rest print as PAGE
      const prev = last.get(f.split("/").slice(-2, -1)[0]!), pt = prev?.tally ?? {}
      const crossed = (a: number, b: number) => [50, 25].some((x) => a >= x && b < x)
      const notable = !prev || ["BATTLE_COMPLETED", "ROOM_VISITED", "AMBUSHED"].some((k) => (tl[k] ?? 0) !== (pt[k] ?? 0)) || crossed(prev.torch, p.torch)
        || (p.heroes ?? []).some((h: any) => { const w = prev.heroes?.find((x: any) => x.guid === h.guid); return !w || (h.affliction && !w.affliction) || (h.virtue && !w.virtue) || (h.deathsDoor && !w.deathsDoor) || (h.hp < h.maxHp * 0.3 && w.hp >= w.maxHp * 0.3) })
        || (prev.heroes ?? []).length !== (p.heroes ?? []).length
      last.set(f.split("/").slice(-2, -1)[0]!, p)
      console.log(`${notable ? "CHRON" : "PAGE"} ${now()} #${f.match(/(\d+)\.json$/)![1]} light ${p.torch}, rooms ${tl.ROOM_VISITED ?? 0}, battles ${tl.BATTLE_COMPLETED ?? 0}, food ${p.supplies?.food ?? 0}, torches ${p.supplies?.torch ?? 0} | ${who}`)
    } catch {}
  }
  if (mtime(clashes) !== clashSeen) {
    clashSeen = mtime(clashes)
    try { const c: string[] = (await Bun.file(clashes).json()).contradictions ?? []; if (c.length) console.log(`WARN ${now()} ${c.length} contradictions: ${c.join(" | ")}`) } catch {}
  }
  if (mtime(log) !== sent) {
    sent = mtime(log)
    const picks = (await Bun.file(join(outDir, "answers.md")).text()).split("\n").filter((l) => l.startsWith("- **")).length
    console.log(`SEND ${now()} ${picks} picks`)
    setTimeout(async () => { seen = await digest() }, 6000) // the send rebuilds the board too; that change is not a save
  }
  if (mtime(game) !== saved) {
    saved = mtime(game)
    await Bun.sleep(2000) // the game writes its persist files in a burst
    let raid = false
    try { const d = decode(new Uint8Array(await Bun.file(game).arrayBuffer())) as any; raid = !!(d.base_root ?? d).inraid } catch {}
    if (raid) { if (!out) console.log(`SAVE ${now()} dungeon`); out = true; return }
    out = false
    await Bun.sleep(4000) // the watcher rebuilds 1.5 s after the burst, and the build takes a few seconds
    const d = await digest()
    if (d !== seen) { seen = d; console.log(`SAVE ${now()} town`) }
  }
}, 1000)
