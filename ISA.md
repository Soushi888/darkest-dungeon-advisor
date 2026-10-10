---
name: darkest-dungeon-advisor
principal_stated_goal: "J'aimerais qu'on étudie l'idée de faire un projet darkest-dungeon-advisor, comme on a fait pour factorio. C'est un jeu asser complexe et de l'aide stratégique entre deux quêtes serait utile!"
phase: climbing
progress: 2/17 claims, 0/4 anti-claims (counted by checkbox grep, never typed)
frozen: false
---

# Darkest Dungeon Advisor

## Goal

The town advisor: a read-only toolkit that lets SoushAI advise Soushi on his Darkest Dungeon (DD1, base game) playthrough each time his party returns to the Hamlet, speaking only from what he has already seen, and handing its advice over as a niceboard.

## Vision

Soushi comes back from an expedition, saves, and opens the town board. A villager he recognises from the Hamlet tells him who needs the Sanitarium and who the Tavern, which building his heirlooms should go to, and which party and provisions fit the expedition he is weighing, and every sentence names where in his own save it comes from. Nothing on the page spoils a dungeon he has not entered or an enemy he has not met. When the experimental foresight is switched on, the villager occasionally adds what their own network heard, marked as such and never mistaken for what he lived. Every call he has to make is a card he clicks.

## Out of Scope

- Advice inside a dungeon, for now. Once the party leaves the Hamlet, Soushi is on his own (Soushi, 2026-10-10); a later opt-in in-dungeon call is under Not yet specified.
- Writing to a save, a game file, or the Steam cloud directory. Saves are read from a copy.
- Darkest Dungeon II and the DLCs (The Crimson Court, The Color of Madness, The Shieldbreaker): the install carries the base game only (15 hero classes, no `dlc/` directory, read 2026-10-10).
- Copying wiki text into the repository. The wiki ([darkestdungeon.wiki.gg](https://darkestdungeon.wiki.gg/)) is CC BY-NC-SA 4.0 and player-maintained; it is a reference for understanding, never a source for a figure.

## Claims

- [x] **C1: The game's data is readable as text.** Hero, monster, trinket and curio definitions are plain files under the install. *Evidence: `heroes/crusader/crusader.info.darkest` read 2026-10-10 (resistances, five weapon tiers); `trinkets/*.json`; `curios/*.csv`; 101 entries under `monsters/`.*
- [x] **C2: The save is a known binary format.** Every `persist.*.json` under `userdata/<id>/262060/remote/profile_0/` opens with `01 b1 00 00`, the DSON format with hashed strings documented by robojumper's editor (`docs/dson.md`). *Evidence: hexdump of `roster`, `estate`, `game`, 2026-10-10.*
- [ ] **C3: The save decodes to JSON in TypeScript, from a copy.** `bun run read` copies `profile_0` into `.dd-runtime/`, decodes every `persist.*.json`, and writes `data/state/<profile>.json`. *Falsifier: a field robojumper's decoder reports that ours drops or mistypes, compared on the same file.*
- [ ] **C4: Hashed strings resolve from a name file built from the game's own data.** *Falsifier: an unresolved hash in the roster, estate or knowledge sections of a decoded save.*
- [ ] **C5: The knowledge boundary is computed from the save.** Witnessed knowledge is the set of enemy skills in `persist.game_knowledge.json`, dungeons in the campaign log and quest history, and what the Hamlet shows (quest board, stage coach, buildings). *Falsifier: a probe save in which a known skill is absent from the computed set, or an unseen one present.*
- [ ] **C6: Nothing unseen reaches the page without the foresight flag.** Every enemy, dungeon and curio named in the advice is a key in the witnessed set. *Falsifier: a grep of a built board for every monster and dungeon id outside the witnessed set returns a hit with foresight off.*
- [ ] **C7: Foresight is opt-in, experimental, and marked.** With `--foresight`, the villager may name what lies beyond the witnessed set, only for the expedition being prepared, vague first; every such line carries a foresight marker. *Falsifier: a foresight line without its marker, or one about a dungeon not on the prepared quest.*
- [ ] **C8: A save made in a dungeon is detected.** *Falsifier: a save taken mid-expedition read as a town state.*
- [ ] **C9: Roster triage is derived.** Stress, afflictions, quirks and diseases per hero, read from the roster, drive the Sanitarium, Tavern and Abbey recommendations, each citing the field it came from. *Falsifier: a recommendation whose cited field is absent from the decoded roster.*
- [ ] **C10: Estate advice prices upgrades from the game's own costs.** Heirloom balance from the estate, upgrade costs from `campaign/town/`. *Falsifier: a cost on the page that differs from the game file.*
- [ ] **C11: Expedition preparation is grounded.** Party by position against witnessed enemies of the chosen dungeon, provisions by length. *Falsifier: a party suggestion using a skill the hero's class file does not declare for that rank.*
- [ ] **C12: The town board is a niceboard.** Each return to the Hamlet produces one board (`Niceboard` compiler), themed for the project, with a card per call Soushi has to make, and its export comes back as a work order. *Falsifier: a call made in prose instead of a card; the board opened in a real browser shows a source fallback or an error strip.*
- [ ] **C15: Every board looks like an in-game panel, not a brainstorm.** The Niceboard compiler is dressed by `skin/darkest.css` through `bun run skin`: the game's own UI art (the quest-select vista, the building-name ink splash, the reaper side panel, the quest choice frame) read from the install at build time, IM Fell English (SIL OFL 1.1, `skin/fonts/`), gilt-ruled black panels, no tilted stickies, no hand-drawn diagrams, no sketch wall. Dark only, like the game. *Falsifier: a board build without the skin, or a Board.css hand-drawn trait visible in a pixel capture (tilt, wobbly border, Kalam or Caveat font).* The kickoff board is allowed to stay a brainstorm; the town board Soushi will use each return must go further than this skin and be laid out for the game, like a panel the game could have shipped (Soushi, 2026-10-10: "je veux que le final qu'on utilisera soit plus adapté au jeu"). Kickoff board reskinned 2026-10-10 on Soushi's call ("trop comme un brainstorm... un panneau complémentaire qui pourrait être in game"); pixel captures read at 1536px, phone width not yet checked.
- [ ] **C16: The board follows the Hamlet live and waits during expeditions.** Every save made in the Hamlet rebuilds the board, so it stays current as Soushi recruits, trains, upgrades and spends; a save made during an expedition leaves the panel as it was, and the Caretaker updates it on the return (Soushi, 2026-10-10, correcting my first reading). *Falsifier: a town save that does not rebuild the board, or an in-expedition save that does.*
- [ ] **C17: Roster management is advised, from the roster and the game's own upgrade trees** (Soushi, 2026-10-10). Who to dismiss and who to recruit from the Stage Coach (`campaign/town/buildings/stage_coach/stage_coach.building.json`, store `hero_recruit`); which hero to train at the Guild (skills) and which to upgrade at the Blacksmith (weapon and armour), priced from `upgrades/heroes/<class>.upgrades.json`, whose trees carry gold costs and building prerequisites (`abomination.weapon` requires `blacksmith.weapon`); which trinkets to equip on whom. Each card weighs the hero's level, quirks and role in the parties C11 suggests, and names the gold it costs against the estate's balance. *Falsifier: a dismissal or upgrade card whose cost differs from the upgrade file, or that names a level the Guild or Blacksmith tier does not yet allow.*
- [ ] **C13: The advisor is a villager.** The voice is the Caretaker's, in English, and its foresight is framed as that character's own network. *Falsifier: advice spoken in a neutral narrator's voice.*
- [ ] **C14: Every figure carries its source.** Each number on a board names the save field or game file it came from. *Falsifier: a number with no named source.*

## Anti-claims

- [ ] **A1: The advisor never writes to the game's directories or the Steam cloud folder.** *Falsifier: an mtime change under `userdata/<id>/262060/` or the install after any run.*
- [ ] **A2: No figure from memory or from the wiki.** *Falsifier: a number on a board with no save or game-file path behind it.*
- [ ] **A3: No spoiler leaks through a default.** *Falsifier: C6's grep with foresight off.*
- [ ] **A4: No game art or wiki text committed.** Art is read from the install at render time. *Falsifier: `git ls-files` lists a `.png` from the install or a wiki excerpt.*

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
- 2026-10-10, Soushi: niceboards from day one. Kickoff board: `.local/brainstorms/town-advisor-brainstorm-2026-10-10.html`, seven cards, built and checked (3 diagrams rendered and read, 17 options, error strip empty).
- Sibling of `factorio-advisor` and `wesnoth-advisor`. Unlike Factorio, no engine run is needed: the game data is text and the save decodes directly.

## Not yet specified

- The town board's own layout, beyond the skin: which in-game screens it echoes (the roster column, the building panels, the estate map) and whether that needs a Niceboard compiler extension or a template of its own.
- The in-dungeon call (Soushi's note on card 4): a later, opt-in way to ask the Caretaker mid-expedition. It reverses the current Out of Scope line, so it needs its own design pass, including how it treats the knowledge boundary.
- Which save field tells the Hamlet from an expedition for C8 and C16; found when the decoder exists.

## Test Strategy

| Claim | Probe |
|---|---|
| C3, C4 | decode the live profile copy; diff against robojumper's `decode` output on the same file |
| C5, C6, A3 | grep the built board for every id under `monsters/` and `dungeons/` outside the witnessed set |
| C12 | build with the Niceboard compiler, open through Interceptor with `?ephemeral`, error strip empty |
| A1 | mtime listing of the save and install directories before and after a run |
