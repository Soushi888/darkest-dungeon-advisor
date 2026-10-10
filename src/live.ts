// bun run live: one line per event of a live session, for the agent playing alongside Soushi to watch.
//   SEND <time> <n> picks       the board's "Send to the Caretaker" was pressed (.local/town/answers-log.md grew)
//   SAVE <time> town|dungeon    the game saved; a town save rebuilds the board, a dungeon save does not (C16)
// It only reads the profile (ISA A1). See CLAUDE.md, "Live session".
import { existsSync, statSync } from "node:fs"
import { join } from "node:path"
import { outDir } from "./board.ts"
import { decode } from "./dson.ts"
import { profileDir } from "./paths.ts"

const log = join(outDir, "answers-log.md")
const game = join(profileDir(), "persist.game.json")
const mtime = (p: string) => (existsSync(p) ? statSync(p).mtimeMs : 0)
const now = () => new Date().toLocaleTimeString("en-GB", { hour12: false })

let sent = mtime(log), saved = mtime(game)
console.log(`LIVE ${now()} watching ${outDir} and ${game}`)
setInterval(async () => {
  if (mtime(log) !== sent) {
    sent = mtime(log)
    const picks = (await Bun.file(join(outDir, "answers.md")).text()).split("\n").filter((l) => l.startsWith("- **")).length
    console.log(`SEND ${now()} ${picks} picks`)
  }
  if (mtime(game) !== saved) {
    saved = mtime(game)
    await Bun.sleep(2000) // the game writes its persist files in a burst
    let where = "town"
    try { const d = decode(new Uint8Array(await Bun.file(game).arrayBuffer())) as any; where = (d.base_root ?? d).inraid ? "dungeon" : "town" } catch {}
    console.log(`SAVE ${now()} ${where}`)
  }
}, 1000)
