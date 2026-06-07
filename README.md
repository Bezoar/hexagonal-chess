# hexagonal-chess

A **dual-facing** presentation of **Gliński's hexagonal chess**, for two players
sharing one tablet (the informal name is "double-headed"). The board is rendered
once and never flips — each army's pieces and each seat's status banner are oriented
to that player's side, so both read the game upright at the same time.

## Play

Static site, no build step — open `index.html` directly, or serve the folder
(`python3 -m http.server`) and visit it. Works in landscape or portrait; both
players share one tablet and read their own side right-side-up.

## Develop

The rules engine (`src/hex.js`, `src/rules.js`, `src/game.js`, `src/match.js`) is
DOM-free and unit-tested with Node's built-in runner:

```sh
node --test
```

Rendering, input, persistence, and audio live in the browser-only modules
(`src/render.js`, `src/ui.js`, `src/storage.js`, `src/audio.js`, `src/pieces.js`).

## Docs

- [`docs/specs/primary.md`](docs/specs/primary.md) — the primary spec
- [`CONTEXT.md`](CONTEXT.md) — domain glossary (canonical terminology)
- [`docs/adr/`](docs/adr/) — architecture decision records
- [`mockups/`](mockups/) — rendered UI mockups of the locked visual design
