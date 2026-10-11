// The Caretaker's recap (C66): built from the page itself, so no number in it is typed by hand. `bun run say --recap --page N
// --advice "..." [--since "..."]` stores it on the line, and the road zone shows the latest one as its report (Soushi,
// 2026-10-11 05:03 and 05:05: "make it prettier", "the chatbox UI is not clean for that kind of report").
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import type { Snap } from "./chronicle.ts"
import { whereLine } from "./map.ts"
import { install } from "./paths.ts"
import { plain } from "./words.ts"

export interface Recap {
  page: string; savedAt: string
  tally: { rooms: number; battles: number; lost: number }
  where: string
  four: { rank: number; name: string; hp: number; maxHp: number; stress: number; tags: string[] }[]
  packs: { light: number; items: { key: string; label: string; n: number; icon?: string; kind: "provision" | "loot" }[] }
  since?: string; advice: string
}

// what the party carries to live on the road; anything else they carry home is loot
const PROVISIONS = ["food", "torch", "bandage", "antivenom", "shovel", "medicinal_herbs", "skeleton_key", "holy_water", "laudanum", "dog_treats", "firewood"]
const GEMS = ["citrine", "emerald", "jade", "onyx", "ruby", "sapphire", "ancient_idol", "antiqrelic", "antiqrelicsmall", "pewrelic", "trapezohedron"]
const HEIRLOOMS = ["crest", "bust", "deed", "portrait"]

/** The install's own icon for a carried item, copied beside the page like the portraits (A4); undefined when it has none. */
export function itemIcon(key: string, out: string): string | undefined {
  const base = "panels/icons_equip/"
  const tries = key === "food" ? ["provision/inv_provision+_0.png"] : key === "gold" ? ["gold/inv_gold+_0.png"]
    : HEIRLOOMS.includes(key) ? [`heirloom/inv_heirloom+${key}.png`] : GEMS.includes(key) ? [`gem/inv_gem+${key}.png`]
    : /^journal[ _]page/.test(key) ? ["journal_page/inv_journal_page.png"]
    : [`supply/inv_supply+${key}.png`, `trinket/inv_trinket+${key}.png`, `quest_item/inv_quest_item+${key}.png`]
  const src = tries.map((t) => base + t).find((t) => existsSync(join(install, t)))
  if (!src) return undefined
  const rel = `img/items/${key.replace(/[^\w-]+/g, "_")}.png`
  mkdirSync(join(out, "img", "items"), { recursive: true })
  if (!existsSync(join(out, rel))) copyFileSync(join(install, src), join(out, rel))
  return rel
}

// the light's own supplies first, food then torches, then the rest of the provisions, then the loot
const order = (x: { key: string; kind: string }) => (x.kind === "loot" ? 3 : x.key === "food" ? 0 : x.key === "torch" ? 1 : 2)

/** The recap of one page: the tally of the road, where they stand, the four, the packs, and the Caretaker's own words. */
export function buildRecap(p: Snap, raw: any, page: string, savedAt: number, words: { advice: string; since?: string }, out: string): Recap {
  const start = Number(raw?.raid?.party?.start_heroes_size ?? p.heroes.length)
  const items = Object.entries(p.supplies).filter(([, n]) => n > 0).map(([key, n]) => ({
    key, label: plain(key), n, icon: itemIcon(key, out), kind: (PROVISIONS.includes(key) ? "provision" : "loot") as "provision" | "loot",
  })).sort((a, b) => order(a) - order(b))
  return {
    page, savedAt: new Date(savedAt).toISOString(),
    tally: { rooms: p.tally.ROOM_VISITED ?? 0, battles: p.tally.BATTLE_COMPLETED ?? 0, lost: Math.max(0, start - p.heroes.length) },
    where: whereLine(p.map),
    four: p.heroes.map((h, i) => ({ rank: i + 1, name: h.name, hp: Math.round(h.hp), maxHp: h.maxHp, stress: h.stress,
      tags: [h.affliction, h.virtue, h.deathsDoor ? "Death's Door" : "", h.stunned ? "stunned" : ""].filter(Boolean) as string[] })),
    packs: { light: p.torch, items },
    ...(words.since ? { since: words.since } : {}), advice: words.advice,
  }
}
