// The road zone: a conversation with the Caretaker while the party is out (C49). Soushi writes from the dungeon,
// the agent watching the session answers at every turn, and the page shows both beside the party's latest state.
//   bun run say "<text>"        the agent's comment on the current page, appended to the expedition's thread
//   (served by bun run watch)   the farewell board's first zone while the party is out; /road/feed its data, POST /road/message a line from Soushi
// It only reads the chronicle and writes under .local/town/road/ (ISA A1).
import { mapLegend, mapSvg, whereLine } from "./map.ts"
import { isNotable } from "./notable.ts"
import { buildRecap, type Recap } from "./recap.ts"
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

export type Line = { at: string; from: "caretaker" | "soushi"; text: string; page?: string; trip?: string; gameAt?: string; recap?: Recap }

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
export function say(text: string, page?: string, recap?: Recap) {
  const c = current(), about = page ? page.padStart(4, "0") : c.page
  append(commentsFile(), { at: new Date().toISOString(), from: "caretaker", text, page: about, trip: c.trip, ...(about && c.page && about !== c.page ? { gameAt: c.page } : {}), ...(recap ? { recap } : {}) })
}

/** The Caretaker's recap of a page (C66): built from the page itself, his advice and what happened since his last word his own. */
export async function sayRecap(page: string | undefined, words: { advice: string; since?: string }) {
  const c = current(), n = (page ?? c.page ?? "").padStart(4, "0"), file = c.trip ? join(chron(), c.trip, `${n}.json`) : ""
  if (!file || !existsSync(file)) throw new Error(`no page ${n} on this road`)
  const p = await Bun.file(file).json(), raw = await Bun.file(file.replace(/\.json$/, ".raw.json")).json().catch(() => undefined)
  const r = buildRecap(p, raw, n, statSync(file).mtimeMs, words, town())
  say(`The road so far, page ${Number(n)}: ${words.advice}`, n, r)
  return r
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
#road .roadgrid{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:1.6rem;align-items:start}
@media (max-width:900px){#road .roadgrid{grid-template-columns:minmax(0,1fr)}}
#road .rc-head{font-size:.9rem;color:var(--dim);margin:0 0 .5rem}
#road .packs{margin:.8rem 0}#road .words{margin:1rem 0 .4rem;line-height:1.5;font-size:1.05rem}#road .words .said{margin:0 0 .7rem}
#road .meta{color:var(--dim);font-size:.9rem;margin:.2rem 0 .4rem}
#road .seat{display:grid;grid-template-columns:7rem minmax(0,1fr) minmax(0,1fr);gap:.6rem;align-items:center;margin:.25rem 0;font-size:.95rem}
#road .bar{position:relative;display:block;height:.8rem;padding:0;background:#000;border:1px solid var(--line);border-radius:2px;overflow:hidden;box-shadow:none}
#road .bar i{position:absolute;inset:0 auto 0 0;display:block}#road .bar.hp i{background:var(--blood)}#road .bar.st i{background:var(--ink)}
#road .bar.st::after{content:"";position:absolute;left:50%;top:0;bottom:0;border-left:1px dashed var(--gold)}
#road .bar span{position:absolute;right:.3rem;top:-.12rem;font-size:.72rem;color:var(--gold);mix-blend-mode:difference}
#road .seat.foe .bar.hp i{background:#4a5a2a}#road .seat.foe.dead{opacity:.45}#road .seat.foe.dead .bar.hp i{background:#555}
#road .tag{color:var(--gold);font-size:.8rem}
#road .packs{display:flex;flex-wrap:wrap;gap:.35rem 1rem;align-items:center}
#road .it{display:inline-flex;align-items:center;gap:.3rem;white-space:nowrap}#road .it img{height:1.6rem;width:auto}#road .it.loot{opacity:.9}
#road .packs .sep{flex-basis:100%;height:0}
#roadThread{max-height:min(70vh,48rem);overflow-y:auto;margin:.8rem 0;display:flex;flex-direction:column;gap:.5rem}
#road .msg{max-width:92%;padding:.5rem .7rem;border-radius:4px;border:1px solid var(--line);white-space:pre-wrap;line-height:1.35;background:var(--panel);margin:0}
#road .msg.soushi{align-self:flex-end;border-color:var(--blood)}#road .msg.caretaker{align-self:flex-start}
#road details.msg{white-space:normal}#road details.msg summary{cursor:pointer;color:var(--ink)}#road details.msg[open] summary{margin-bottom:.4rem}
#road .who{display:block;font-size:.75rem;color:var(--dim);margin-bottom:.2rem}
#road p{margin:0}#road p.meta{margin:.2rem 0 .4rem}
#road .legend{display:flex;flex-wrap:wrap;gap:.3rem .9rem;font-size:.8rem;color:var(--dim);margin:.3rem 0 0}#road .legend i{display:inline-block;width:.75rem;height:.75rem;border-radius:2px;vertical-align:-.1rem;margin-right:.3rem}#road .legend i.dot{border-radius:50%}#road .legend i.ring{border-radius:50%;border:2px solid #f5f5f4;background:none}
#roadForm{display:flex;gap:.5rem}#roadForm textarea{flex:1;min-width:0;background:var(--panel);color:var(--ink);border:1px solid var(--line);font:inherit;padding:.5rem;resize:vertical;min-height:3.2rem}
#roadBusy{margin:.6rem 0 0;font-style:italic;color:var(--gold)}
#road .empty{color:var(--dim);font-style:italic}
#roadMap{margin:.6rem 0}#roadMap svg{max-width:100%;height:auto;border:1px solid var(--line);border-radius:3px}
@media (max-width:520px){#road .seat{grid-template-columns:5rem minmax(0,1fr) minmax(0,1fr)}}
</style><script>(()=>{const nav=document.querySelector('nav.bar');
// C66: the road zone in two, the report (the latest recap, the foes in a fight, the map) beside the conversation
const z=document.createElement('section');z.className='zone wide md';z.id='road';z.hidden=true;
z.innerHTML='<h2>On the road, with the Caretaker</h2><div class="roadgrid"><div id="roadReport"><div id="roadCard"></div><div id="roadFoes"></div><div id="roadMap"></div></div><div id="roadTalk"><form id="roadForm"><textarea id="roadText" placeholder="Write to the Caretaker (Enter sends, Shift+Enter breaks the line)"></textarea><button class="btn primary">Send</button></form><div id="roadBusy" class="who" hidden></div><div id="roadThread"></div></div></div>';
const first=document.querySelector('section.zone');if(first)first.before(z);else document.body.append(z);
let link=null;
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]);
const time=iso=>new Date(iso).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});
const put=(el,h)=>{if(el.dataset.h===h)return;el.dataset.h=h;el.innerHTML=h};
const pct=(a,b)=>Math.max(0,Math.min(100,100*a/Math.max(1,b)));
const tags=t=>(t||[]).map(x=>' <span class="tag">'+esc(x)+'</span>').join('');
const four=hs=>'<p class="seat meta"><span></span><span>Health</span><span>Stress (the line is 100)</span></p>'+hs.map(h=>'<p class="seat"><span>'+esc(h.name)+tags(h.tags)+'</span><span class="bar hp" title="health"><i style="width:'+pct(h.hp,h.maxHp)+'%"></i><span>'+h.hp+'/'+h.maxHp+'</span></span><span class="bar st" title="stress, of 200; the line is 100"><i style="width:'+Math.min(100,h.stress/2)+'%"></i><span>'+h.stress+'</span></span></p>').join('');
const item=x=>'<span class="it'+(x.kind==='loot'?' loot':'')+'" title="'+esc(x.label)+'">'+(x.icon?'<img src="'+esc(x.icon)+'" alt="'+esc(x.label)+'">':esc(x.label)+' ')+'<b>'+x.n.toLocaleString('en-US')+'</b></span>';
const lost=n=>n?n+' lost':'none lost';
const words=t=>String(t||'').split(/\\n\\s*\\n/).map(x=>x.trim()).filter(Boolean).map(x=>'<p class="said">'+esc(x)+'</p>').join('');
const card=r=>'<p class="rc-head">Page '+Number(r.page)+' · '+r.tally.rooms+' rooms · '+r.tally.battles+' battles · '+lost(r.tally.lost)+'</p>'+four(r.four)+'<p class="packs"><span class="it">light <b>'+r.packs.light+'</b></span>'+r.packs.items.filter(x=>x.kind!=='loot').map(item).join('')+'<span class="sep"></span>'+r.packs.items.filter(x=>x.kind==='loot').map(item).join('')+'</p><div class="words">'+words(r.since)+words(r.advice)+'</div>';
const live=s=>'<p class="rc-head">Page '+Number(s.page)+' in the '+esc(s.dungeon)+' · '+s.rooms+' rooms · '+s.battles+' battles</p>'+four(s.heroes.map(h=>({...h,tags:[h.affliction,h.virtue,h.deathsDoor?"Death's Door":""].filter(Boolean)})))+'<p class="packs"><span class="it">light <b>'+s.torch+'</b></span><span class="it">food <b>'+s.food+'</b></span><span class="it">torches <b>'+s.torches+'</b></span></p>';
const foes=s=>s&&s.foes?'<p class="meta">The foes, round '+s.round+'</p>'+s.foes.map(f=>'<p class="seat foe'+(f.dead?' dead':'')+'"><span>'+(f.dead?'<s>'+esc(f.name)+'</s> <span class="tag">dead, only its body blocks the rank</span>':esc(f.name))+(f.stunned?' <span class="tag">stunned</span>':'')+(f.dots&&f.dots.length?' <span class="tag">'+esc(f.dots.join(', '))+'</span>':'')+'</span><span class="bar hp" title="health"><i style="width:'+pct(f.hp,f.maxHp)+'%"></i><span>'+f.hp+'/'+f.maxHp+'</span></span><span></span></p>').join(''):'';
const who=l=>'<span class="who">'+(l.from==="soushi"?"You":"The Caretaker")+' · '+time(l.at)+(l.page?(l.gameAt?' · about page '+esc(l.page)+', the game was at '+esc(l.gameAt):' · page '+esc(l.page)):'')+'</span>';
let shown="";
async function tick(){try{const d=await (await fetch("/road/feed",{cache:"no-store"})).json();z.hidden=!d.out;if(!d.out)return;const s=d.state;
if(!link&&nav){link=document.createElement('a');link.href='#road';link.textContent='On the road';const l=nav.querySelector('a[href^="#"]');l?l.before(link):nav.prepend(link)}
const recaps=d.lines.filter(l=>l.recap),latest=recaps.at(-1);
put(document.getElementById("roadCard"),latest?card(latest.recap)+(s&&s.page!==latest.recap.page?'<p class="meta">The game has gone on to page '+Number(s.page)+' since.</p>':''):s?live(s):'');
put(document.getElementById("roadFoes"),foes(s));
put(document.getElementById("roadMap"),s&&s.map?s.map+'<p class="meta">'+esc(s.where)+'</p>'+(s.legend||''):'');
const mine=d.lines.filter(l=>l.from==="caretaker").at(-1),asked=d.lines.filter(l=>l.from==="soushi").at(-1),B=document.getElementById("roadBusy");
const fresh=at=>at&&Date.now()-new Date(at)<180000&&(!mine||at>mine.at);
const say=(a)=>"The Caretaker is "+a[Math.floor(Date.now()/4000)%a.length]+"…";
const busy=asked&&fresh(asked.at)?say(["reading your message","thinking over what you wrote","looking through the ledgers for an answer","weighing his words"]):s&&s.notableAt&&fresh(s.notableAt)?say(s.foes?["watching the fight on page "+esc(s.notablePage),"counting who struck whom","looking up the foes' blows","weighing the next turn"]:["reading page "+esc(s.notablePage),"checking the packs","watching the light","tracing the map","noting it for the report"]):"";
B.hidden=!busy;B.textContent=busy;
const key=JSON.stringify(d.lines);if(key===shown)return;shown=key;const T=document.getElementById("roadThread");
const talk=[...d.lines].reverse().filter(l=>l!==latest);
T.innerHTML=talk.length?talk.map(l=>l.recap?'<details class="msg caretaker"><summary>'+who(l)+'The road so far, page '+Number(l.recap.page)+': '+l.recap.tally.rooms+' rooms, '+l.recap.tally.battles+' battles · '+esc(l.recap.advice.length>70?l.recap.advice.slice(0,70)+'…':l.recap.advice)+'</summary>'+card(l.recap)+'</details>':'<p class="msg '+l.from+'">'+who(l)+esc(l.text)+'</p>').join(""):'<p class="empty">Nothing said yet on this road.</p>';
}catch{}}
tick();setInterval(tick,2000);
const t=document.getElementById("roadText");document.getElementById("roadForm").onsubmit=async e=>{e.preventDefault();const v=t.value.trim();if(!v)return;t.value="";await fetch("/road/message",{method:"POST",body:v});tick()};
t.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();document.getElementById("roadForm").requestSubmit()}})})()</script>`

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2)
  // bun run say --page 142 "<text>": the line answers page 142, whatever page the game has reached since
  const at = rest.indexOf("--page"), page = at >= 0 ? rest[at + 1] : undefined, words = at >= 0 ? [...rest.slice(0, at), ...rest.slice(at + 2)] : rest
  // bun run say --recap --page 76 --advice "<text>" [--since "<text>"]: the recap card, built from the page itself (C66)
  const flag = (f: string) => { const i = words.indexOf(f); return i >= 0 ? words[i + 1] : undefined }
  if (cmd === "say" && words.includes("--recap")) {
    const advice = flag("--words") ?? flag("--advice")
    if (!advice) { console.log('usage: bun run say --recap [--page N] --words "<what he says, paragraphs split by a blank line>"'); process.exit(1) }
    const r = await sayRecap(page, { advice, since: flag("--since") })
    console.log(`recap on page ${r.page}: ${r.tally.rooms} rooms, ${r.tally.battles} battles, ${r.four.length} in the four, ${r.packs.items.length} kinds in the packs`)
  } else if (cmd === "say" && words.join(" ").trim()) { say(words.join(" ").trim(), page); const c = current(); console.log(`said about page ${page ?? c.page ?? "?"}${page && c.page && page.padStart(4, "0") !== c.page ? `, the game is at ${c.page}` : ""}`) }
  else console.log('usage: bun run say [--page N] "<text>"')
}
