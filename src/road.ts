// The road zone: a conversation with the Caretaker while the party is out (C49). Soushi writes from the dungeon,
// the agent watching the session answers at every turn, and the page shows both beside the party's latest state.
//   bun run say "<text>"        the agent's comment on the current page, appended to the expedition's thread
//   (served by bun run watch)   the farewell board's first zone while the party is out; /road/feed its data, POST /road/message a line from Soushi
// It only reads the chronicle and writes under .local/town/road/ (ISA A1).
import { mapLegend, mapSvg, whereLine } from "./map.ts"
import { isNotable } from "./notable.ts"
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { outDir } from "./board.ts"
import { monster } from "./game.ts"

// read at call time (outDir() is), so a test that sets DD_TOWN_OUT after its imports never writes into the live thread
const town = () => outDir()
export const roadDir = () => join(town(), "road")
const chron = () => join(town(), "chronicle")
export const messagesFile = () => join(roadDir(), "messages.jsonl")
export const commentsFile = () => join(roadDir(), "comments.jsonl")

export type Line = { at: string; from: "caretaker" | "soushi"; text: string; page?: string; trip?: string; gameAt?: string }

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

/** The Caretaker's line, tied to the page it answers; the page the game had reached is kept beside it, so a late line shows (C56). */
export function say(text: string, page?: string) {
  const c = current(), about = page ? page.padStart(4, "0") : c.page
  append(commentsFile(), { at: new Date().toISOString(), from: "caretaker", text, page: about, trip: c.trip, ...(about && c.page && about !== c.page ? { gameAt: c.page } : {}) })
}

export function ask(text: string) {
  const c = current()
  append(messagesFile(), { at: new Date().toISOString(), from: "soushi", text, page: c.page, trip: c.trip })
}

// the latest page of the trip that changes the story, the one the Caretaker answers (C65); kept until a page is added
let notableCache: { key: string; at?: { notablePage: string; notableAt: string } } | undefined
async function notableOf(trip: string): Promise<{ notablePage?: string; notableAt?: string }> {
  const dir = join(chron(), trip), files = readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)).sort(), key = `${trip}:${files.length}:${files.at(-1)}`
  if (notableCache?.key === key) return notableCache.at ?? {}
  let prev: any, at: { notablePage: string; notableAt: string } | undefined
  for (const f of files) {
    const p = await Bun.file(join(dir, f)).json().catch(() => undefined)
    if (!p) continue
    if (isNotable(prev, p)) at = { notablePage: f.replace(/\.json$/, ""), notableAt: new Date(statSync(join(dir, f)).mtimeMs).toISOString() }
    prev = p
  }
  notableCache = { key, at }
  return at ?? {}
}

/** The thread of the current expedition, oldest first, and the party as its latest page left them. */
export async function feed() {
  const c = current()
  const lines = [...await read(commentsFile()), ...await read(messagesFile())].filter((l) => !c.trip || l.trip === c.trip).sort((a, b) => a.at.localeCompare(b.at))
  let state: any = null
  try {
    const p = c.file ? await Bun.file(c.file).json() : null
    if (p) state = {
      page: c.page, pageAt: new Date(statSync(c.file!).mtimeMs).toISOString(), ...(await notableOf(c.trip!)), dungeon: p.dungeon, torch: p.torch, food: p.supplies?.food ?? 0, torches: p.supplies?.torch ?? 0,
      rooms: p.tally?.ROOM_VISITED ?? 0, battles: p.tally?.BATTLE_COMPLETED ?? 0,
      heroes: (p.heroes ?? []).map((h: any) => ({ name: h.name, cls: h.cls, hp: Math.round(h.hp), maxHp: h.maxHp, stress: h.stress, affliction: h.affliction, virtue: h.virtue, deathsDoor: h.deathsDoor })),
      // a foe's full health is the .hp of its own monster file; pages keep no maximum, and a foe's id is reused across fights
      foes: p.battle ? await Promise.all(p.battle.foes.map(async (f: any) => {
        const max = f.cls ? (await monster(f.cls))?.hp ?? 0 : 0
        // a corpse is a foe already killed, left lying in its rank: it blocks the line but cannot act
        return { name: f.name, hp: f.hp, maxHp: Math.max(f.hp, max), stunned: !!f.stunned, dots: f.dots ?? [], dead: /^corpse/.test(f.cls ?? "") }
      })) : null, round: p.battle?.round,
      // C51: the map as the party knows it, drawn without letters, and where they stand in words
      map: mapSvg(p.map), where: whereLine(p.map), legend: mapLegend(),
    }
  } catch {}
  return { trip: c.trip, state, lines }
}

// C49: the road zone. While the party is out, the farewell board turns into the road: this zone opens it, above the
// farewell's own zones, in the same page (Soushi, 2026-10-11: "it could be a transformation of the 'The coach has left'
// page"). The box to write sits on top and the newest line under it (Soushi's pin, 2026-10-11). Under it, while a page or a message from him is newer than my last line (for three minutes at most), it says what the Caretaker is about, a fight read differently from a corridor or a message (his pins, same night). It shows only while the party is out, and draws from /road/feed every two seconds.
export const roadPanel = `<style>
#road .meta{color:var(--dim);font-size:.9rem;margin:.2rem 0 .4rem}
#road .seat{display:grid;grid-template-columns:7rem 1fr 1fr;gap:.6rem;align-items:center;margin:.2rem 0;font-size:.95rem}
#road .bar{position:relative;height:.8rem;background:#000;border:1px solid var(--line);border-radius:2px;overflow:hidden}
#road .bar i{position:absolute;inset:0 auto 0 0;display:block}#road .bar.hp i{background:var(--blood)}#road .bar.st i{background:var(--ink)}
#road .bar.st::after{content:"";position:absolute;left:50%;top:0;bottom:0;border-left:1px dashed var(--gold)}
#road .bar span{position:absolute;right:.3rem;top:-.12rem;font-size:.72rem;color:var(--gold);mix-blend-mode:difference}
#road .seat.foe .bar.hp i{background:#4a5a2a}
#road .seat.foe.dead{opacity:.45}#road .seat.foe.dead .bar.hp i{background:#555}
#road .tag{color:var(--gold);font-size:.8rem}
#roadThread{max-height:28rem;overflow-y:auto;margin:.8rem 0;display:flex;flex-direction:column;gap:.5rem}
#road .msg{max-width:85%;padding:.5rem .7rem;border-radius:4px;border:1px solid var(--line);white-space:pre-wrap;line-height:1.35;background:var(--panel)}
#road .msg.soushi{align-self:flex-end;border-color:var(--blood)}#road .msg.caretaker{align-self:flex-start}
#road .who{display:block;font-size:.75rem;color:var(--dim);margin-bottom:.2rem}
#road p{margin:0}#road p.meta{margin:.2rem 0 .4rem}#road p.seat{margin:.2rem 0}
#road .legend{display:flex;flex-wrap:wrap;gap:.3rem .9rem;font-size:.8rem;color:var(--dim);margin:.3rem 0 0}#road .legend i{display:inline-block;width:.75rem;height:.75rem;border-radius:2px;vertical-align:-.1rem;margin-right:.3rem}#road .legend i.dot{border-radius:50%}#road .legend i.ring{border-radius:50%;border:2px solid #f5f5f4;background:none}
#roadForm{display:flex;gap:.5rem}#roadForm textarea{flex:1;background:var(--panel);color:var(--ink);border:1px solid var(--line);font:inherit;padding:.5rem;resize:vertical;min-height:3.2rem}
#roadBusy{margin:.6rem 0 0;font-style:italic;color:var(--gold)}
#road .empty{color:var(--dim);font-style:italic}
#roadMap{margin:.6rem 0}#roadMap svg{max-width:100%;height:auto;border:1px solid var(--line);border-radius:3px}#roadMap .meta{margin:.3rem 0 0}
@media (max-width:520px){#road .seat{grid-template-columns:5rem 1fr 1fr}}
</style><script>(()=>{const nav=document.querySelector('nav.bar');
const z=document.createElement('section');z.className='zone wide md';z.id='road';z.hidden=true;
z.innerHTML='<h2>On the road, with the Caretaker</h2><div id="roadParty"></div><div id="roadMap"></div><form id="roadForm"><textarea id="roadText" placeholder="Write to the Caretaker (Enter sends, Shift+Enter breaks the line)"></textarea><button class="btn primary">Send</button></form><div id="roadBusy" class="who" hidden></div><div id="roadThread"></div>';
const first=document.querySelector('section.zone');if(first)first.before(z);else document.body.append(z);
let link=null;
const esc=s=>String(s??"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"})[c]);
const time=iso=>new Date(iso).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});
let shown="";
const para=r=>{r.querySelectorAll(':scope > div, :scope > .msg').forEach(d=>{if(d.tagName==='P')return;const p=document.createElement('p');p.className=d.className;d.querySelectorAll('div').forEach(x=>{const n=document.createElement('span');n.className=x.className;if(x.title)n.title=x.title;n.style.cssText=x.style.cssText;n.append(...x.childNodes);x.replaceWith(n)});p.append(...d.childNodes);d.replaceWith(p)})};
const put=(el,h)=>{if(el.dataset.h===h)return;el.dataset.h=h;el.innerHTML=h;para(el)};
async function tick(){try{const d=await (await fetch("/road/feed",{cache:"no-store"})).json();z.hidden=!d.out;if(!d.out)return;const s=d.state;
if(!link&&nav){link=document.createElement('a');link.href='#road';link.textContent='On the road';const l=nav.querySelector('a[href^="#"]');l?l.before(link):nav.prepend(link)}
if(s)put(document.getElementById("roadParty"),'<div class="meta">Page '+esc(s.page)+' in the '+esc(s.dungeon)+' · light '+s.torch+' · '+s.rooms+' rooms, '+s.battles+' battles · '+s.food+' food, '+s.torches+' torches'+(s.foes?' · round '+s.round:'')+'</div>'+(s.foes?'<div class="seat meta"><div>The foes</div><div>Health</div><div></div></div>'+s.foes.map(f=>'<div class="seat foe'+(f.dead?' dead':'')+'"><div>'+(f.dead?'<s>'+esc(f.name)+'</s> <span class="tag">dead, only its body blocks the rank</span>':esc(f.name))+(f.stunned?' <span class="tag">stunned</span>':'')+(f.dots.length?' <span class="tag">'+esc(f.dots.join(', '))+'</span>':'')+'</div><div class="bar hp" title="health"><i style="width:'+Math.max(0,Math.min(100,100*f.hp/f.maxHp))+'%"></i><span>'+f.hp+'/'+f.maxHp+'</span></div><div></div></div>').join(''):'')+'<div class="seat meta"><div>The four</div><div>Health</div><div>Stress (the line is 100, the end 200)</div></div>'+
s.heroes.map(h=>'<div class="seat"><div>'+esc(h.name)+(h.affliction?' <span class="tag">'+esc(h.affliction)+'</span>':'')+(h.virtue?' <span class="tag">'+esc(h.virtue)+'</span>':'')+(h.deathsDoor?' <span class="tag">Death\\'s Door</span>':'')+'</div>'+
'<div class="bar hp" title="health"><i style="width:'+Math.max(0,Math.min(100,100*h.hp/h.maxHp))+'%"></i><span>'+h.hp+'/'+h.maxHp+'</span></div>'+
'<div class="bar st" title="stress, of 200; the line is 100"><i style="width:'+Math.min(100,h.stress/2)+'%"></i><span>'+h.stress+'</span></div></div>').join(""));
const M=document.getElementById("roadMap"),mk=s?(s.map||'')+(s.where||''):'';if(M.dataset.k!==mk){M.dataset.k=mk;M.innerHTML=s&&s.map?s.map+'<div class="meta">'+esc(s.where)+'</div>'+(s.legend||''):'';para(M)}
const mine=d.lines.filter(l=>l.from==="caretaker").at(-1),asked=d.lines.filter(l=>l.from==="soushi").at(-1),B=document.getElementById("roadBusy");
const fresh=at=>at&&Date.now()-new Date(at)<180000&&(!mine||at>mine.at);
const say=(a)=>"The Caretaker is "+a[Math.floor(Date.now()/4000)%a.length]+"…";
const busy=asked&&fresh(asked.at)?say(["reading your message","thinking over what you wrote","looking through the ledgers for an answer","weighing his words"])
:s&&s.notableAt&&fresh(s.notableAt)?say(s.foes?["watching the fight on page "+esc(s.notablePage),"counting who struck whom","looking up the foes' blows","weighing the next turn"]:["reading page "+esc(s.notablePage),"checking the packs","watching the light","tracing the map","noting it for the report"]):"";
B.hidden=!busy;B.textContent=busy;
const key=JSON.stringify(d.lines);if(key===shown)return;shown=key;const T=document.getElementById("roadThread");
T.innerHTML=d.lines.length?[...d.lines].reverse().map(l=>'<div class="msg '+l.from+'"><div class="who">'+(l.from==="soushi"?"You":"The Caretaker")+' · '+time(l.at)+(l.page?(l.gameAt?' · about page '+esc(l.page)+', the game was at '+esc(l.gameAt):' · page '+esc(l.page)):'')+'</div>'+esc(l.text)+'</div>').join(""):'<div class="empty">Nothing said yet on this road.</div>';para(T);
}catch{}}
tick();setInterval(tick,2000);
const t=document.getElementById("roadText");document.getElementById("roadForm").onsubmit=async e=>{e.preventDefault();const v=t.value.trim();if(!v)return;t.value="";await fetch("/road/message",{method:"POST",body:v});tick()};
t.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();document.getElementById("roadForm").requestSubmit()}})})()</script>`

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2)
  // bun run say --page 142 "<text>": the line answers page 142, whatever page the game has reached since
  const at = rest.indexOf("--page"), page = at >= 0 ? rest[at + 1] : undefined, words = at >= 0 ? [...rest.slice(0, at), ...rest.slice(at + 2)] : rest
  if (cmd === "say" && words.join(" ").trim()) { say(words.join(" ").trim(), page); const c = current(); console.log(`said about page ${page ?? c.page ?? "?"}${page && c.page && page.padStart(4, "0") !== c.page ? `, the game is at ${c.page}` : ""}`) }
  else console.log('usage: bun run say [--page N] "<text>"')
}
