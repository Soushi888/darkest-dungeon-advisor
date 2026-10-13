// bun run town     build the town board once from the newest save
// bun run watch    keep it live: every save made in the Hamlet rebuilds it; during an expedition it waits (C16)
// flags: --foresight (experimental, C7), --port=<n> for watch (default 4317)
import { existsSync, statSync, watch as fsWatch } from "node:fs"
import { join } from "node:path"
import { buildBoard, buildFarewell } from "./voice/board.ts"
import { capture } from "./road/chronicle.ts"
import { outDir, profileDir } from "./sources/paths.ts"
import { readSave } from "./sources/read.ts"
import { town, type Town } from "./world/town.ts"
import { boardOptions, loadPicks, mergePicks, picksFile } from "./world/reconcile.ts"
import { ask, feed, roadPanel } from "./road.ts"
import { keepDrafts } from "./voice/drafts.ts"

const args = process.argv.slice(2)
const cmd = args[0] ?? "town"
const foresight = args.includes("--foresight")
const port = Number(args.find((a) => a.startsWith("--port="))?.split("=")[1] ?? 4317)

/** Returns the board path, or null when the party is out (C8: refused in character). */
let last: Town | undefined
async function once(): Promise<string | null> {
  const save = await readSave()
  const t = await town(save)
  last = t
  if (t.inRaid) {
    // C39: every dungeon save that changed the party is kept, because the game deletes its own record on return
    const kept = await capture(save)
    if (kept) console.log(`chronicle: ${kept}`)
    // one farewell per expedition, on its first save (C24); after that the board waits for the return (C16)
    const keyFile = Bun.file(join(outDir(), "farewell.key"))
    if (t.raid && (!(await keyFile.exists()) || (await keyFile.text()) !== t.raid.key)) {
      const out = await buildFarewell(t)
      await Bun.write(join(outDir(), "farewell.key"), t.raid.key)
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
  const started = Date.now()
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
  // the served page reloads when the board changes, and can send its answers back to the Caretaker from a button in the
  // board's own navbar; once he has them,
  // the page forgets them, so an old pick or sticky is never sent twice (the week's picks live on in picks.json, C18)
  const reload = `<button id="toCaretaker" class="btn" title="Send to the Caretaker (Ctrl+Shift+Enter)">Send to the Caretaker</button><script>(()=>{${keepDrafts}let v=null,due=0;setInterval(async()=>{try{const r=await fetch('/version');const n=await r.text();if(v!==null&&n!==v&&!due)due=Date.now();v=n}catch{}if(due&&!window.ddWriting(Date.now()-due)){due=0;location.reload()}},2000);const b=document.getElementById('toCaretaker');const nav=document.querySelector('nav.bar'),cp=document.getElementById('copyAll');if(nav){b.classList.add('primary');nav.insertBefore(b,cp||null)}b.onclick=async()=>{b.textContent='Sent…';const r=await fetch('/answers',{method:'POST',body:window.brainstormAnswers()});if(r.ok){try{localStorage.removeItem((window.BRAINSTORM_KEY||'brainstorm')+':v1')}catch{}b.textContent='The Caretaker has your answers';location.reload()}else{b.textContent='Not received; send again'}};document.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&e.shiftKey&&!e.repeat){e.preventDefault();b.click()}})})()</script>`
  Bun.serve({
    port, hostname: "127.0.0.1",
    async fetch(req) {
      const path = new URL(req.url).pathname
      // the watcher's start time rides with the counter, so a page left open across a restart still sees the next build (C16)
      if (path === "/version") return new Response(`${started}-${version}`, { headers: { "cache-control": "no-store" } })
      // C49: the road zone's data, a conversation with the Caretaker while the party is out
      if (path === "/road/feed") return Response.json({ ...await feed(), out: !!last?.inRaid }, { headers: { "cache-control": "no-store" } })
      if (path === "/road/message" && req.method === "POST") {
        const text = (await req.text()).trim().slice(0, 4000)
        if (text) ask(text)
        return new Response("ok")
      }
      if (path === "/answers" && req.method === "POST") {
        const body = await req.text()
        await Bun.write(join(outDir(), "answers.md"), body)
        const log = Bun.file(join(outDir(), "answers-log.md"))
        await Bun.write(log, `${(await log.exists()) ? await log.text() : ""}\n\n<!-- ${new Date().toISOString()} -->\n${body}`)
        // the week's picks, merged, so a card that leaves the board once done keeps its pick (C18)
        // a pick is checked against the board it was made on, so a pick that slid onto another card is dropped
        const board = Bun.file(join(outDir(), "town.md"))
        const options = (await board.exists()) ? boardOptions(await board.text()) : undefined
        if (last) await Bun.write(picksFile(outDir()), JSON.stringify(mergePicks(await loadPicks(outDir()), body, last, options), null, 1))
        await rebuild()
        return new Response("ok")
      }
      if (path === "/road") return Response.redirect("/#road", 302)
      if (path === "/" || path === "/town.html") {
        const html = await Bun.file(join(outDir(), "town.html")).text()
        // the last send's stamp: a page whose inputs predate it forgets them on load, even inputs kept from before this fix
        const log = join(outDir(), "answers-log.md")
        const sent = existsSync(log) ? String(statSync(log).mtimeMs) : "none"
        const forget = `<script>(()=>{try{const K=(window.BRAINSTORM_KEY||'brainstorm')+':v1';if(localStorage.getItem('ddSent')!==${JSON.stringify(sent)}){const had=localStorage.getItem(K);localStorage.removeItem(K);localStorage.setItem('ddSent',${JSON.stringify(sent)});if(had)location.reload()}}catch{}})()</script>`
        // C18: the board stores each pick under its card's number, so a card that comes or goes between builds slid picks onto
        // the wrong card (three times on 2026-10-10). Before the board's script reads them, re-key the stored picks by question
        // text against this build's cards, keeping a pick only where it is still one of its card's options.
        const md = Bun.file(join(outDir(), "town.md"))
        const cards = (await md.exists()) ? [...boardOptions(await md.text())].map(([q, o]) => ({ q, o })) : []
        const key = (html.match(/window\.BRAINSTORM_KEY=("(?:[^"\\]|\\.)*")/)?.[1]) ?? '"brainstorm"'
        const rekey = `<script>(()=>{try{const K=${key}+':v1',C=${JSON.stringify(cards).replaceAll("<", "\\u003c")},st=JSON.parse(localStorage.getItem(K)||'{}'),was=JSON.parse(localStorage.getItem('ddCards')||'null');if(st.dec&&was){const byQ={};for(const[id,v]of Object.entries(st.dec)){const q=was[Number(id)-1];if(q)byQ[q]=v}const dec={};C.forEach((c,i)=>{const v=byQ[c.q];if(!v)return;const keep={};if(v.pick&&c.o.includes(v.pick))keep.pick=v.pick;if(v.note)keep.note=v.note;if(keep.pick||keep.note)dec[String(i+1)]=keep});st.dec=dec;localStorage.setItem(K,JSON.stringify(st))}localStorage.setItem('ddCards',JSON.stringify(C.map(c=>c.q)))}catch{}})()</script>`
        return new Response(html.replace("<head>", `<head>${rekey}`).replace("</body>", `${forget}${reload}${roadPanel}</body>`), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } })
      }
      const f = Bun.file(join(outDir(), path.replace(/^\/+/, "")))
      return (await f.exists()) ? new Response(f) : new Response("not found", { status: 404 })
    },
  })
  console.log(`The town board: http://127.0.0.1:${port}/  (watching ${profileDir()})`)
} else {
  console.log("usage: bun run town | bun run watch [--foresight] [--port=4317]")
}
