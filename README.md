# darkest-dungeon-advisor

The town advisor for a Darkest Dungeon (DD1, base game) playthrough. Each time the party returns to the Hamlet, a villager reads a copy of your save and helps you prepare the next expedition: who rests and who prays, where the heirlooms go, which party and provisions fit the quest you are weighing. In the dungeon you are on your own.

It speaks only from what you have already lived. Your save records the enemy skills you have suffered, the dungeons you have entered and the expeditions you have run, and that record is the spoiler boundary. An experimental foresight mode, off by default, lets the villager add what their own network has heard, always marked as such.

Its output is a niceboard: one page per return to the Hamlet, every call you have to make a card you click. The board is dressed as an in-game panel: `bun run skin` builds `.local/state/theme.css` from `skin/darkest.css`, inlining the game's own UI art read from your install and the IM Fell English fonts in `skin/fonts/` (SIL OFL 1.1). The art never enters the repository; set `DD_INSTALL` if the game is not under `~/.steam/steam/steamapps/common/DarkestDungeon`.

Sibling of `factorio-advisor` and `wesnoth-advisor`. Unlike Factorio, no engine run is needed: the game's data is plain text under the install, and the save (DSON, a binary JSON-like format) decodes directly.

## Status

Founding. What "done" means, with falsifiers, is in [`ISA.md`](ISA.md). The kickoff board lives in `.local/brainstorms/` (not versioned).

## References

- [Darkest Dungeon wiki](https://darkestdungeon.wiki.gg/): mechanics, vocabulary and lore, player-maintained, CC BY-NC-SA 4.0. A reference for understanding, never a source for a figure, and never copied into this repository.
- [robojumper/DarkestDungeonSaveEditor](https://github.com/robojumper/DarkestDungeonSaveEditor), `docs/dson.md`: the save format.

## What it will not do

Write to your save, the Steam cloud folder or the game install. Advise inside a dungeon. Name an enemy or dungeon you have not met, unless foresight is on. Commit game art or wiki text.
