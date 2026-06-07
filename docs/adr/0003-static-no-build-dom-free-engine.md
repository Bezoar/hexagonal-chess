# Static site, no build step; the engine is DOM-free

The app ships as plain static files (HTML/CSS/ES modules) with **no build step** — it
runs by opening `index.html` and is hostable on GitHub Pages with no bundler,
transpiler, or server. The rules/engine modules are kept **DOM-free** so they import
directly into Node's built-in test runner.

We chose this over a conventional bundler/framework setup. The app is small, fully
client-side, and meant to be trivially hostable and openable; a build pipeline would
add tooling, CI, and lock-in for no functional gain, and would obscure the
"open the file and it works" delivery goal. Keeping the engine free of DOM/browser
APIs lets correctness (move generation, check/mate/stalemate, en passant, promotion,
draws) be tested headlessly with `node --test` and no harness.

We record this because it is a deliberate deviation a future contributor might
"fix": the absence of a bundler is intentional, and the engine's DOM-free purity is a
constraint to preserve (rendering, storage, audio, and touch belong in the
browser-only modules, never in `hex.js`/`rules.js`/`game.js`). Adding a build step or
reaching into the DOM from the engine would break both the delivery model and the
test strategy.
