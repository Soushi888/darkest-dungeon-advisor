// bun run town     build the town board once from the newest save
// bun run watch    keep it live: every save made in the Hamlet rebuilds it; during an expedition it waits (C16)
// flags: --foresight (experimental, C7), --port=<n> for watch (default 4317)
import { watch as fsWatch } from "node:fs"
import { join } from "node:path"
import { buildBoard, buildFarewell, outDir } from "./board.ts"
import { profileDir } from "./paths.ts"
import { readSave } from "./read.ts"
import { town, type Town } from "./town.ts"
import { boardOptions, loadPicks, mergePicks, picksFile } from "./reconcile.ts"

const args = process.argv.slice(2)
const cmd = args[0] ?? "town"
const foresight = args.includes("--foresight")
const port = Number(args.find((a) => a.startsWith("--port="))?.split("=")[1] ?? 4317)

/** Returns the board path, or null when the party is out (C8: refused in character). */
let last: Town | undefined
async function once(): Promise<string | null> {
  const t = await town(await readSave())
  last = t
  if (t.inRaid) {
    // one farewell per expedition, on its first save (C24); after that the board waits for the return (C16)
    const keyFile = Bun.file(join(outDir, "farewell.key"))
    if (t.raid && (!(await keyFile.exists()) || (await keyFile.text()) !== t.raid.key)) {
      const out = await buildFarewell(t)
      await Bun.write(join(outDir, "farewell.key"), t.raid.key)
      console.log(`farewell, week ${t.week}: ${out}`)
      return out
    }
    console.log(`The Caretaker: "You are not back yet. I will be at the gate when you return from the ${t.raidDungeon}."`)
    return null
  }
  const out = await buildBoard(t, { foresight })
  console.log(`week ${t.week}: ${out}`)
  return out
}

if (cmd === "town") {
  await once()
} else if (cmd === "watch") {
  let version = 0
  // one rebuild at a time; a save or an answer arriving mid-build queues exactly one more
  let running: Promise<void> | undefined, again = false
  const rebuild = async (): Promise<void> => {
    if (running) { again = true; return running }
    running = (async () => {
      do {
        again = false
        try { if (await once()) version++ } catch (e) { console.error((e as Error).message) }
      } while (again)
      running = undefined
    })()
    return running
  }
  await rebuild()
  // the game writes several persist files per save; one rebuild per burst
  let timer: ReturnType<typeof setTimeout> | undefined
  fsWatch(profileDir(), (_e, f) => {
    if (!f?.startsWith("persist.")) return
    clearTimeout(timer)
    timer = setTimeout(() => void rebuild(), 1500)
  })
  // the served page reloads when the board changes, and can send its answers back to the Caretaker; once he has them,
  // the page forgets them, so an old pick or sticky is never sent twice (the week's picks live on in picks.json, C18)
  const reload = `<button id="toCaretaker" class="btn">Send to the Caretaker</button><script>(()=>{let v=null;setInterval(async()=>{try{const r=await fetch('/version');const n=await r.text();if(v!==null&&n!==v)location.reload();v=n}catch{}},2000);const b=document.getElementById('toCaretaker');b.onclick=async()=>{b.textContent='Sent…';const r=await fetch('/answers',{method:'POST',body:window.brainstormAnswers()});if(r.ok){try{localStorage.removeItem((window.BRAINSTORM_KEY||'brainstorm')+':v1')}catch{}b.textContent='The Caretaker has your answers';location.reload()}else{b.textContent='Not received; send again'}}})()</script>`
  Bun.serve({
    port, hostname: "127.0.0.1",
    async fetch(req) {
      const path = new URL(req.url).pathname
      if (path === "/version") return new Response(String(version))
      if (path === "/answers" && req.method === "POST") {
        const body = await req.text()
        await Bun.write(join(outDir, "answers.md"), body)
        const log = Bun.file(join(outDir, "answers-log.md"))
        await Bun.write(log, `${(await log.exists()) ? await log.text() : ""}\n\n<!-- ${new Date().toISOString()} -->\n${body}`)
        // the week's picks, merged, so a card that leaves the board once done keeps its pick (C18)
        // a pick is checked against the board it was made on, so a pick that slid onto another card is dropped
        const board = Bun.file(join(outDir, "town.md"))
        const options = (await board.exists()) ? boardOptions(await board.text()) : undefined
        if (last) await Bun.write(picksFile(outDir), JSON.stringify(mergePicks(await loadPicks(outDir), body, last, options), null, 1))
        await rebuild()
        return new Response("ok")
      }
      if (path === "/" || path === "/town.html") {
        const html = await Bun.file(join(outDir, "town.html")).text()
        return new Response(html.replace("</body>", `${reload}</body>`), { headers: { "content-type": "text/html; charset=utf-8" } })
      }
      const f = Bun.file(join(outDir, path.replace(/^\/+/, "")))
      return (await f.exists()) ? new Response(f) : new Response("not found", { status: 404 })
    },
  })
  console.log(`The town board: http://127.0.0.1:${port}/  (watching ${profileDir()})`)
} else {
  console.log("usage: bun run town | bun run watch [--foresight] [--port=4317]")
}
