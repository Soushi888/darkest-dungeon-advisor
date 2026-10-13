// Read-only decoder for Darkest Dungeon's DSON save format.
// Ported from robojumper's DarkestDungeonSaveEditor (MIT), docs/dson.md and file/DsonField.java:
// the header, the two meta blocks, and the type heuristic with its hard-coded field paths.

export type Dson = { [key: string]: DsonValue }
export type DsonValue = boolean | number | string | DsonValue[] | Dson

const MAGIC = 0x0000b101

/** The game's string hash: h = h*53 + byte, as a 32-bit signed integer. */
export function stringHash(s: string): number {
  let h = 0
  for (const b of new TextEncoder().encode(s)) h = (Math.imul(h, 53) + b) | 0
  return h
}

// Field paths whose type the size heuristic cannot tell; innermost name last, "*" matches any name.
const FLOAT = [["current_hp"], ["m_Stress"], ["actor", "buff_group", "*", "amount"], ["chapters", "*", "*", "percent"], ["non_rolled_additional_chances", "*", "chance"]]
const INT_VECTOR = [
  ["read_page_indexes"], ["raid_read_page_indexes"], ["raid_unread_page_indexes"], ["dungeons_unlocked"], ["played_video_list"],
  ["trinket_retention_ids"], ["last_party_guids"], ["dungeon_history"], ["buff_group_guids"], ["result_event_history"],
  ["dead_hero_entries"], ["additional_mash_disabled_infestation_monster_class_ids"], ["mash", "valid_additional_mash_entry_indexes"],
  ["party", "heroes"], ["skill_cooldown_keys"], ["skill_cooldown_values"], ["bufferedSpawningSlotsAvailable"],
  ["curioGroups", "*", "curios"], ["curioGroups", "*", "curio_table_entries"], ["raid_finish_quirk_monster_class_ids"],
  ["narration_audio_event_queue_tags"], ["dispatched_events"], ["backer_heroes", "*", "combat_skills"],
  ["backer_heroes", "*", "camping_skills"], ["backer_heroes", "*", "quirks"],
]
const STRING_VECTOR = [["goal_ids"], ["roaming_dungeon_2_ids", "*", "s"], ["quirk_group"], ["backgroundNames"], ["backgroundGroups", "*", "backgrounds"], ["backgroundGroups", "*", "background_table_entries"]]
const FLOAT_ARRAY = [["map", "bounds"], ["areas", "*", "bounds"], ["areas", "*", "tiles", "*", "mappos"], ["areas", "*", "tiles", "*", "sidepos"]]
const TWO_INT = [["killRange"]]

/** path is outermost first, ending with the field's own name. */
function isA(table: string[][], path: string[]): boolean {
  return table.some((pat) => {
    if (pat.length > path.length) return false
    for (let j = 0; j < pat.length; j++) {
      const name = path[path.length - pat.length + j]
      if (pat[j] !== "*" && pat[j] !== name) return false
    }
    return true
  })
}

const utf8 = new TextDecoder("utf-8", { fatal: false })

export interface DecodeOptions {
  /** hash -> name, applied to int fields and int vectors */
  names?: Map<number, string>
}

export function decode(buf: Uint8Array, opts: DecodeOptions = {}): Dson {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (dv.getUint32(0, true) !== MAGIC) throw new Error("not a DSON file (bad magic number)")
  const numMeta1 = dv.getInt32(20, true)
  const meta1Offset = dv.getInt32(24, true)
  const numMeta2 = dv.getInt32(44, true)
  const meta2Offset = dv.getInt32(48, true)
  const dataLength = dv.getInt32(56, true)
  const dataOffset = dv.getInt32(60, true)

  const meta1 = Array.from({ length: numMeta1 }, (_, i) => {
    const o = meta1Offset + i * 16
    return { parent: dv.getInt32(o, true), direct: dv.getInt32(o + 8, true) }
  })
  const meta2 = Array.from({ length: numMeta2 }, (_, i) => {
    const o = meta2Offset + i * 12
    const info = dv.getInt32(o + 8, true)
    return { hash: dv.getInt32(o, true), offset: dv.getInt32(o + 4, true), isObject: (info & 1) === 1, nameLen: (info >> 2) & 0x1ff, meta1: (info >> 11) & 0xfffff }
  })
  const data = buf.subarray(dataOffset, dataOffset + dataLength)
  const ddv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const offsets = [...new Set(meta2.map((m) => m.offset))].sort((a, b) => a - b)
  const nextOffset = (off: number) => {
    let lo = 0, hi = offsets.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (offsets[mid]! <= off) lo = mid + 1; else hi = mid }
    return lo < offsets.length ? offsets[lo]! : data.length
  }
  // Hashes of names three letters or longer are far beyond any count or price the save holds, so small
  // integers stay numbers: unhashing every int turned a 4500 gold reward into the name "Se".
  const unhash = (n: number): number | string => (Math.abs(n) >= 100_000 && opts.names?.get(n)) || n

  type Frame = { obj: Dson; left: number; name: string }
  const stack: Frame[] = []
  let root: Dson | undefined

  for (const m of meta2) {
    const name = utf8.decode(data.subarray(m.offset, m.offset + m.nameLen - 1))
    if (stringHash(name) !== m.hash) throw new Error(`field at ${m.offset}: name hash mismatch for "${name}"`)
    const start = m.offset + m.nameLen
    const raw = data.subarray(start, nextOffset(m.offset))
    let value: DsonValue

    if (m.isObject) {
      value = {}
    } else {
      const path = [...stack.map((f) => f.name), name]
      value = parseField(raw, start, path, ddv, unhash, opts)
    }

    if (stack.length === 0) {
      if (!m.isObject) throw new Error("no top-level object")
      root = value as Dson
    } else {
      const top = stack[stack.length - 1]!
      // duplicate fields inside one object exist in some files; the first one wins
      if (!(name in top.obj)) top.obj[name] = value
      top.left--
    }
    if (m.isObject) stack.push({ obj: value as Dson, left: meta1[m.meta1]!.direct, name })
    while (stack.length && stack[stack.length - 1]!.left === 0) stack.pop()
  }
  if (stack.length) throw new Error("fields missing: an object did not receive all its children")
  return root ?? {}
}

function parseField(raw: Uint8Array, start: number, path: string[], ddv: DataView, unhash: (n: number) => number | string, opts: DecodeOptions): DsonValue {
  const skip = (4 - (start % 4)) % 4
  const size = raw.length - skip
  const at = start + skip
  const i32 = (k: number) => ddv.getInt32(at + k, true)

  if (isA(FLOAT_ARRAY, path)) return Array.from({ length: Math.floor(size / 4) }, (_, k) => ddv.getFloat32(at + k * 4, true))
  if (isA(INT_VECTOR, path) && size >= 4) {
    const n = i32(0)
    if (size === (n + 1) * 4) return Array.from({ length: n }, (_, k) => unhash(i32(4 + k * 4)))
  }
  if (isA(STRING_VECTOR, path) && size >= 4) {
    const n = i32(0)
    const out: string[] = []
    let p = 4
    for (let k = 0; k < n; k++) {
      const len = i32(p)
      out.push(utf8.decode(raw.subarray(skip + p + 4, skip + p + 4 + len - 1)))
      p += 4 + len
      if (k < n - 1) p += (4 - ((at + p) % 4)) % 4
    }
    return out
  }
  if (isA(FLOAT, path) && size === 4) return ddv.getFloat32(at, true)
  if (isA(TWO_INT, path) && size === 8) return [i32(0), i32(4)]

  if (raw.length === 1) return raw[0]! >= 0x20 && raw[0]! <= 0x7e ? String.fromCharCode(raw[0]!) : raw[0] !== 0
  if (size === 8 && (raw[skip] === 0 || raw[skip] === 1) && (raw[skip + 4] === 0 || raw[skip + 4] === 1)) return [raw[skip] === 1, raw[skip + 4] === 1]
  if (size === 4) return unhash(i32(0))
  if (size >= 5) {
    const len = i32(0)
    if (size === 4 + len) {
      const body = raw.subarray(skip + 4, skip + 4 + len)
      // an embedded save file travels as a string
      if (len >= 4 && new DataView(body.buffer, body.byteOffset, 4).getUint32(0, true) === MAGIC) return decode(body, opts)
      return utf8.decode(body.subarray(0, len - 1))
    }
  }
  throw new Error(`cannot type field ${path.join(".")} (${raw.length} bytes)`)
}
