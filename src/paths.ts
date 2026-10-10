// Where the game and the save live. Both are read, never written (ISA A1).
import { existsSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export const install = process.env.DD_INSTALL ?? join(homedir(), ".steam/steam/steamapps/common/DarkestDungeon")

/** The profile directory holding persist.*.json: DD_PROFILE, else the first Steam user with profile_0. */
export function profileDir(): string {
  if (process.env.DD_PROFILE) return process.env.DD_PROFILE
  const userdata = join(homedir(), ".steam/steam/userdata")
  for (const user of existsSync(userdata) ? readdirSync(userdata) : []) {
    const p = join(userdata, user, "262060/remote/profile_0")
    if (existsSync(join(p, "persist.game.json"))) return p
  }
  throw new Error("no Darkest Dungeon profile found; set DD_PROFILE to the folder holding persist.game.json")
}

export const root = join(import.meta.dir, "..")
export const runtime = join(root, ".dd-runtime")
