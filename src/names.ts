// The name table: every identifier-like token in the game's own data, keyed by its DSON hash.
// The save stores hero classes, quirks, trinkets, skills and upgrade trees as hashes; this turns them back.
import { readdirSync, statSync } from "node:fs"
import { join, basename } from "node:path"
import { stringHash } from "./dson.ts"
import { install } from "./paths.ts"

const DIRS = ["heroes", "monsters", "trinkets", "campaign", "upgrades", "dungeons", "inventory", "raid", "curios", "loot", "shared", "scripts", "raid_results", "activity_log", "modes"]
const TEXT = /\.(darkest|json|csv|txt|xml)$/
const TOKEN = /[A-Za-z_][A-Za-z0-9_.+\-]{1,80}/g

function* files(dir: string): Generator<string> {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return }
  for (const e of entries) {
    const p = join(dir, e)
    const st = statSync(p)
    if (st.isDirectory()) yield* files(p)
    else yield p
  }
}

export async function buildNames(root = install): Promise<Map<number, string>> {
  const names = new Map<number, string>()
  const offer = (s: string) => { if (!names.has(stringHash(s))) names.set(stringHash(s), s) }
  for (const d of DIRS) {
    for (const f of files(join(root, d))) {
      const base = basename(f)
      offer(base.split(".")[0]!)
      if (!TEXT.test(f) || statSync(f).size > 4_000_000) continue
      const text = await Bun.file(f).text()
      for (const m of text.matchAll(TOKEN)) {
        offer(m[0])
        // "crusader.ability.one" style ids are also stored by their parts
        if (m[0].includes(".")) for (const part of m[0].split(".")) if (part.length > 1) offer(part)
      }
    }
  }
  // Upgrade trees are stored as "<class>.<skill>", a pair no single file spells out, camping skills included.
  const classes = readdirSync(join(root, "heroes"))
  const skills = new Set<string>()
  for (const c of classes) {
    const info = await Bun.file(join(root, "heroes", c, `${c}.info.darkest`)).text().catch(() => "")
    for (const m of info.matchAll(/\.id "([^"]+)"/g)) skills.add(m[1]!)
  }
  for (const f of files(join(root, "raid", "camping"))) {
    if (!f.endsWith(".json")) continue
    for (const m of (await Bun.file(f).text()).matchAll(/"id"\s*:\s*"([^"]+)"/g)) skills.add(m[1]!)
  }
  for (const c of classes) for (const k of skills) offer(`${c}.${k}`)
  return names
}

let cached: Map<number, string> | undefined
export async function names(): Promise<Map<number, string>> {
  if (cached) return cached
  const file = Bun.file(join(import.meta.dir, "..", "data", "names.json"))
  if (await file.exists()) {
    cached = new Map((await file.json() as [number, string][]))
  } else {
    cached = await buildNames()
    await Bun.write(file, JSON.stringify([...cached]))
  }
  return cached
}
