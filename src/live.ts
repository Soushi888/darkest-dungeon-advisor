// bun run live: one line per event of a live session, for the agent playing alongside Soushi to watch.
//   SEND <time> <n> picks       the board's "Send to the Caretaker" was pressed (.local/town/answers-log.md grew)
//   SAVE <time> town            a Hamlet save changed the rebuilt board (the game saves often; a save that changes nothing is silent)
//   SAVE <time> dungeon         the party left the Hamlet; the board waits (C16). Said once per expedition
//   CHRON <time> #<n> <summary>   a new page of the expedition's chronicle (C39): light, battles, rooms, each hero's state
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
const clashes = join(outDir, "coherence.json")
let clashSeen = mtime(clashes)
console.log(`LIVE ${now()} watching ${outDir} and ${game}`)
setInterval(async () => {
  for (const f of pages().filter((f) => !told.has(f)).sort()) {
    told.add(f)
    try {
      const p = await Bun.file(f).json(), tl = p.tally ?? {}
      const who = (p.heroes ?? []).map((h: any) => `${h.name} ${Math.round(h.hp)}/${h.maxHp}hp ${h.stress}st${h.affliction ? ` ${h.affliction}` : ""}${h.virtue ? ` ${h.virtue}` : ""}${h.deathsDoor ? " DD" : ""}`).join(", ")
      console.log(`CHRON ${now()} #${f.match(/(\d+)\.json$/)![1]} light ${p.torch}, rooms ${tl.ROOM_VISITED ?? 0}, battles ${tl.BATTLE_COMPLETED ?? 0}, food ${p.supplies?.food ?? 0}, torches ${p.supplies?.torch ?? 0} | ${who}`)
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
