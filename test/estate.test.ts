// C57: what the estate holds is shown as the Hamlet shows it, the game's own currency icons beside each count.
import { describe, expect, test } from "bun:test"
import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { estateIcons } from "../src/voice/board.ts"
import { root } from "../src/sources/paths.ts"

describe("C57: the estate's holdings with their icons", () => {
  test("the heirlooms' line and the coffers' tally carry each currency's icon beside its count, copied beside the page", () => {
    const was = process.env.DD_TOWN_OUT, out = join(root, ".dd-runtime", "test-estate")
    process.env.DD_TOWN_OUT = out
    rmSync(out, { recursive: true, force: true })
    const html = `<html><head></head><body><div class="tally"><div><div class="big">3576</div><div class="of">gold</div></div><div><div class="big">60</div><div class="of">crests</div></div></div>
<p><strong>What the estate holds.</strong> 3,576 gold, 60 crests, 2 busts, 15 portraits, 7 deeds.</p></body></html>`
    const got = estateIcons(html)
    process.env.DD_TOWN_OUT = was
    const row = got.match(/<p class="purse">.*?<\/p>/)?.[0] ?? ""
    for (const [k, n] of [["gold", "3,576"], ["crest", "60"], ["bust", "2"], ["portrait", "15"], ["deed", "7"]]) {
      expect(row).toContain(`src="img/currency.${k}.png"`)
      expect(row).toMatch(new RegExp(`currency\\.${k}\\.png"[^>]*><b>${n}</b>`))
      expect(existsSync(join(out, "img", `currency.${k}.png`))).toBe(true)
    }
    expect(got).toContain('<div class="big"><img class="coin" src="img/currency.crest.png" alt="crests" title="crests">60</div>')
    expect(got).toContain("<style>.purse")
    rmSync(out, { recursive: true, force: true })
  })
})
