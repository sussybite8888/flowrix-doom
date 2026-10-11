// SPDX-License-Identifier: GPL-2.0-or-later
//
// doomgeneric's platform layer for running DOOM as a boot script
// (client/web/boot.h): the page, not SDL, owns the picture and the keys.
// Linked with the GPL-2.0 engine in ./doomgeneric, so GPL.
//
// Built by build.sh into flowrix's client/web/boot-local/. The page is the
// game's own (a boot script gets the shell's #canvas as Module.canvas), so
// everything here that touches it lives in flix_doom.js, which build.sh hands
// emcc as --pre-js. SDL is linked only for SDL_mixer's sound effects.

#include "doomgeneric.h"
#include "doomkeys.h"
#include "i_system.h"

#include <emscripten.h>

#include <stdint.h>
#include <stdlib.h>
#include <unistd.h>

// The picture: DG_ScreenBuffer is 0x00RRGGBB per pixel, little-endian.
EM_JS(void, flix_present, (const uint32_t* pixels, int width, int height), {
    Module.flixDoom.present(pixels, width, height);
});

// A key, or 0 when none is waiting: (pressed << 8) | doom key.
EM_JS(int, flix_next_key, (void), {
    return Module.flixDoom.nextKey();
});

EM_JS(void, flix_title, (const char* title), {
    document.title = UTF8ToString(title);
});

// Mounts the save directory over browser storage and waits for its contents.
EM_ASYNC_JS(void, flix_mount_saves, (const char* path), {
    await Module.flixDoom.mountSaves(UTF8ToString(path));
});

// The IWAD to play, asked of the player the first time and kept beside the
// saves: no game data ships with this.
EM_ASYNC_JS(void, flix_choose_wad, (const char* directory, char* path, int size), {
    stringToUTF8(await Module.flixDoom.chooseWad(UTF8ToString(directory)), path, size);
});

void DG_Init(void) {}

void DG_DrawFrame(void) {
    flix_present(DG_ScreenBuffer, DOOMGENERIC_RESX, DOOMGENERIC_RESY);
}

// Every wait gives the page its turn (ASYNCIFY): DOOM sleeps until its next
// 35 Hz tic, and the browser draws the frame and delivers keys meanwhile.
void DG_SleepMs(uint32_t ms) {
    emscripten_sleep(ms);
}

uint32_t DG_GetTicksMs(void) {
    return (uint32_t)emscripten_get_now();
}

int DG_GetKey(int* pressed, unsigned char* doomKey) {
    int key = flix_next_key();
    if (!key) return 0;
    *pressed = key >> 8;
    *doomKey = key & 0xFF;
    return 1;
}

void DG_SetWindowTitle(const char* title) {
    flix_title(title);
}

// doomgeneric's I_Quit runs the exit functions and returns (its exit() is
// ORIGCODE-only), which leaves DOOM running after Quit Game. Registered first,
// this runs last: the onExit in flix_doom.js then goes back to the game.
static void flix_quit(void) {
    exit(0);
}

int main(int argc, char** argv) {
    (void)argc;
    (void)argv;
    // default.cfg and the savegames go in the working directory.
    static const char* kSaves = "/doom";
    flix_mount_saves(kSaves);
    chdir(kSaves);

    static char wad[256];
    flix_choose_wad(kSaves, wad, sizeof wad);
    I_AtExit(flix_quit, false);
    static char* args[] = {"doom", "-iwad", wad, NULL};
    doomgeneric_Create(3, args);
    for (;;) doomgeneric_Tick();
    return 0;
}
