// bun run live: one line per event of a live session, for the agent playing alongside Soushi to watch.
//   SEND <time> <n> picks       the board's "Send to the Caretaker" was pressed (.local/town/answers-log.md grew)
//   SAVE <time> town            a Hamlet save changed the rebuilt board (the game saves often; a save that changes nothing is silent)
//   SAVE <time> dungeon         the party left the Hamlet; the board waits (C16). Said once per expedition
//   CHRON <time> #<n> <summary>   a page of the chronicle that changes the story (C39): a battle, a room, an ambush, the light
//                                 past 50 or 25, a break, a virtue, Death's Door, a fall, a hero under 30% health
//   PAGE <time> #<n> <summary>    any other new page (kept, but not worth waking the agent)
//   MORE <rest>                the rest of a page longer than 400 characters, cut at its seams and printed with it in one write (C52)
//   ASK <time> <text>          Soushi wrote to the Caretaker from the road page (C49); answer with bun run say "<text>"
//   WARN <time> <n> contradictions: ...   the rebuilt board advises two things that cannot both be done (C38)
// It only reads the profile (ISA A1). See CLAUDE.md, "Live session".
import { existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { outDir } from "./board.ts"
import { monster, nameOf } from "./game.ts"
import { decode } from "./dson.ts"
import { profileDir } from "./paths.ts"
import { messagesFile } from "./road.ts"
import { newlySeen, whereLine } from "./map.ts"
import { effectWords, plain, wrap } from "./words.ts"
import { turnKind } from "./turns.ts"
import { alreadyTold, inOrder } from "./livemark.ts"

const log = join(outDir(), "answers-log.md")
const game = join(profileDir(), "persist.game.json")
const mtime = (p: string) => (existsSync(p) ? statSync(p).mtimeMs : 0)
const now = () => new Date().toLocaleTimeString("en-GB", { hour12: false })

const board = join(outDir(), "town.md")
const digest = async () => (existsSync(board) ? Bun.hash(await Bun.file(board).text()).toString() : "")
const inRaid = async () => { try { const d = decode(new Uint8Array(await Bun.file(game).arrayBuffer())) as any; return !!(d.base_root ?? d).inraid } catch { return false } }
let sent = mtime(log), saved = mtime(game), seen = await digest(), out = await inRaid()
const chron = join(outDir(), "chronicle")
const pages = () => { try { return readdirSync(chron).flatMap((d) => readdirSync(join(chron, d)).filter((f) => /^\d+\.json$/.test(f)).map((f) => join(chron, d, f))) } catch { return [] } }
// DD_LIVE_REPLAY=n tells the last n pages again on start, to check what a page reports
// pages in the order they were saved, never by path: a trip folder's name does not follow its age (C62)
const bySave = (fs: string[]) => inOrder(fs.flatMap((f) => { try { return [{ path: f, mtime: statSync(f).mtimeMs }] } catch { return [] } })).map((p) => p.path)
const replay = Number(process.env.DD_LIVE_REPLAY ?? 0), all = bySave(pages())
// a restarted stream resumes after the last page it told, so a page saved while it was down is still told
const mark = join(outDir(), "live-last.txt"), lastTold = existsSync(mark) ? (await Bun.file(mark).text()).trim() : ""
const told = alreadyTold(all.map((f) => ({ path: f, mtime: statSync(f).mtimeMs })), lastTold, replay)
const last = new Map<string, any>(), prevFile = new Map<string, string>(), lastBody = new Map<string, string>()
// the page before the first one told is what the next page is compared with
for (const f of all.filter((f) => told.has(f))) { try { last.set(f.split("/").slice(-2, -1)[0]!, await Bun.file(f).json()); prevFile.set(f.split("/").slice(-2, -1)[0]!, f.replace(/\.json$/, ".raw.json")) } catch {} }
const clashes = join(outDir(), "coherence.json")
let clashSeen = mtime(clashes)
// lines Soushi writes on the road page; the stream starts after the ones already there
let asked = existsSync(messagesFile()) ? (await Bun.file(messagesFile()).text()).split("\n").filter(Boolean).length : 0
console.log(`LIVE ${now()} watching ${outDir()} and ${game}`)
setInterval(async () => {
  for (const f of bySave(pages().filter((f) => !told.has(f)))) {
    told.add(f)
    if (!replay) await Bun.write(mark, f)
    try {
      const p = await Bun.file(f).json(), tl = p.tally ?? {}
      const who = (p.heroes ?? []).map((h: any) => `${h.name} ${Math.round(h.hp)}/${h.maxHp}hp ${h.stress}st${h.affliction ? ` ${h.affliction}` : ""}${h.virtue ? ` ${h.virtue}` : ""}${h.deathsDoor ? " DD" : ""}`).join(", ")
      // only a page that changes the story wakes the agent (Soushi, 2026-10-11: every turn ends in a spoken line); the rest print as PAGE
      const trip = f.split("/").slice(-2, -1)[0]!, prev = last.get(trip), pt = prev?.tally ?? {}, prevRaw = prevFile.get(trip)
      const crossed = (a: number, b: number) => [50, 25].some((x) => a >= x && b < x)
      const notable = !prev || ["BATTLE_COMPLETED", "ROOM_VISITED", "AMBUSHED"].some((k) => (tl[k] ?? 0) !== (pt[k] ?? 0)) || crossed(prev.torch, p.torch)
        || (p.heroes ?? []).some((h: any) => { const w = prev.heroes?.find((x: any) => x.guid === h.guid); return !w || (h.affliction && !w.affliction) || (h.virtue && !w.virtue) || (h.deathsDoor && !w.deathsDoor) || (h.hp < h.maxHp * 0.3 && w.hp >= w.maxHp * 0.3) })
        || (prev.heroes ?? []).length !== (p.heroes ?? []).length
      // the map (C51): where they stand, and what came into sight since the last page; a sight is worth waking for
      const where = whereLine(p.map), seen = newlySeen(prev?.map, p.map)
      const noted = notable || seen.length > 0
      last.set(f.split("/").slice(-2, -1)[0]!, p)
      prevFile.set(f.split("/").slice(-2, -1)[0]!, f.replace(/\.json$/, ".raw.json"))
      // every change since the last page, so no page reads as empty: the packs item by item, the game's tallies with their
      // names (the curio searched, the foe met or slain), and the loot a battle laid out (Soushi, 2026-10-11: "ensure you see all details")
      const delta: string[] = []
      if (prev) {
        const said = !prev.narrated ? [] : (p.narrated ?? []).slice(prev.narrated.length).filter((e: string) => !/^(kill_monster|victory|loot)$/.test(e))
        if (said.length) delta.push(`narrated: ${said.map((e: string) => e.replace(/_/g, " ")).join(", ")}`)
        if (p.torch !== prev.torch) delta.push(`light ${p.torch > prev.torch ? "+" : ""}${p.torch - prev.torch}`)
        for (const h of p.heroes ?? []) {
          const w = (prev.heroes ?? []).find((x: any) => x.guid === h.guid)
          if (!w) continue
          const dh = Math.round(h.hp) - Math.round(w.hp), ds = h.stress - w.stress
          // the game keeps the last foe that struck each hero; named on the page where the hero lost health, with the attacks
          // of that foe (witnessed ones only, C5) whose damage fits the blow: in range, or up to half again as a critical
          let by = ""
          // a loss equal to the blight or bleed the hero carried on the last page is that damage ticking, not a new blow
          // stacks tick together, so the loss may be one stack or all of them
          const stacks: [string, number][] = (w.effects ?? []).map((x: string) => x.match(/^(blight|bleed|stat [45]) (\d+)/)).filter(Boolean).map((m: any) => [m[1].replace("stat 4", "blight").replace("stat 5", "bleed"), Number(m[2])] as [string, number])
          const one = stacks.find(([, n]) => n === -dh), all = stacks.reduce((t, [, n]) => t + n, 0)
          const tick = dh < 0 && (one || (stacks.length > 1 && all === -dh)) ? (one ? one[0] : [...new Set(stacks.map(([k]: [string, number]) => k))].join(" and ") + ` (${stacks.length} stacks)`) : ""
          if (tick) by = ` (${tick} ticking)`
          else if (dh < 0 && h.lastBlow) {
            const m = h.blowCls ? await monster(h.blowCls) : undefined, loss = -dh, known = new Set<string>(p.known ?? [])
            const fits = [...(m?.dmg ?? [])].filter(([id]) => !p.known || known.has(id)).flatMap(([id, [lo, hi]]) =>
              loss >= lo && loss <= hi ? [`${id.replace(/_/g, " ")} ${lo}-${hi}`] : loss > hi && loss <= Math.ceil(hi * 1.5) ? [`${id.replace(/_/g, " ")} ${lo}-${hi}, a critical`] : [])
            by = ` (hit by ${h.lastBlow}${fits.length ? `: ${fits.join(" or ")}` : m ? ": no witnessed attack of it deals that much, so more than one blow" : ""})`
          }
          if (dh || ds) delta.push(`${h.name}${dh ? ` ${dh > 0 ? "+" : ""}${dh}hp` : ""}${ds ? ` ${ds > 0 ? "+" : ""}${ds}st` : ""}${by}`)
        }
        // who took a turn since the last page (the game counts each actor's turns), and what changed on each actor
        const acted: string[] = []
        for (const h of p.heroes ?? []) { const w = (prev.heroes ?? []).find((x: any) => x.guid === h.guid); if (w && (h.turns ?? 0) > (w.turns ?? 0)) acted.push(h.name) }
        const pf: any[] = prev.battle?.foes ?? [], nf: any[] = p.battle?.foes ?? []
        for (const e of nf) { const w = pf.find((x) => x.guid && x.guid === e.guid); if (w && (e.turns ?? 0) > (w.turns ?? 0)) acted.push(e.name) }
        // one turn between two pages is told by what it did: a hit, a dodge, a move, a buff, a heal, or unknown (C53)
        if (acted.length === 1) {
          const dodges = async (file?: string) => { try { return Number((await Bun.file(file!).json()).raid?.battle?.consecutive_monster_dodges ?? 0) } catch { return 0 } }
          const side = (p.heroes ?? []).some((h: any) => h.name === acted[0]) ? "hero" : "foe"
          const turn = turnKind({ heroes: prev.heroes ?? [], foes: pf }, { heroes: p.heroes ?? [], foes: nf }, { name: acted[0]!, side }, [await dodges(prevRaw), await dodges(f.replace(/\.json$/, ".raw.json"))])
          delta.push(`turn: ${turn.said}`)
        } else if (acted.length) delta.push(`acted: ${acted.join(", ")}`)
        for (const e of nf) {
          const w = pf.find((x) => x.guid && x.guid === e.guid)
          if (!w) continue
          const d = e.hp - w.hp
          if (d) delta.push(`${e.name} ${d > 0 ? "+" : ""}${d}hp${d < 0 && !acted.some((a) => (p.heroes ?? []).some((h: any) => h.name === a)) ? " (no hero acted: damage over time)" : ""}`)
        }
        const actors = [...(p.heroes ?? []).map((h: any) => [h, (prev.heroes ?? []).find((x: any) => x.guid === h.guid)]), ...nf.map((e) => [e, pf.find((x) => x.guid && x.guid === e.guid)])]
        for (const [a, w] of actors) {
          if (!w || !w.effects) continue // a page from before effects were kept has nothing to compare with
          // in words, once each (a damage buff is kept as a low and a high of the same amount), and an effect whose only change
          // is a round ticking off its count is neither gained nor lost
          const said = async (xs: string[]) => [...new Set(await Promise.all(xs.map(effectWords)))]
          const gained = await said((a.effects ?? []).filter((x: string) => !(w.effects ?? []).includes(x)))
          const lost = await said((w.effects ?? []).filter((x: string) => !(a.effects ?? []).includes(x)))
          const bare = (x: string) => x.replace(/ for \d+ rounds?/, "")
          const ticking = new Set(gained.filter((x) => lost.some((y) => bare(y) === bare(x))).map(bare))
          for (const x of gained) if (!ticking.has(bare(x))) delta.push(`${a.name} gains ${x}`)
          for (const x of lost) if (!ticking.has(bare(x))) delta.push(`${a.name} loses ${x}`)
          for (const x of (a.dots ?? []).filter((x: string) => !(w.dots ?? []).includes(x))) delta.push(`${a.name} suffers ${plain(x.split(" ")[0]!)}`)
          if (a.stunned && !w.stunned) delta.push(`${a.name} STUNNED`)
        }
        for (const k of new Set([...Object.keys(prev.supplies ?? {}), ...Object.keys(p.supplies ?? {})])) {
          const d = (p.supplies?.[k] ?? 0) - (prev.supplies?.[k] ?? 0)
          if (d) delta.push(`${plain(k)} ${d > 0 ? "+" : ""}${d}`)
        }
        try {
          const raw = await Bun.file(f.replace(/\.json$/, ".raw.json")).json(), sd = raw.raid?.stat_database ?? {}
          for (const [k, v] of Object.entries<any>(sd)) {
            const n = (tl[k] ?? 0) - (pt[k] ?? 0)
            if (n <= 0 || k === "UNDEFINED") continue
            const ids = Object.values<any>(v.entries ?? {}).slice(-n).map((e) => Object.values<any>(e.parameters ?? {}).map((x) => x.data).filter((x) => typeof x === "string").pop()).filter(Boolean)
            const what: string[] = []
            for (const id of ids) what.push((/^MONSTER_/.test(k) && (await nameOf("monster", id!))) || plain(id!)) // one at a time: parallel lookups race the name cache
            delta.push(`${k.toLowerCase().replace(/_/g, " ")} +${n}${what.length ? ` (${what.join(", ")})` : ""}`)
          }
          // what a curio or a blow left on each hero: quirks and diseases gained or lost, and a heart attack (Soushi: a curio once gave one)
          const before = prevRaw ? await Bun.file(prevRaw).json().catch(() => undefined) : undefined
          for (const [g, h] of Object.entries<any>(raw.heroes ?? {})) {
            const r = h?.hero_file_data?.raw_data ?? h, w = before?.heroes?.[g]?.hero_file_data?.raw_data ?? before?.heroes?.[g]
            if (!r || !w) continue
            const q = Object.keys(r.quirks ?? {}), wq = Object.keys(w.quirks ?? {})
            const name = r.actor?.name ?? g
            for (const id of q.filter((x) => !wq.includes(x))) delta.push(`${name} gained ${(await nameOf("quirk", id)) || id}`)
            for (const id of wq.filter((x) => !q.includes(x))) delta.push(`${name} lost ${(await nameOf("quirk", id)) || id}`)
            if (r.has_had_heart_attack && !w.has_had_heart_attack) delta.push(`${name} HAD A HEART ATTACK`)
          }
          const offered = Object.values<any>(raw.raid?.loot?.result?.inventory_system?.items ?? {}).map((i) => `${plain(i.id || i.type)} x${i.amount}`)
          if (offered.length) delta.push(`loot laid out: ${offered.join(", ")}`)
        } catch {}
        const moved = (p.heroes ?? []).map((h: any) => h.guid).join() !== (prev.heroes ?? []).map((h: any) => h.guid).join()
        if (moved) delta.push(`ranks now ${(p.heroes ?? []).map((h: any, i: number) => `${i + 1}.${h.name}`).join(" ")}`)
      }
      const change = delta.length ? ` || changed: ${delta.join("; ")}` : ""
      const fight = p.battle ? ` || round ${p.battle.round}: ${p.battle.foes.map((x: any) => `${x.name} ${x.hp}hp${x.hitBy ? ` (hit by ${x.hitBy})` : ""}`).join(", ")}` : ""
      // a page whose only difference is the save itself (a new round opening, a turn starting) is folded into the next one
      const body = `${who}${fight.replace(/round \d+/, "")}${where}`
      if (!noted && !delta.length && body === lastBody.get(trip)) continue
      lastBody.set(trip, body)
      const map = `${where ? ` || ${where}` : ""}${seen.length ? ` || newly seen: ${seen.join(", ")}` : ""}`
      console.log(wrap(`${noted ? "CHRON" : "PAGE"} ${now()} #${f.match(/(\d+)\.json$/)![1]} saved ${new Date(statSync(f).mtimeMs).toLocaleTimeString("en-GB", { hour12: false })} light ${p.torch}, rooms ${tl.ROOM_VISITED ?? 0}, battles ${tl.BATTLE_COMPLETED ?? 0}, food ${p.supplies?.food ?? 0}, torches ${p.supplies?.torch ?? 0} | ${who}${fight}${change}${map}`).join("\n")) // one write, so a notification carries the whole page
    } catch {}
  }
  if (existsSync(messagesFile())) {
    const ls = (await Bun.file(messagesFile()).text()).split("\n").filter(Boolean)
    for (const l of ls.slice(asked)) { try { const m = JSON.parse(l); console.log(`ASK ${now()} page ${m.page ?? "?"}: ${String(m.text).replace(/\s+/g, " ")}`) } catch {} }
    asked = ls.length
  }
  if (mtime(clashes) !== clashSeen) {
    clashSeen = mtime(clashes)
    try { const c: string[] = (await Bun.file(clashes).json()).contradictions ?? []; if (c.length) console.log(`WARN ${now()} ${c.length} contradictions: ${c.join(" | ")}`) } catch {}
  }
  if (mtime(log) !== sent) {
    sent = mtime(log)
    const picks = (await Bun.file(join(outDir(), "answers.md")).text()).split("\n").filter((l) => l.startsWith("- **")).length
    console.log(`SEND ${now()} ${picks} picks`)
    setTimeout(async () => { seen = await digest() }, 6000) // the send rebuilds the board too; that change is not a save
  }
  if (mtime(game) !== saved) {
    saved = mtime(game)
    await Bun.sleep(2000) // the game writes its persist files in a burst
    const raid = await inRaid()
    if (raid) { if (!out) console.log(`SAVE ${now()} dungeon`); out = true; return }
    out = false
    await Bun.sleep(4000) // the watcher rebuilds 1.5 s after the burst, and the build takes a few seconds
    const d = await digest()
    if (d !== seen) { seen = d; console.log(`SAVE ${now()} town`) }
  }
}, 1000)
