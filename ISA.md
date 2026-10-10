---
name: darkest-dungeon-advisor
principal_stated_goal: "J'aimerais qu'on étudie l'idée de faire un projet darkest-dungeon-advisor, comme on a fait pour factorio. C'est un jeu asser complexe et de l'aide stratégique entre deux quêtes serait utile!"
phase: climbing
progress: 17/20 claims, 4/4 anti-claims (counted by checkbox grep, never typed)
frozen: false
---

# Darkest Dungeon Advisor

## Goal

The town advisor: a read-only toolkit that lets SoushAI advise Soushi on his Darkest Dungeon (DD1, base game) playthrough each time his party returns to the Hamlet, speaking only from what he has already seen, and handing its advice over as a niceboard.

Run goal of 2026-10-10 (Soushi, `/goal`): "travail dessus jusqu'à ce qu'on soit prêt à lancer le jeu et le continuer basé sur les conseils du town advisor. Aussi, c'est ok que le town advisor pose des questions et qu'on ai une forme d'interactivité via le board avec pour bien définir la suite."

## Vision

Soushi comes back from an expedition, saves, and opens the town board. A villager he recognises from the Hamlet tells him who needs the Sanitarium and who the Tavern, which building his heirlooms should go to, and which party and provisions fit the expedition he is weighing, and every sentence names where in his own save it comes from. Nothing on the page spoils a dungeon he has not entered or an enemy he has not met. When the experimental foresight is switched on, the villager occasionally adds what their own network heard, marked as such and never mistaken for what he lived. Every call he has to make is a card he clicks, and his answers go back to the Caretaker from the page itself.

## Out of Scope

- Advice inside a dungeon, for now. Once the party leaves the Hamlet, Soushi is on his own (Soushi, 2026-10-10); a later opt-in in-dungeon call is under Not yet specified.
- Writing to a save, a game file, or the Steam cloud directory. Saves are read from a copy.
- Darkest Dungeon II and the DLCs (The Crimson Court, The Color of Madness, The Shieldbreaker): the install carries the base game only (15 hero classes, no `dlc/` directory, read 2026-10-10).
- Copying wiki text into the repository. The wiki ([darkestdungeon.wiki.gg](https://darkestdungeon.wiki.gg/)) is CC BY-NC-SA 4.0 and player-maintained; it is a reference for understanding, never a source for a figure.
- Curio advice without foresight: the save records no curio knowledge, so the curio table (`curios/curio_type_library.csv`) would reveal interactions he has not discovered.

## Claims

- [x] **C1: The game's data is readable as text.** Hero, monster, trinket and curio definitions are plain files under the install. *Evidence: `heroes/crusader/crusader.info.darkest`, `trinkets/*.json`, `curios/*.csv`, 101 entries under `monsters/`, read 2026-10-10.*
- [x] **C2: The save is a known binary format.** Every `persist.*.json` opens with `01 b1 00 00`, the DSON format documented by robojumper's editor (`docs/dson.md`, MIT). *Evidence: hexdump, 2026-10-10.*
- [x] **C3: The save decodes to JSON in TypeScript, from a copy.** `src/dson.ts` (ported from robojumper's spec and type heuristic) decodes all 14 `persist.*.json` files of a copy in `.dd-runtime/profile/`; `bun run read` writes `data/state.json`. *Evidence: test "C3: every persist file decodes"; the decoder checks every field name against its stored hash and every object's child count, and throws on any mismatch. Not yet diffed against robojumper's jar output, which remains a stronger probe.*
- [x] **C4: Hashed strings resolve from a name table built from the game's own data.** `src/names.ts` hashes every identifier in the install's data plus every `<class>.<skill>` pair; integers under 100 000 are never unhashed (a 4500 gold reward once decoded as "Se"). *Evidence: test "C4": zero numeric upgrade tree ids, every hero class a string.*
- [x] **C5: The knowledge boundary is computed from the save.** A monster is known when it lives in a dungeon level the campaign log records as walked (`dungeon_type` and `difficulty` of every expedition in `persist.campaign_log.json`) and one of its attacks is in `persist.game_knowledge.json` (37 witnessed on 2026-10-10). Attack ids are shared across tiers (Bone Soldier and Bone Veteran both strike with `sword_strike`), so the walked level, not the attack alone, tells them apart. A dungeon never walked gets no foe named. *Evidence: the Warrens quest reads "you have never walked it; I will not speak of what lives there"; test "C6, A3" checks every known variant lives in a walked level's mash.*
- [x] **C6: Nothing unseen reaches the page without the foresight flag.** *Evidence: test "C6, A3": every monster of every dungeon level whose attacks are all unwitnessed is searched in the built board, known names removed first ("Sea Maggot" contains "Maggot"); zero hits.*
- [x] **C7: Foresight is opt-in, experimental, and marked.** `--foresight` adds one "Foresight:" line, on the expedition being prepared only, naming the kinds (eldritch, man, beast...) of the foes there you have not met, never a monster. *Evidence: `town --foresight` printed one line, on the Cove option: "Foresight: travellers speak of eldritch things there that you have not met."; without the flag no such line.*
- [x] **C8: A save made in a dungeon is detected and refused in character.** `persist.game.json` field `inraid`. *Evidence: test "C8": a copy with `inraid` set prints "You are not back yet" and writes no board.*
- [x] **C9: Roster triage is derived.** Stress, affliction and quirks from `persist.roster.json`; activity cost, relief, affliction cure chance and free slots from `campaign/town/buildings/<b>/<b>.building.json` at the purchased upgrade level; refusals from each activity's `not_have_quirks`. *Evidence: Reynauld (God Fearing) is offered only the Transept, which is full, and the board says so.*
- [x] **C10: Estate advice prices upgrades from the game's own costs.** *Evidence: Medical Ward 750 gold, the file's base `disease_quirk_cost_upgrades` entry; building upgrades priced in heirlooms from `upgrades/building/*.upgrades.json` and offered only when the estate's wallet covers them.*
- [x] **C11: Expedition preparation is grounded.** Each seat's skills are the hero's equipped ones whose `.launch` includes that rank in the class file; a seat needs two. Provisions: bandages and antivenom only when a witnessed attack in that dungeon bleeds or blights; counts are labelled RULE. *Evidence: the Cove party seats Leper and Man-at-Arms in ranks 1 and 2, Plague Doctor and Occultist in 3 and 4, each skill listed per rank.*
- [x] **C12: The town board is a niceboard, and it talks back.** `bun run town` writes `.local/town/town.md` and compiles it with the Niceboard compiler and the skin; `bun run watch` serves it with a "Send to the Caretaker" button that posts the reader's answers to `/answers`, which rebuilds the board around the picked expedition and a party named in the card's note. *Evidence: Chrome session 2026-10-10: Ruins picked and "Ligonier, Poussin, Vieuxpont, Azor" noted, sent, the page reloaded with "Your party for the Ruins: go as named?" and the four seated; error strip empty, 15 cards, no sideways scroll.*
- [x] **C13: The advisor is a villager, and the board stays in the fiction.** The board speaks as the Caretaker, in English, first person, in the Hamlet's own words: no save, file, field, upgrade code or tool is named on it (Soushi, 2026-10-10: "roleplay, not talking about save game"). His own thresholds read "my habit"; upgrade trees are named in plain words ("Nomad Wagon: more wares"). *Evidence: test "C13" (no meta vocabulary in what a reader sees).*
- [x] **C14: Every figure carries its source, off the board.** `.local/town/sources.md`, written beside the board on every build, lists every number on the board beside the save field or game file it was read from; numbers labelled "my habit" are RULE values and are excluded. Moved off the board on 2026-10-10 so the board stays in the fiction (C13). *Evidence: test "C13" reads `persist.estate.json` in sources.md.*
- [ ] **C15: Every board looks like an in-game panel, not a brainstorm.** The skin dresses the compiler with the game's own art and type. Open: the town board's layout is still the compiler's zones; Soushi wants the final board laid out for the game (2026-10-10). Phone width checked 2026-10-10: in a 390px frame the page is 378px wide, 16px gutter, no element past the edge. *Falsifier: a Board.css hand-drawn trait in a pixel capture; a layout Soushi calls brainstorm-like.*
- [x] **C16: The board follows the Hamlet live and waits during expeditions.** *Evidence: test "C16": on a profile copy, a town save raises `/version` by one, a save with `inraid` set leaves it, the return raises it again.*
- [x] **C17: Roster management is advised, from the roster and the game's own upgrade trees.** Dismissal cards (RULE: level 0, outside the party, three or more bad quirks), recruit cards for the Stage Coach's current offer, the party's next Guild tiers with the Guild discount (10% per bought `guild.cost` code, summed), Blacksmith tiers shown as waiting on `blacksmith.weapon a` and `blacksmith.armour a`, estate trinkets to party members by class. *Evidence: Battlefield Medicine tier 2 shown at 225 gold, the file's 250 less 10%; roster 14 of 16 from `stage_coach.rostersize` b.*
- [ ] **C18: Picks are checked against what the save shows.** The board never acts in the game (A1), so every pick is carried out by hand; each pick sent this week is kept in `.local/town/picks.json` (merged across sends, cleared when the week turns) and the next Hamlet save shows a "Did you do what you chose?" zone: one sticky per pick the save can confirm, Done, Not yet, or Not as chosen. Covered: relief (`roster` heroes against the buildings' activity slots), the Medical Ward, dismissals and recruits (the roster), Guild and Blacksmith tiers (`persist.upgrades.json`), heirloom upgrades (the bought code). Not checkable: "Keep the gold" and "Save them". Stickies, never cards, so the expedition cards keep numbers 1 and 2. *Evidence: tests "C18" (statuses from the real save, merge, new week; `/answers` round trip to the zone). Open: the zone not yet viewed in Chrome (deferred while Soushi was in game, 2026-10-10).* *Falsifier: a pick carried out in game still reads Not yet after the next Hamlet save; a contrary move reads Done.*
- [ ] **C19: The expedition and party picks are checked on setting out.** (after: C18) The save made on leaving the Hamlet records the dungeon (`persist.game.json` `raiddungeon`) and, in a file not yet read, the party. Open: no raid save decoded yet; a capture of the first one is taken while Soushi plays (2026-10-10). *Falsifier: a party that left in another order or with another hero than picked reads as matching.*
- [x] **C20: This week's town event is read and folded into the advice.** `persist.town_event.json` `current_result_event_id` counts only when the week's own chapter of `persist.campaign_log.json` records it; its title and text come from the game's string table and open the board as "This week in the Hamlet". Bonus recruits (`bonus_hero_entries`) get recruit cards beside the coach's offer; closed activities leave the relief options; cost changes and free activities change the prices shown; provision changes appear on the road; other effects are listed in the game's own effect lines. Out-of-week events are ignored. *Evidence: test "C20" (Herbard the Vestal from Holy Gathering offered; a Tavern Troubles week shuts the Bar, halves the Gambling Hall, and drops the Bar from relief).*

## Anti-claims

- [x] **A1: The advisor never writes to the game's directories or the Steam cloud folder.** *Evidence: test "A1": profile mtimes identical before and after `bun run town`; all tests write to `.dd-runtime/test-profile`.*
- [x] **A2: No figure from memory or from the wiki.** Every game figure is read from a file; the advisor's own thresholds (rest at 45 stress, send under 45, food and torches by length) are labelled "my habit" on the board and named RULE in the code. *Evidence: `RULE` in `src/advise.ts` and `RULE_FOOD` in `src/board.ts`, each printed with its label.*
- [x] **A3: No spoiler leaks through a default.** *Evidence: test "C6, A3".*
- [x] **A4: No game art or wiki text committed.** *Evidence: `git ls-files` lists no image; portraits are copied from the install into `.local/town/img/` at build time.*

## Decisions

- 2026-10-10, Soushi: name `darkest-dungeon-advisor`; it is the town advisor, active only in the Hamlet.
- 2026-10-10, Soushi: spoilers are handled inside the lore. Default is what the player knows; foresight from the advisor's own network is optional and experimental.
- 2026-10-10, Soushi: the advisor is a village character: **the Caretaker** (kickoff board, card 1).
- 2026-10-10, Soushi: the Caretaker speaks **English**, matching the game screen (card 2).
- 2026-10-10, Soushi: foresight is **always true, vague first**; never a wrong hint (card 3).
- 2026-10-10, Soushi: a save made in a dungeon is **refused, in character** (card 4). His note: a later "in-dungeon call" feature, to ask the advisor mid-expedition.
- 2026-10-10, Soushi: the save is decoded by **our own TypeScript reader** (card 5).
- 2026-10-10, Soushi: the save folder is **watched** (card 6). His note, clarified: the board stays live through every town save and does not reload during an expedition (C16).
- 2026-10-10, Soushi: the repository is **public** on GitHub (card 7).
- 2026-10-10, Soushi: the advisor takes the week's town event into account, its recruits first (C20).
- 2026-10-10, Soushi: the main board stays in sync with the latest work: changes land on `main` and the live watcher is restarted.
- 2026-10-10, Soushi: the board's tone is roleplay; nothing on it talks about the save or the tooling (C13), and the sources table moves to `sources.md` (C14).
- 2026-10-10, Soushi: board picks never act in the game; a mismatch between pick and play is caught by reading the next save (C18, C19).
- 2026-10-10, Soushi: niceboards from day one; the advisor may ask questions and the board is interactive.
- Sibling of `factorio-advisor` and `wesnoth-advisor`. Unlike Factorio, no engine run is needed: the game data is text and the save decodes directly.
- 2026-10-10, independent review (fresh-context agent, read-only), five findings and four smaller ones, all adopted: (1) tier spoiler through shared attack ids, fixed by the walked-level rule in C5; (2) quirk matching by substring ("man" in Photomania), fixed by whole-word matching; (3) answers drifting between cards, fixed by putting the two expedition cards first so their numbers never move, keeping the party card's title stable, and accepting a party note only when it names four heroes on the roster; (4) the Medical Ward offered to more heroes than it has beds, fixed by giving free beds by experience; (5) the watcher dropping a save that arrived mid-build and racing with `/answers`, fixed by one serialized rebuild with a single queued rerun. Smaller: busy heroes are no longer offered for dismissal, bleed and blight lines no longer claim where they happened, weapon and armour tiers are labelled from level 2 and priced at the Blacksmith, unmet foes are counted as distinct kinds from hall and room lines only.
- Roster status codes 1 and 3 in `roster.status` are not interpreted: only 2 (in a building) is confirmed, by matching the town's activity slots. The advisor reads occupancy from the slots, never from the code.

## Not yet specified

- C15's calls are on a board waiting for Soushi: `.local/brainstorms/town-board-layout-brainstorm-2026-10-10.html` (which in-game screen to echo, a roster column, compiler extension or project template), to answer after a few returns with the current board.
- The town board's own layout, beyond the skin: which in-game screens it echoes (the roster column, the building panels, the estate map) and whether that needs a Niceboard compiler extension or a template of its own.
- The in-dungeon call (Soushi's note on card 4): a later, opt-in way to ask the Caretaker mid-expedition. It reverses the current Out of Scope line, so it needs its own design pass, including how it treats the knowledge boundary.
- Which negative quirks are worth the Sanitarium's gold: the board offers rest and disease treatment, not quirk treatment, until there is a grounded way to rank quirks.

## Test Strategy

| Claim | Probe |
|---|---|
| C3, C4 | `bun test`: decode every persist file; no numeric tree id or class after unhashing |
| C6, A3 | `bun test`: every never-witnessed monster name searched in the built board, known names removed first |
| C8, C16 | `bun test`: `inraid` flipped in a profile copy; the CLI refuses, the watcher's `/version` holds |
| A1 | `bun test`: profile mtimes before and after a build |
| C12 | Chrome through Interceptor: answers sent from the page come back as a rebuilt board |
| C18 | `bun test`: statuses on the real save, merge and week reset, `/answers` to the zone; Chrome view of the zone |
| C20 | `bun test`: the save's event and bonus recruits; a substituted event's locks and prices |
| C19 | a raid save copy: dungeon and party read and compared to the picks |

## Progress
- a238076 The Caretaker checks each pick against the next Hamlet save: done, not yet, or not as chosen
- 282f630 The board stays in the fiction: the Caretaker never names a save, a file or a code; the sources move to sources.md
