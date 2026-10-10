# darkest-dungeon-advisor

The town advisor for a Darkest Dungeon (DD1, base game) playthrough. Each time the party returns to the Hamlet, a villager reads a copy of your save and helps you prepare the next expedition: who rests and who prays, where the heirlooms go, which party and provisions fit the quest you are weighing. In the dungeon you are on your own.

It speaks only from what you have already lived. Your save records the enemy skills you have suffered, the dungeons you have entered and the expeditions you have run, and that record is the spoiler boundary. An experimental foresight mode, off by default, lets the villager add what their own network has heard, always marked as such.

Its output is a niceboard: one page per return to the Hamlet, every call you have to make a card you click. The board is dressed as an in-game panel: `bun run skin` builds `.local/state/theme.css` from `skin/darkest.css`, inlining the game's own UI art read from your install and the IM Fell English fonts in `skin/fonts/` (SIL OFL 1.1). The art never enters the repository; set `DD_INSTALL` if the game is not under `~/.steam/steam/steamapps/common/DarkestDungeon`.

Sibling of `factorio-advisor` and `wesnoth-advisor`. Unlike Factorio, no engine run is needed: the game's data is plain text under the install, and the save (DSON, a binary JSON-like format) decodes directly.

## Playing with it

```bash
bun install
bun run watch          # leave it running, open http://127.0.0.1:4317/
```

The board is compiled by the Niceboard compiler (`Board.ts`); set `NICEBOARD` to its path if it is not at `~/.claude/skills/Niceboard/Tools/Board.ts`. The save is found under `~/.steam/steam/userdata/*/262060/remote/profile_0`; `DD_PROFILE` overrides it, `DD_INSTALL` the game's folder.

Play. Every time the game saves while you are in the Hamlet, the Caretaker rereads your estate and the page reloads by itself. While you are on an expedition he waits, and the panel stays as you left it until you return. A save made in a dungeon is refused in character.

The board asks its questions as cards: where each stressed or ill hero goes, which expedition next, whether the party he proposes suits you, what to train at the Guild, whom to dismiss or recruit, where the heirlooms go. Pick your answers, add a note where the pick needs one (under the party card, name your own four, front to back), and press **Send to the Caretaker**: the board rebuilds around what you chose. Your picks stay in your browser between rebuilds.

```bash
bun run town           # build the board once, without serving it
bun run watch --foresight   # experimental: the Caretaker hints at what you have not met, by kind only
bun test               # the claims of ISA.md, run against a copy of your save
```

What the Caretaker will not do: name a foe you have not fought in a dungeon you have walked, speak of a dungeon you have never entered, or reveal curio interactions (your save keeps no record of the ones you know). His own rules of thumb (rest at 45 stress, food and torches by length) are labelled RULE on the page; every other number is read from your save or from the game's files.

## Status

What "done" means, with falsifiers, is in [`ISA.md`](ISA.md). The kickoff board lives in `.local/brainstorms/` (not versioned).

## How it is put together

```
src/dson.ts     the DSON save decoder (ported from robojumper's spec, MIT)
src/names.ts    the name table: every identifier in the game's data, by its DSON hash
src/read.ts     copies the profile into .dd-runtime/ and decodes it
src/game.ts     the game's own data: quirks, class skills by rank, upgrade trees, buildings, monsters, English names
src/town.ts     the Hamlet as the save describes it, and the knowledge boundary
src/advise.ts   the Caretaker's reading: relief, party, roster, purchases
src/board.ts    the board source in his voice, compiled with the Niceboard compiler and the skin
src/cli.ts      town, watch, and the answers endpoint
```

## References

- [Darkest Dungeon wiki](https://darkestdungeon.wiki.gg/): mechanics, vocabulary and lore, player-maintained, CC BY-NC-SA 4.0. A reference for understanding, never a source for a figure, and never copied into this repository.
- [robojumper/DarkestDungeonSaveEditor](https://github.com/robojumper/DarkestDungeonSaveEditor), `docs/dson.md`: the save format.

## What it will not do

Write to your save, the Steam cloud folder or the game install. Advise inside a dungeon. Name an enemy or dungeon you have not met, unless foresight is on. Commit game art or wiki text.
