#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Builds DOOM as a flowrix boot script: doom.js + doom.wasm.
#
# The engine is doomgeneric (./doomgeneric, GPL-2.0) with this directory's
# platform layer (doomgeneric_flix.c) and page glue (flix_doom.js). No WAD is
# built in: the page asks the player for theirs.
#
#   ./build.sh [output dir]       needs emcc on PATH
#
# The output defaults to the flowrix checkout's cpp/client/web/boot-local/,
# which git ignores and only the offline page embeds (cpp/CMakeLists.txt). Then
# `npm run build:offline` there. Kept outside the repository on purpose: none
# of this is committed or shipped to other players.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
dg=$here/doomgeneric
out=${1:-${FLOWRIX_REPO:-$HOME/florr.io_clone}/cpp/client/web/boot-local}
mkdir -p "$out"

emcc -O2 -w \
  -I"$dg" \
  -DFEATURE_SOUND -DDOOMGENERIC_RESX=320 -DDOOMGENERIC_RESY=200 \
  -sUSE_SDL=2 -sUSE_SDL_MIXER=2 -sSDL2_MIXER_FORMATS='[]' \
  -sASYNCIFY -sEXIT_RUNTIME=1 -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web \
  -sDEFAULT_LIBRARY_FUNCS_TO_INCLUDE='$stringToUTF8' \
  -lidbfs.js \
  --extern-pre-js "$here/header.js" \
  --pre-js "$here/flix_doom.js" \
  "$dg"/*.c "$here/doomgeneric_flix.c" \
  -o "$out/doom.js"

ls -l "$out/doom.js" "$out/doom.wasm"
