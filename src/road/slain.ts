// The foes slain in the fight under way (C80): the game drops a slain foe from the battle it keeps, so the fight is read back over
// the trip's pages since it began. Soushi, 2026-10-11 06:55, on the road zone's foes: "I still want to see the killed foes."
import { readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import type { Snap } from "./chronicle.ts"

export interface Slain { name: string; guid: number; slot: number; page: string; by?: string }

const corpse = (f: { name: string; cls?: string }) => /^corpse/i.test(f.cls ?? "") || f.name === "Corpse"

/** The foes slain between these pages of one fight, in the order they fell: each foe of a page that is gone from the next and
 *  was not a corpse, with its slot, the page it fell on, and the hero whose turn came on that page when only one did. */
export function slainIn(pages: { page: string; snap: Snap }[]): Slain[] {
  const out: Slain[] = []
  for (let i = 1; i < pages.length; i++) {
    const a = pages[i - 1]!.snap, b = pages[i]!.snap
    const now = new Set((b.battle?.foes ?? []).map((f) => f.guid))
    const acted = b.heroes.filter((h) => (h.turns ?? 0) > ((a.heroes.find((x) => x.guid === h.guid)?.turns) ?? 0)).map((h) => h.name)
    ;(a.battle?.foes ?? []).forEach((f, slot) => {
      if (f.guid === undefined || now.has(f.guid) || corpse(f)) return
      out.push({ name: f.name, guid: f.guid, slot: slot + 1, page: pages[i]!.page, ...(acted.length === 1 ? { by: acted[0] } : {}) })
    })
  }
  return out
}

/** The pages of the fight this page is in, read back from its trip until a page out of a fight or a round that runs backwards. */
export async function fightOf(file: string): Promise<{ page: string; snap: Snap }[]> {
  const dir = dirname(file), here = Number(file.match(/(\d+)\.json$/)?.[1] ?? 0)
  const nums = readdirSync(dir).map((f) => f.match(/^(\d+)\.json$/)?.[1]).filter((n): n is string => !!n && Number(n) <= here).sort()
  const out: { page: string; snap: Snap }[] = []
  for (let i = nums.length - 1; i >= 0; i--) {
    const snap = (await Bun.file(join(dir, `${nums[i]}.json`)).json().catch(() => undefined)) as Snap | undefined
    if (!snap?.battle) break
    if (out.length && snap.battle.round > out[0]!.snap.battle!.round) break
    out.unshift({ page: nums[i]!, snap })
  }
  return out
}

export const slainAt = async (file: string) => slainIn(await fightOf(file))

/** One line for the Caretaker and bun run now. */
export const slainLine = (s: Slain[]) => (s.length ? `SLAIN IN THIS FIGHT: ${s.map((x) => `${x.name}, was at slot ${x.slot}, fell on page ${x.page}${x.by ? ` to ${x.by}` : ""}`).join("; ")}` : "")
