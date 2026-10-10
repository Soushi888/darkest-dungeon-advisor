// Copies the profile into .dd-runtime/, decodes every persist file with the name table, and returns
// one object keyed by file ("roster", "estate", ...). The original profile is only ever read (ISA A1).
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { decode, type Dson } from "./dson.ts"
import { names } from "./names.ts"
import { profileDir, runtime } from "./paths.ts"

export type Save = Record<string, Dson>

export async function readSave(profile = profileDir()): Promise<Save> {
  const copy = join(runtime, "profile")
  rmSync(copy, { recursive: true, force: true })
  mkdirSync(copy, { recursive: true })
  for (const f of readdirSync(profile)) if (f.startsWith("persist.")) cpSync(join(profile, f), join(copy, f))
  const table = await names()
  const save: Save = {}
  for (const f of readdirSync(copy)) {
    const key = f.replace(/^persist\./, "").replace(/\.json$/, "")
    const doc = decode(new Uint8Array(await Bun.file(join(copy, f)).arrayBuffer()), { names: table })
    save[key] = (doc.base_root as Dson) ?? doc
  }
  return save
}

if (import.meta.main) {
  const save = await readSave()
  const out = join(import.meta.dir, "..", "data", "state.json")
  await Bun.write(out, JSON.stringify(save, null, 1))
  console.log(`${out}: ${Object.keys(save).length} files decoded`)
}
