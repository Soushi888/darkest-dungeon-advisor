// C113: the expeditions' knowledge graph from the shell. `build` derives it again from every trip the chronicle kept (and the
// campaign log, read from a copy of the save when a profile is found); the rest read it. Writes only <outDir()>/graph.db and,
// for `export`, the file it is given (ISA A1).
import { build, companions, encounterDossier, exportGraph, foeGroups, foesNamed, foeThreat, graphFile, heroesNamed, heroRecord, open, partyOutcomes, specialFoes, stats, supplyUse } from "./memory/graph.ts"
import { readSave } from "./sources/read.ts"

const [cmd = "stats", ...args] = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith("--")))
const rest = args.filter((a) => !a.startsWith("--"))
const show = (v: unknown) => console.log(JSON.stringify(v, null, 1))
const counts = (s: { nodes: Record<string, number>; edges: Record<string, number> }) => {
  console.log(`nodes: ${Object.values(s.nodes).reduce((a, b) => a + b, 0)}`)
  for (const [k, n] of Object.entries(s.nodes)) console.log(`  ${k} ${n}`)
  console.log(`edges: ${Object.values(s.edges).reduce((a, b) => a + b, 0)}`)
  for (const [k, n] of Object.entries(s.edges)) console.log(`  ${k} ${n}`)
}

if (cmd === "build") {
  let campaignLog: unknown
  if (!flags.has("--no-log")) try { campaignLog = (await readSave()).campaign_log } catch (e) { console.log(`no campaign log (${(e as Error).message}): weeks, outcomes and the fallen are left out`) }
  const r = await build({ campaignLog })
  console.log(r.file)
  counts(r)
} else {
  const db = open()
  const name = rest.join(" ")
  if (cmd === "stats") { console.log(graphFile()); counts(stats(db)) }
  else if (cmd === "foe") {
    const fs = foesNamed(db, name)
    if (!fs.length) { console.log(`no foe named ${name} in the graph`); process.exit(1) }
    for (const f of fs) show({ foe: f.id, name: f.name, threat: foeThreat(db, null, null, f.id), beside: companions(db, f.id)?.beside, meetings: encounterDossier(db, f.id)?.meetings.length ? encounterDossier(db, f.id) : undefined })
  } else if (cmd === "hero") {
    const hs = heroesNamed(db, name)
    if (!hs.length) { console.log(`no hero named ${name} in the graph`); process.exit(1) }
    for (const h of hs) show(heroRecord(db, Number(h.id.split(":")[1])))
  } else if (cmd === "dungeon") {
    const [d, lv] = rest, level = lv ? Number(lv) : null
    if (!d) { console.log("usage: bun run graph dungeon <id> [level]"); process.exit(1) }
    show({ foes: foeThreat(db, d, level), groups: foeGroups(db, d, level).mostSeen, parties: partyOutcomes(db, d), supplies: supplyUse(db, d), special: specialFoes(db, d) })
  } else if (cmd === "dossier") { show(encounterDossier(db, name) ?? `no foe named ${name} in the graph`) }
  else if (cmd === "groups") { const [d, lv] = rest; show(foeGroups(db, d ?? null, lv ? Number(lv) : null)) }
  else if (cmd === "export") {
    const text = JSON.stringify(exportGraph(db), null, 1) + "\n"
    if (rest[0]) { await Bun.write(rest[0], text); console.log(rest[0]) } else process.stdout.write(text)
  } else { console.log("usage: bun run graph build [--no-log] | stats | foe <name> | hero <name> | dungeon <id> [level] | dossier <foe> | groups [dungeon] [level] | export [file]"); process.exit(1) }
  db.close()
}
