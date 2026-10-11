// bun run now (C56): the latest chronicle page, read whole, in a few lines. The agent watching a live session reads it before
// every comment, so a claim about who acted, the ranks or anyone's health comes from the page and never from memory of the
// stream (Soushi, 2026-10-11 04:17: "ensure you are always well synced with the pages and game state"). Only what the page
// holds is said, nothing inferred. It only reads the chronicle (ISA A1).
import { statSync } from "node:fs"
import type { Snap } from "./chronicle.ts"
import { monster } from "./game.ts"
import { whereLine } from "./map.ts"
import { current } from "./road.ts"
import { effectWords, plain } from "./words.ts"

const time = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour12: false })

/** The page as a snapshot: its number and save time, the four front to back, the foes front to back, who has acted, where they stand. */
export async function nowText(p: Snap, raw: any, page: string, savedAt: number): Promise<string> {
  const out: string[] = []
  const b = raw?.raid?.battle, inFight = !!p.inBattle && !!b
  out.push(`PAGE ${page}, saved ${time(savedAt)}${inFight ? `, round ${b.round ?? p.battle?.round ?? "?"}` : ", out of a fight"}`)
  // who has taken this round's turn: the game spends an actor's initiative to 0 once it has acted
  const spent = (list: any) => new Set(Object.values<any>(list ?? {}).filter((x) => Number(x.initiative) === 0).map((x) => Number(x.roster_guid ?? x.battle_guid)))
  const heroDone = spent(b?.initiative?.heroes), foeDone = spent(b?.initiative?.monsters)
  const effects = async (xs: string[] = []) => (await Promise.all(xs.map(effectWords))).filter((x, i, a) => a.indexOf(x) === i)
  const rawHero = (g: number) => { const h = raw?.heroes?.[g]; return h?.hero_file_data?.raw_data ?? h }
  out.push("HEROES front to back:")
  for (const [i, h] of p.heroes.entries()) {
    const mode = rawHero(h.guid)?.actor?.current_mode_id
    const tags = [h.cls === "abomination" && typeof mode === "string" ? (mode === "beast" ? "as the beast" : "as the man") : "", h.stunned ? "stunned" : "", h.deathsDoor ? "at Death's Door" : "", h.affliction ? `afflicted (${h.affliction})` : "", h.virtue ? `virtuous (${h.virtue})` : "", inFight ? (heroDone.has(h.guid) ? "has acted" : "has not acted") : ""].filter(Boolean)
    const fx = await effects(h.effects)
    out.push(`  ${i + 1}. ${h.name} ${Math.round(h.hp)}/${h.maxHp} health, ${h.stress} stress${tags.length ? `, ${tags.join(", ")}` : ""}${fx.length ? `; ${fx.join("; ")}` : ""}`)
  }
  if (inFight) {
    out.push("FOES front to back:")
    // the fight keeps its foes by slot, front first ("0" is the front rank); a slain foe leaves a corpse in its slot
    const slots = Object.entries<any>(b.enemies ?? {}).filter(([, e]) => !e.is_hero).sort(([x], [y]) => Number(x) - Number(y))
    for (const [k, e] of slots) {
      const d = e.data ?? {}, a = d.actor ?? {}, cls = String(d.monster_class ?? ""), f = p.battle?.foes.find((x) => x.guid === Number(d.battle_guid))
      const name = f?.name ?? plain(cls), max = cls ? (await monster(cls))?.hp : undefined, hp = f?.hp ?? Math.round(Number(a.current_hp ?? 0))
      const fx = await effects(f?.effects)
      const tags = [/^corpse/.test(cls) ? "a corpse" : hp <= 0 ? "dead" : "", f?.stunned || a.stunned ? "stunned" : "", (f?.effects ?? []).some((x) => /guard/i.test(x)) ? "guarded" : "", foeDone.has(Number(d.battle_guid)) ? "has acted" : "has not acted"].filter(Boolean)
      out.push(`  slot ${Number(k) + 1}. ${name} ${hp}${max ? `/${max}` : ""} health, ${tags.join(", ")}${fx.length ? `; ${fx.join("; ")}` : ""}`)
    }
  }
  const where = whereLine(p.map)
  if (where) out.push(`WHERE ${where}`)
  out.push(`SUPPLIES ${Object.entries(p.supplies).filter(([, n]) => n > 0).map(([k, n]) => `${plain(k)} ${n}`).join(", ") || "none"}; light ${p.torch}`)
  return out.join("\n")
}

if (import.meta.main) {
  const c = current()
  if (!c.file) { console.log("No page yet: the party has not left the Hamlet since the chronicle began."); process.exit(0) }
  const p = (await Bun.file(c.file).json()) as Snap
  const raw = await Bun.file(c.file.replace(/\.json$/, ".raw.json")).json().catch(() => undefined)
  console.log(await nowText(p, raw, c.page!, statSync(c.file).mtimeMs))
}
