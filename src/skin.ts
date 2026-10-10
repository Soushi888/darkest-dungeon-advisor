// Builds the board theme: skin/darkest.css with every {{font:...}} and {{art:...}} replaced by a data URI.
// Fonts come from skin/fonts (SIL OFL 1.1); art is read from the game install at build time and lands
// only in .local/, which is never committed (ISA A4).
import { existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
export const install = process.env.DD_INSTALL ?? join(homedir(), ".steam/steam/steamapps/common/DarkestDungeon")

// Each name the skin uses, and the file under the install it is drawn from.
const ART: Record<string, string> = {
  vista: "campaign/town/quest_select/quest_select.background.png",
  splat: "campaign/town/buildings/blg_name_background.png",
  reaper: "panels/side_decor.png",
  choice: "panels/quest_complete_choice_shared_frame.png",
}

const dataUri = async (path: string, type: string) =>
  `data:${type};base64,${Buffer.from(await Bun.file(path).arrayBuffer()).toString("base64")}`

export async function buildSkin(out = join(root, ".local/state/theme.css")): Promise<string> {
  if (!existsSync(install)) throw new Error(`Darkest Dungeon install not found at ${install} (set DD_INSTALL)`)
  let css = await Bun.file(join(root, "skin/darkest.css")).text()
  for (const [token, name] of css.matchAll(/\{\{font:([^}]+)\}\}/g).map((m) => [m[0], m[1]!] as const).toArray()) {
    css = css.replaceAll(token, await dataUri(join(root, "skin/fonts", name), "font/woff2"))
  }
  for (const [token, name] of css.matchAll(/\{\{art:([^}]+)\}\}/g).map((m) => [m[0], m[1]!] as const).toArray()) {
    const rel = ART[name]
    if (!rel) throw new Error(`skin/darkest.css asks for unknown art "${name}"`)
    css = css.replaceAll(token, await dataUri(join(install, rel), "image/png"))
  }
  mkdirSync(dirname(out), { recursive: true })
  await Bun.write(out, css)
  return out
}

if (import.meta.main) {
  const out = await buildSkin(process.argv[2])
  console.log(`${out} (${Math.round(Bun.file(out).size / 1024)} KB)`)
}
