// The road page: a conversation with the Caretaker while the party is out (C49). Soushi writes from the dungeon,
// the agent watching the session answers at every turn, and the page shows both beside the party's latest state.
//   bun run say "<text>"        the agent's comment on the current page, appended to the expedition's thread
//   (served by bun run watch)   /road is the page, /road/feed its data, POST /road/message a line from Soushi
// It only reads the chronicle and writes under .local/town/road/ (ISA A1).
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { outDir } from "./board.ts"

// read at call time, so a test that sets DD_TOWN_OUT after its imports never writes into the live thread
const town = () => process.env.DD_TOWN_OUT ?? outDir
export const roadDir = () => join(town(), "road")
const chron = () => join(town(), "chronicle")
export const messagesFile = () => join(roadDir(), "messages.jsonl")
export const commentsFile = () => join(roadDir(), "comments.jsonl")

export type Line = { at: string; from: "caretaker" | "soushi"; text: string; page?: string; trip?: string }

/** The expedition being walked: the chronicle folder saved to last, and its newest page. */
export function current(): { trip?: string; page?: string; file?: string } {
  try {
    const trip = readdirSync(chron()).map((d) => ({ d, t: statSync(join(chron(), d)).mtimeMs })).sort((a, b) => b.t - a.t)[0]?.d
    if (!trip) return {}
    const file = readdirSync(join(chron(), trip)).filter((f) => /^\d+\.json$/.test(f)).sort().at(-1)
    return { trip, page: file?.replace(/\.json$/, ""), file: file && join(chron(), trip, file) }
  } catch { return {} }
}

function append(path: string, line: Line) {
  mkdirSync(roadDir(), { recursive: true })
  appendFileSync(path, JSON.stringify(line) + "\n")
}

const read = async (path: string): Promise<Line[]> => existsSync(path)
  ? (await Bun.file(path).text()).split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as Line] } catch { return [] } })
  : []

export function say(text: string, page?: string) {
  const c = current()
  append(commentsFile(), { at: new Date().toISOString(), from: "caretaker", text, page: page ?? c.page, trip: c.trip })
}

export function ask(text: string) {
  const c = current()
  append(messagesFile(), { at: new Date().toISOString(), from: "soushi", text, page: c.page, trip: c.trip })
}

/** The thread of the current expedition, oldest first, and the party as its latest page left them. */
export async function feed() {
  const c = current()
  const lines = [...await read(commentsFile()), ...await read(messagesFile())].filter((l) => !c.trip || l.trip === c.trip).sort((a, b) => a.at.localeCompare(b.at))
  let state: any = null
  try {
    const p = c.file ? await Bun.file(c.file).json() : null
    if (p) state = {
      page: c.page, dungeon: p.dungeon, torch: p.torch, food: p.supplies?.food ?? 0, torches: p.supplies?.torch ?? 0,
      rooms: p.tally?.ROOM_VISITED ?? 0, battles: p.tally?.BATTLE_COMPLETED ?? 0,
      heroes: (p.heroes ?? []).map((h: any) => ({ name: h.name, cls: h.cls, hp: Math.round(h.hp), maxHp: h.maxHp, stress: h.stress, affliction: h.affliction, virtue: h.virtue, deathsDoor: h.deathsDoor })),
      foes: p.battle ? p.battle.foes.map((f: any) => ({ name: f.name, hp: f.hp })) : null, round: p.battle?.round,
    }
  } catch {}
  return { trip: c.trip, state, lines }
}

export const roadPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>On the Road</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/road/theme.css"><style>
:root{--bg:#0d0b09;--panel:#1a1612;--ink:#d8cbb0;--dim:#8a7d66;--gold:#c9a24a;--blood:#8b1a1a;--line:#3a3128}
body{background:var(--bg);color:var(--ink);font-family:"IM Fell English",Georgia,serif;margin:0;font-size:17px}
main{max-width:52rem;margin:0 auto;padding:16px;display:flex;flex-direction:column;height:100vh;box-sizing:border-box}
h1{font-size:1.5rem;color:var(--gold);margin:.2rem 0 .6rem;font-weight:normal}
#party{background:var(--panel);border:1px solid var(--line);padding:.6rem .8rem;border-radius:4px}
.meta{color:var(--dim);font-size:.9rem;margin-bottom:.4rem}
.seat{display:grid;grid-template-columns:7rem 1fr 1fr;gap:.6rem;align-items:center;margin:.25rem 0;font-size:.95rem}
.bar{position:relative;height:.8rem;background:#000;border:1px solid var(--line);border-radius:2px;overflow:hidden}
.bar i{position:absolute;inset:0 auto 0 0;display:block}.bar.hp i{background:#6d1c1c}.bar.st i{background:#d8cbb0}
.bar.st::after{content:"";position:absolute;left:50%;top:0;bottom:0;border-left:1px dashed var(--gold)}
.bar span{position:absolute;right:.3rem;top:-.12rem;font-size:.72rem;color:var(--gold);mix-blend-mode:difference}
.tag{color:var(--gold);font-size:.8rem}
#thread{flex:1;overflow-y:auto;margin:.8rem 0;display:flex;flex-direction:column;gap:.5rem}
.msg{max-width:85%;padding:.5rem .7rem;border-radius:4px;border:1px solid var(--line);white-space:pre-wrap;line-height:1.35}
.caretaker{align-self:flex-start;background:var(--panel)}.soushi{align-self:flex-end;background:#2a1a14;border-color:#5a2a1e}
.who{font-size:.75rem;color:var(--dim);margin-bottom:.2rem}
form{display:flex;gap:.5rem}textarea{flex:1;background:var(--panel);color:var(--ink);border:1px solid var(--line);font:inherit;padding:.5rem;resize:none;height:3.2rem}
button{background:var(--blood);color:var(--ink);border:1px solid #b33;font:inherit;padding:0 1rem;cursor:pointer}
.empty{color:var(--dim);font-style:italic}
@media (max-width:520px){.seat{grid-template-columns:5rem 1fr 1fr}}
</style></head><body><main>
<h1>On the Road, with the Caretaker</h1><div id="party"><div class="empty">Waiting for the first page of the road.</div></div>
<div id="thread"></div>
<form id="f"><textarea id="t" placeholder="Write to the Caretaker (Enter sends, Shift+Enter breaks the line)"></textarea><button>Send</button></form>
</main><script>
const esc=s=>String(s??"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"})[c]);
const time=iso=>new Date(iso).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});
let shown="";
async function tick(){try{const r=await fetch("/road/feed",{cache:"no-store"});const d=await r.json();const s=d.state;
const P=document.getElementById("party");
if(s){P.innerHTML='<div class="meta">Page '+esc(s.page)+' in the '+esc(s.dungeon)+' · light '+s.torch+' · '+s.rooms+' rooms, '+s.battles+' battles · '+s.food+' food, '+s.torches+' torches'+(s.foes?' · round '+s.round+': '+s.foes.map(f=>esc(f.name)+' '+f.hp+'hp').join(', '):'')+'</div><div class="seat meta"><div></div><div>Health</div><div>Stress (the line is 100, the end 200)</div></div>'+
s.heroes.map(h=>'<div class="seat"><div>'+esc(h.name)+(h.affliction?' <span class="tag">'+esc(h.affliction)+'</span>':'')+(h.virtue?' <span class="tag">'+esc(h.virtue)+'</span>':'')+(h.deathsDoor?' <span class="tag">Death\\'s Door</span>':'')+'</div>'+
'<div class="bar hp" title="health"><i style="width:'+Math.max(0,Math.min(100,100*h.hp/h.maxHp))+'%"></i><span>'+h.hp+'/'+h.maxHp+'</span></div>'+
'<div class="bar st" title="stress, of 200; the line is 100"><i style="width:'+Math.min(100,h.stress/2)+'%"></i><span>'+h.stress+'</span></div></div>').join("")}
const key=JSON.stringify(d.lines);if(key===shown)return;shown=key;const T=document.getElementById("thread");const atEnd=T.scrollHeight-T.scrollTop-T.clientHeight<40;
T.innerHTML=d.lines.length?d.lines.map(l=>'<div class="msg '+l.from+'"><div class="who">'+(l.from==="soushi"?"You":"The Caretaker")+' · '+time(l.at)+(l.page?' · page '+esc(l.page):'')+'</div>'+esc(l.text)+'</div>').join(""):'<div class="empty">Nothing said yet on this road.</div>';
if(atEnd||d.lines.at(-1)?.from==="soushi")T.scrollTop=T.scrollHeight}catch{}}
tick();setInterval(tick,2000);
const t=document.getElementById("t");document.getElementById("f").onsubmit=async e=>{e.preventDefault();const v=t.value.trim();if(!v)return;t.value="";
await fetch("/road/message",{method:"POST",body:v});tick()};
t.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();document.getElementById("f").requestSubmit()}});
</script></body></html>`

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd === "say" && rest.join(" ").trim()) { say(rest.join(" ").trim()); console.log(`said on page ${current().page ?? "?"}`) }
  else console.log('usage: bun run say "<text>"')
}
