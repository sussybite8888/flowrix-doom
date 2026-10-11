# doomgeneric (vendored)

The DOOM engine behind the local `doom.js` flowrix boot script, built by
`../build.sh` into flowrix's ignored `cpp/client/web/boot-local/`.

- Upstream: https://github.com/ozkl/doomgeneric, commit
  `dcb7a8dbc7a16ce3dda29382ac9aae9d77d21284`, directory `doomgeneric/`.
- What is here: the sources its `Makefile.emscripten` compiles, minus its
  emscripten platform layer (`../doomgeneric_flix.c` replaces it),
  and every header. Upstream's README is `README.upstream.md`.
- Changed here, each marked in the file's header: `d_main.c` (an exit
  function registered through a cast that traps in WebAssembly).
- **License: GNU GPL version 2 (`LICENSE`).** Most files come from Chocolate
  Doom and say "version 2 or any later version"; the rest fall under
  upstream's GPL-2.0 `LICENSE`. These files plus `..` are the complete source
  of `doom.js`/`doom.wasm`. Kept out of the flowrix repository: nothing here is
  committed there or shipped to players. Giving an offline.html with DOOM in it
  to someone else is distributing GPL code: give them this directory too.

No game data is included. DOOM's WAD files are id Software's; the boot script
asks the player for their own.
