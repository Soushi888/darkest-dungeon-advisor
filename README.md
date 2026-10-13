# darkest-dungeon-advisor

The town advisor for a Darkest Dungeon (DD1, base game) playthrough. Each time the party returns to the Hamlet, a villager reads a copy of your save and helps you prepare the next expedition: who rests and who prays, where the heirlooms go, which party and provisions fit the quest you are weighing. In the dungeon he gives no advice, but he listens: every save made on the road is kept, and when the coach comes back he tells you what happened and what he learnt from it.

It speaks only from what you have already lived. Your save records the enemy skills you have suffered, the dungeons you have entered and the expeditions you have run, and that record is the spoiler boundary. An experimental foresight mode, off by default, lets the villager add what their own network has heard, always marked as such.

Its output is a niceboard: one page per return to the Hamlet, every call you have to make a card you click. The board is dressed as an in-game panel: `bun run skin` builds `.local/state/theme.css` from `skin/darkest.css`, inlining the game's own UI art read from your install and the IM Fell English fonts in `skin/fonts/` (SIL OFL 1.1). The art never enters the repository; set `DD_INSTALL` if the game is not under `~/.steam/steam/steamapps/common/DarkestDungeon`.

Sibling of `factorio-advisor` and `wesnoth-advisor`. Unlike Factorio, no engine run is needed: the game's data is plain text under the install, and the save (DSON, a binary JSON-like format) decodes directly.

## Playing with it

```bash
bun install
bun run watch          # leave it running, open http://127.0.0.1:4317/
```

The board is compiled by the Niceboard compiler (`Board.ts`); set `NICEBOARD` to its path if it is not at `~/.claude/skills/Niceboard/Tools/Board.ts`. The save is found under `~/.steam/steam/userdata/*/262060/remote/profile_0`; `DD_PROFILE` overrides it, `DD_INSTALL` the game's folder.

Play. Every time the game saves while you are in the Hamlet, the Caretaker rereads your estate and the page reloads by itself. When the coach leaves, the page turns into a farewell: how you sent them against what he proposed, what they carry, the foes you know on that road and when he would turn back. While you are on the road he gives no advice; he keeps a chronicle of every save instead (light, packs, each hero's health, stress, affliction and Death's Door, every foe met and curio searched), because the game deletes its own record when you return.

When the coach is back, the board opens on **The coach is back**: where they went and whether the work was done, who fell and how each survivor stands, the survivors' tale with its turning point and every shuffle of the line (who took which rank), what went well and what went wrong, and the bridge to this week's plan. What he learns goes into a ledger of lessons that changes later advice on the same dungeon, at the same danger or worse, always citing the trip it came from. A road harder than any you have walked is called untried, with a margin of light and food.

The board reads in the order the week is played: the estate, who stays, who rests, then the road, the training and the provisions last. It asks its questions as cards: where the heirlooms go, whom to dismiss or recruit (a recruit who brings the true healer or the stun the four lack comes first, even if it means letting someone go), where each stressed hero goes, which ill hero takes the Medical Ward's bed and which quirk the Treatment Ward works on, which expedition next, whether the party he proposes suits you, what to train at the Guild and the Blacksmith. Trinkets go to open slots in the four, or replace a worn one only when rarer. The party is judged by its fighting shape: which enemy ranks it reaches, whether a seat survives a shuffle, the four skills each hero should carry (and one worth learning), a mark paired with a hand that strikes the marked, bleed and blight against what the foes you know resist. A readiness gauge counts his conditions for sending them (paid road, rested, a true healer, a stun), not their odds.

Pick your answers, add a note where the pick needs one (under the party card, name your own four, front to back), and press **Send to the Caretaker** or **Ctrl+Shift+Enter**: the board rebuilds around what you chose and clears the inputs it received. A pick stays with its question even when cards come and go, and the next save checks each one: done, not yet, or not as chosen. Every build is read back for advice that contradicts itself (the same four everywhere, nobody in the four also sent to a building, spending within what the road leaves); a contradiction never reaches the page.

```bash
bun run town           # build the board once, without serving it
bun run watch --foresight   # experimental: the Caretaker hints at what you have not met, by kind only
bun run live           # one line per send, board-changing save, departure, chronicle page or contradiction
bun test               # the claims of ISA.md, run against a copy of your save
```

`bun run live` is for playing alongside an agent: it is what lets SoushAI answer your sends, comment on the road page by page and fix the board while you play (see `CLAUDE.md`, "Live session").

What the Caretaker will not do: name a foe you have not fought in a dungeon you have walked, speak of a dungeon you have never entered, or reveal curio interactions (your save keeps no record of the ones you know). His own rules of thumb (rest at 45 stress, food and torches by length) are labelled "my habit" on the page; every other number is read from your save or from the game's files.

## Status

What "done" means, with falsifiers, is in [`ISA.md`](ISA.md). The kickoff board lives in `.local/brainstorms/` (not versioned).

## How it is put together

```
# the shell: commands, each an entry point
src/cli.ts               town, watch, the answers endpoint and the send shortcut
src/live.ts              the live session's event stream
src/now.ts               bun run now: the latest chronicle page, read whole
src/road.ts              the road zone: the conversation with the Caretaker while the party is out (bun run say)
src/caretaker.ts         bun run caretaker: he comments the road and answers ASKs by himself
src/ship.ts              bun run ship: a PR merges only through a green suite

# src/sources/: the save and the game's files, read
src/sources/dson.ts      the DSON save decoder (ported from robojumper's spec, MIT)
src/sources/names.ts     the name table: every identifier in the game's data, by its DSON hash
src/sources/read.ts      copies the profile into .dd-runtime/ and decodes it
src/sources/paths.ts     where the install, the profile and the board live (DD_INSTALL, DD_PROFILE, DD_TOWN_OUT)
src/sources/game.ts      the game's own data: quirks, class skills (reach, moves, marks, bleed, blight, heals), upgrade trees, buildings, monsters, trinkets, effects, English names

# src/world/: the Hamlet as a value, and the picks checked against it
src/world/town.ts        the Hamlet as the save describes it, the knowledge boundary, the expedition just brought back
src/world/reconcile.ts   the week's picks against the next Hamlet save: done, not yet, not as chosen
src/world/quest.ts       what the road's quest asks and how far along it is
src/world/week.ts        the week as it began: the week-start record, the roster ledger, who was placed or joined since, the view the four are chosen on

# src/caretaker/: the Caretaker's judgement
src/caretaker/advise.ts  the Caretaker's reading: relief, wards, party and its fighting shape, roster, purchases, trinkets, readiness, the road's provisions
src/caretaker/camp.ts    the campfire council: camping skills in the Hamlet's words, and what the four carry to the fire
src/caretaker/pack.ts    the pack's slots and stacks, from the game's files
src/caretaker/upkeep.ts  the upkeep plan for the four who leave: skills, weapon, armour, camping skill
src/caretaker/roles.ts   the roster's balance: what each hero does, and pairs too alike
src/caretaker/plan.ts    the week's plan: every decision the board shows (the road, the gold each lean spends in turn, who rests, who is treated, who stays), and the farewell's, as one value

# src/voice/: the board and the words in his voice
src/voice/coherence.ts   reads every built board back for advice that contradicts itself
src/voice/board.ts       the plan in his voice (Hamlet, farewell, return), compiled with the Niceboard compiler and the skin; sources.md beside it
src/voice/skin.ts        the in-game panel theme, with art read from your install
src/voice/words.ts       the live stream's effects in the game's own words
src/voice/drafts.ts      a rebuild never reloads the page under his hands

# src/road/: the expedition under way, and its chronicle
src/road/chronicle.ts    the expedition's chronicle, the survivors' tale, what went well and wrong, the ledger of lessons
src/road/livemark.ts     where a restarted live stream resumes
src/road/notable.ts      which chronicle page changes the story
src/road/recap.ts        the Caretaker's recap, its numbers built from the page
src/road/map.ts          the dungeon's map as the party knows it
src/road/turns.ts        what a turn did: a hit, a dodge, a move, a buff or a heal
src/road/slain.ts        the foes slain in the fight under way
src/road/talecheck.ts    the tale checked against the pages before it is told
```

## References

- [Darkest Dungeon wiki](https://darkestdungeon.wiki.gg/): mechanics, vocabulary and lore, player-maintained, CC BY-NC-SA 4.0. A reference for understanding; a figure is taken from it only for a rule of the game no file holds, cited with its page in the sources, and its text is never copied into this repository.
- [robojumper/DarkestDungeonSaveEditor](https://github.com/robojumper/DarkestDungeonSaveEditor), `docs/dson.md`: the save format.

## What it will not do

Write to your save, the Steam cloud folder or the game install (everything it keeps lives under `.local/` and `.dd-runtime/`, never versioned). Advise inside a dungeon. Name an enemy or dungeon you have not met, unless foresight is on. Commit game art or wiki text.
