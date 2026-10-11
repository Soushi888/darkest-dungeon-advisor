# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A read-only town advisor for a Darkest Dungeon (DD1, base game only) playthrough. It decodes a copy of the player's save, reads the game's own data files from the install, and writes a niceboard (an interactive HTML page) in the voice of the Caretaker, in English, first person. It advises only in the Hamlet, never inside a dungeon. `README.md` is the user-facing guide; `ISA.md` is the spec of record: numbered claims (C1 onward) and anti-claims A1 to A4, each with its falsifier and evidence, plus the decisions and what is not yet specified. Tests are named after those claims.

## Commands

```bash
bun install
bun run town                 # build the board once: .local/town/town.md -> town.html
bun run watch                # serve on http://127.0.0.1:4317/, rebuild on every Hamlet save (--port=<n>, --foresight)
bun run read                 # decode the save to data/state.json, for inspecting fields
bun run skin                 # build .local/state/theme.css from skin/darkest.css plus art from the install
bun run live                 # one line per board send or game save, for a live session (see below)
bun run now                  # the latest page in full: the four and the foes front to back, who has acted, where they stand
bun run say --page N "<t>"   # the Caretaker's line on the road thread, tied to the page it answers
bun test                     # all claim probes
bun test -t "C6"             # one test, by its claim id
bun run typecheck            # tsc --noEmit
```

Tests run against a copy of the local profile in `.dd-runtime/test-profile` and are skipped entirely when no profile is found, because a save is personal and never committed. A skipped suite is not a passing one.

Environment: `DD_INSTALL` (game folder, default `~/.steam/steam/steamapps/common/DarkestDungeon`), `DD_PROFILE` (folder holding `persist.game.json`, default the first Steam user's `262060/remote/profile_0`), `NICEBOARD` (path to the external Niceboard compiler, default `~/.claude/skills/Niceboard/Tools/Board.ts`; the board cannot build without it).

## Pipeline

`paths.ts` → `read.ts` → `town.ts` → `advise.ts` (+ `reconcile.ts`, `chronicle.ts`) → `board.ts` (+ `coherence.ts`) → `cli.ts`; `live.ts` streams events for a live session

- `read.ts` copies every `persist.*.json` into `.dd-runtime/profile/` and decodes the copy with `dson.ts` (DSON, ported from robojumper's spec). The original profile is only ever read.

- `names.ts` resolves DSON string hashes by hashing every identifier token in the install's data plus every `<class>.<skill>` pair, cached in `data/names.json`. Delete that file to rebuild it. Integers under 100 000 are never unhashed (a 4500 gold reward once decoded as "Se").

- `game.ts` loads the game's own files. Every path it reads is declared in `P` so the board can cite it.

- `town.ts` turns the save into a `Town`: pure derivation, no advice. It also computes the knowledge boundary.

- `advise.ts` is the Caretaker's judgement: relief, parties seated by rank, dismissals, recruits, Guild and Blacksmith purchases, heirlooms, trinkets.

- `board.ts` writes the niceboard markdown in his voice, copies portraits into `.local/town/img/`, and compiles with the external compiler plus the skin.

- `chronicle.ts` keeps a snapshot of the party at every dungeon save (`.local/town/chronicle/<expedition>/`, a summary plus the whole decoded record), turns it into the survivors' tale and the lessons on return, and keeps the ledger (`.local/town/lessons.json`).

- `coherence.ts` reads every built board back and lists advice that contradicts itself into `.local/town/coherence.json`.

- `cli.ts` serves the page with an injected "Send to the Caretaker" button (also Ctrl+Shift+Enter). It POSTs the board's answers to `/answers`, which writes `.local/town/answers.md`, merges `.local/town/picks.json` and rebuilds. The page keeps picks by card number, so a head script re-attaches each stored pick to its question text, and the server drops a pick that is not one of its card's options (C18); `readAnswers()` in `board.ts` still finds the expedition and party picks by card title, so keep those titles stable. The page reloads on `/version` (`<watcher start>-<build count>`, served `no-store`). Rebuilds are serialized, with at most one queued rerun.

## Invariants the tests and ISA enforce

- **Never write** to the save, the Steam cloud folder or the game install (A1). Work on copies under `.dd-runtime/`.

- **Knowledge boundary (C5, C6, A3).** A monster may be named only if it lives in a dungeon level the campaign log records as walked *and* one of its attacks is in `persist.game_knowledge.json`. Attack ids are shared across tiers, so the walked level is what tells variants apart. A dungeon never walked gets no foe named. Curio interactions are never shown. The `--foresight` flag is the only exception, and it names kinds, never monsters.

- **No figure from memory or the wiki (A2, C14).** Every number comes from the save or a game file and is listed with its source in `.local/town/sources.md`, never on the board. The advisor's own thresholds (`RULE` and `RULE_FOOD` in `advise.ts`, `CHRONICLE_RULE` in `chronicle.ts`) are labelled "my habit" on the board.

- **The board stays in the fiction (C13).** Everything on it is the Caretaker speaking in the Hamlet's words: no save, file, field, upgrade code or tool named. Name upgrade trees through `TREE_WORDS` in `town.ts` and prerequisites through `inWords()` in `board.ts`. The C13 test greps the board for meta vocabulary.

- **Picks are checked, never applied (C18).** The board cannot act in the game; `src/reconcile.ts` compares the week's picks (`.local/town/picks.json`) with the next Hamlet save and the board shows each as done, not yet, or not as chosen.

- **No game art or wiki text committed (A4).** Art is inlined into `.local/` at build time; `.local/`, `data/` and `.dd-runtime/` are gitignored. Fonts in `skin/fonts/` are SIL OFL and are the only committed assets.

- **The road is paid for first (C22).** `road()` in `advise.ts` prices the expedition's provisions from `inventory/base.supply.inventory.items.darkest` (with the week's event applied); every spending lean on the board draws only on the gold left after that reserve.

- **The fallen are never advised (C21).** `persist.roster.json` keeps dead heroes; `town.ts` sets aside every guid the campaign log records as `died`.

- **A save made in a dungeon** (`persist.game.json` `inraid`) is refused in character and writes no board (C8). The watcher's `/version` only moves on Hamlet saves (C16).

When a change touches a claim, update its line in `ISA.md` with the new evidence; open design questions go under its "Not yet specified" section.

## Live session

When Soushi plays with the board open, watch the session yourself; he should never have to tell you that he pressed Send or that the game saved.

- **Start:** check the watcher is up (`pgrep -af "src/cli.ts watch"`), then arm the Monitor tool on `bun run live` with the maximum timeout, and re-arm it on every expiry until he stops playing. It prints one line per event: `SEND <time> <n> picks`, `SAVE <time> town` only when a Hamlet save changed the rebuilt board (the game saves every few seconds in town), and `SAVE <time> dungeon` once per expedition. A chronicle page prints as `CHRON` or `PAGE`, and a page over 400 characters continues on `MORE` lines printed in the same write, so the Monitor's filter must keep `MORE` too. Wake only on `CHRON`, `ASK`, `SEND`, `SAVE` and `WARN`: a `PAGE` is kept but is not worth a turn (each wake rereads the whole context, about 580k cached tokens a page on 2026-10-11). A `CHRON` line carries the page whole, as `bun run now` prints it (C63), so comment from the line with one `bun run say --page <page>`.

- **Read the page before you speak.** Comment with `bun run say --page <that page> "<text>"`. A claim about who has acted, the ranks or anyone's health comes from the page's snapshot (the `CHRON` line's `MORE` lines, or `bun run now` when the line is not enough, as after an `ASK`), never from memory of the stream; a line about a page the game has since left shows in the thread as late.

- **On SEND:** read `.local/town/answers.md`, `.local/town/picks.json` and the rebuilt `.local/town/town.md`, then tell him in a few lines what the Caretaker took from it: the expedition and party, picks dropped as not belonging to their card (the page keeps picks by card position), and anything the board now warns about (a road the coffers cannot pay for). His notes, stickies and general comments are requests: answer them, and build what they ask for when it is a change to the advisor.

- **On SAVE town:** the board has rebuilt. Read its "Did you do what you chose?" zone and name anything Not as chosen.

- **On WARN:** the rebuilt board advises two things that cannot both be done (C38, `src/coherence.ts`). Fix the advice at its source before Soushi acts on it, and add a check to `contradictions()` for any new kind of clash he catches.

- **On ASK:** Soushi wrote from the road zone at the top of the farewell board (C49). Answer there with `bun run say --page <page> "<text>"` after reading `bun run now`, and keep commenting every dungeon page there too, so the thread is the whole conversation.

- **On SAVE dungeon:** the board has turned into the farewell (C24), once per expedition, and then waits (C16). Read `.local/town/town.md` and give him its verdict and its warnings in two or three lines, then say nothing until he is back unless asked.

- **Keep the live board on current code.** Changes land on `main`; after each one, restart the watcher (`pkill -f "src/cli.ts watch$"`, then `nohup bun src/cli.ts watch > .dd-runtime/watch.log 2>&1 &`) and check `.dd-runtime/watch.log` prints a new `week N` line. Tests build in `.dd-runtime/test-town` (`DD_TOWN_OUT`) and never touch the live board; preview a change with `DD_TOWN_OUT=.dd-runtime/preview bun src/cli.ts town`.
