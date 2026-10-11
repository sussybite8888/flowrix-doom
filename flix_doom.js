// SPDX-License-Identifier: GPL-2.0-or-later
//
// The page side of doomgeneric_flix.c, given to emcc as --pre-js: it runs
// inside the glue, before the runtime starts, with the Module a boot script is
// handed (client/web/shell.html, offline/shell.html): the shell's #canvas, its
// print/printErr, and flixBoot.
(function () {
  const canvas = Module.canvas;
  const loading = document.getElementById('loadingScreen');
  if (loading) loading.style.display = 'none';

  // Found beside this script by the boot file layer (client/web/boot_files.js)
  // as a bare name, wherever the page itself lives.
  Module.locateFile = (path) => path;

  // DOOM's 320x200 drawn at 4:3, as it was on a CRT, centred and as large as
  // the window allows. The shell pins every canvas to the whole window.
  const fit = () => {
    const width = Math.min(innerWidth, innerHeight * 4 / 3);
    const height = width * 3 / 4;
    Object.assign(canvas.style, {
      width: width + 'px', height: height + 'px',
      left: (innerWidth - width) / 2 + 'px', top: (innerHeight - height) / 2 + 'px',
      imageRendering: 'pixelated', background: '#000',
    });
  };
  fit();
  addEventListener('resize', fit);

  let context = null;
  let image = null;
  let image32 = null;
  const present = (pixels, width, height) => {
    if (!image || image.width !== width || image.height !== height) {
      canvas.width = width;
      canvas.height = height;
      context = canvas.getContext('2d', { alpha: false });
      image = context.createImageData(width, height);
      image32 = new Uint32Array(image.data.buffer);
    }
    // 0x00RRGGBB in, ImageData's R,G,B,A bytes (0xAABBGGRR as a word) out.
    const from = pixels >>> 2;
    const count = width * height;
    const heap = HEAPU32;
    for (let i = 0; i < count; i++) {
      const p = heap[from + i];
      image32[i] = 0xFF000000 | ((p & 0xFF) << 16) | (p & 0xFF00) | ((p >>> 16) & 0xFF);
    }
    context.putImageData(image, 0, 0);
  };

  // --- keys ------------------------------------------------------------------
  // doomkeys.h. Letters, digits and punctuation go by the physical key
  // (event.code), so Shift -- run -- does not turn 1 into ! mid-fight.
  const kNamed = {
    ArrowRight: 0xae, ArrowLeft: 0xac, ArrowUp: 0xad, ArrowDown: 0xaf,
    Escape: 27, Enter: 13, NumpadEnter: 13, Tab: 9, Backspace: 0x7f, Pause: 0xff,
    ControlLeft: 0xa3, ControlRight: 0xa3, Space: 0xa2,
    ShiftLeft: 0x80 + 0x36, ShiftRight: 0x80 + 0x36, AltLeft: 0x80 + 0x38, AltRight: 0x80 + 0x38,
    F1: 0x80 + 0x3b, F2: 0x80 + 0x3c, F3: 0x80 + 0x3d, F4: 0x80 + 0x3e, F5: 0x80 + 0x3f,
    F6: 0x80 + 0x40, F7: 0x80 + 0x41, F8: 0x80 + 0x42, F9: 0x80 + 0x43, F10: 0x80 + 0x44,
    F11: 0x80 + 0x57, F12: 0x80 + 0x58,
    Equal: 0x3d, NumpadAdd: 0x3d, Minus: 0x2d, NumpadSubtract: 0x2d,
    Comma: 44, Period: 46, Slash: 47, Semicolon: 59, Quote: 39, Backquote: 96,
    BracketLeft: 91, BracketRight: 93, Backslash: 92,
    Home: 0x80 + 0x47, End: 0x80 + 0x4f, PageUp: 0x80 + 0x49, PageDown: 0x80 + 0x51,
    Insert: 0x80 + 0x52, Delete: 0x80 + 0x53,
  };
  const doomKey = (code) => {
    if (code in kNamed) return kNamed[code];
    let match = /^Key([A-Z])$/.exec(code);
    if (match) return match[1].toLowerCase().charCodeAt(0);
    match = /^(?:Digit|Numpad)([0-9])$/.exec(code);
    if (match) return match[1].charCodeAt(0);
    return 0;
  };

  const queue = [];
  const held = new Set();
  const onKey = (pressed) => (event) => {
    // Cmd shortcuts stay the browser's.
    if (event.metaKey) return;
    const key = doomKey(event.code);
    if (!key) return;
    event.preventDefault();
    if (pressed ? held.has(event.code) : !held.has(event.code)) return;
    if (pressed) held.add(event.code); else held.delete(event.code);
    queue.push((pressed ? 0x100 : 0) | key);
  };
  addEventListener('keydown', onKey(true));
  addEventListener('keyup', onKey(false));
  // A key let go while the page was not looking would be held forever.
  addEventListener('blur', () => {
    for (const code of held) queue.push(doomKey(code));
    held.clear();
  });
  const nextKey = () => queue.length ? queue.shift() : 0;

  // Browsers keep sound off until the player does something.
  const wakeAudio = () => {
    const audio = Module.SDL2 && Module.SDL2.audioContext;
    if (audio && audio.state === 'suspended') audio.resume();
  };
  addEventListener('keydown', wakeAudio);
  addEventListener('pointerdown', wakeAudio);

  // --- saves -----------------------------------------------------------------
  // default.cfg and the savegames, kept in IndexedDB: copied in before DOOM
  // starts, written back every few seconds and when the page goes away.
  let syncing = false;
  const save = () => {
    if (syncing) return;
    syncing = true;
    FS.syncfs(false, () => { syncing = false; });
  };
  let savesDirectory = '';
  const mountSaves = (path) => new Promise((resolve) => {
    savesDirectory = path;
    try {
      FS.mkdir(path);
      FS.mount(IDBFS, {}, path);
    } catch (e) {
      resolve();
      return;
    }
    FS.syncfs(true, (error) => {
      if (error) console.warn('[doom] saves not read: ' + error);
      setInterval(save, 3000);
      addEventListener('pagehide', save);
      resolve();
    });
  });

  // --- the WAD -----------------------------------------------------------------
  // No game data ships with this: the player picks an IWAD from their own copy
  // of DOOM (or Freedoom's free ones), and it is kept beside the saves. The
  // engine tells the games apart by file name, so the copy is stored under the
  // name it expects -- a download called "DOOM1 (1).WAD" is named by what is
  // in it.
  const kWads = ['doom1.wad', 'doom.wad', 'doom2.wad', 'plutonia.wad', 'tnt.wad',
                 'freedoom1.wad', 'freedoom2.wad', 'freedm.wad'];
  const panelStyle = 'position:fixed;inset:0;z-index:10;display:flex;flex-direction:column;' +
    'align-items:center;justify-content:center;gap:16px;padding:24px;background:#16191c;' +
    'color:#fff;font:700 16px Ubuntu,sans-serif;text-align:center;line-height:1.4';
  const button = (label, run) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'font:inherit;padding:8px 16px;border:0;border-radius:4px;' +
      'background:#4caf50;color:#fff;cursor:pointer';
    b.onclick = run;
    return b;
  };

  // The name to store `bytes` under, or why it cannot be played.
  const wadName = (fileName, bytes) => {
    if (bytes.length < 12) return { error: 'That file is too small to be a WAD.' };
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = String.fromCharCode(...bytes.subarray(0, 4));
    if (magic === 'PWAD') return { error: 'That is a mod (PWAD), not a game; pick the game\'s IWAD.' };
    if (magic !== 'IWAD') return { error: 'That is not a WAD file.' };
    const lower = fileName.toLowerCase();
    if (kWads.includes(lower)) return { name: lower };
    const count = view.getInt32(4, true);
    const directory = view.getInt32(8, true);
    if (count <= 0 || directory < 12 || directory + count * 16 > bytes.length) {
      return { error: 'That WAD is damaged.' };
    }
    const lumps = new Set();
    for (let i = 0; i < count; i++) {
      const at = directory + i * 16 + 8;
      let name = '';
      for (let j = 0; j < 8 && bytes[at + j]; j++) name += String.fromCharCode(bytes[at + j]);
      lumps.add(name.toUpperCase());
    }
    if (lumps.has('MAP01')) return { name: 'doom2.wad' };
    if (lumps.has('E2M1')) return { name: 'doom.wad' };
    if (lumps.has('E1M1')) return { name: 'doom1.wad' };
    return { error: 'That WAD has no DOOM levels in it.' };
  };

  const storedWad = (directory) =>
    kWads.map((name) => directory + '/' + name).find((path) => FS.analyzePath(path).exists);

  const flush = () => new Promise((resolve) => FS.syncfs(false, () => resolve()));

  const forgetWad = async (directory) => {
    for (const name of kWads) {
      try { FS.unlink(directory + '/' + name); } catch (e) { }
    }
    await flush();
  };

  const chooseWad = (directory) => {
    const kept = storedWad(directory);
    if (kept) return Promise.resolve(kept);
    return new Promise((resolve) => {
      const panel = document.createElement('div');
      panel.style.cssText = panelStyle;
      const title = document.createElement('div');
      title.textContent = 'DOOM needs a WAD';
      title.style.fontSize = '28px';
      const about = document.createElement('div');
      about.style.maxWidth = '560px';
      about.append(
        'Pick the game data from your own copy of DOOM: doom1.wad (the shareware ' +
        'episode), doom.wad, doom2.wad, plutonia.wad or tnt.wad. Or get ',
        Object.assign(document.createElement('a'), {
          href: 'https://freedoom.github.io/', target: '_blank', rel: 'noopener',
          textContent: 'Freedoom', style: 'color:#7fd6ff',
        }),
        ', free to use, and pick freedoom1.wad or freedoom2.wad. ' +
        'It stays in this browser; nothing is uploaded.');
      const problem = document.createElement('div');
      problem.style.color = '#ff8a80';
      const input = Object.assign(document.createElement('input'),
                                  { type: 'file', accept: '.wad,.WAD', hidden: true });
      const take = async (file) => {
        if (!file) return;
        problem.textContent = '';
        const bytes = new Uint8Array(await file.arrayBuffer());
        const chosen = wadName(file.name, bytes);
        if (chosen.error) {
          problem.textContent = chosen.error;
          return;
        }
        await forgetWad(directory);
        const path = directory + '/' + chosen.name;
        FS.writeFile(path, bytes);
        await flush();
        panel.remove();
        resolve(path);
      };
      input.onchange = () => take(input.files[0]);
      panel.addEventListener('dragover', (event) => event.preventDefault());
      panel.addEventListener('drop', (event) => {
        event.preventDefault();
        take(event.dataTransfer.files[0]);
      });
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center';
      row.append(button('Choose a WAD…', () => input.click()),
                 button('Back to the game', () => toGame()));
      const hint = document.createElement('div');
      hint.textContent = 'or drop it here';
      hint.style.cssText = 'font-size:13px;color:#9aa5ad';
      panel.append(title, about, row, hint, problem, input);
      document.body.append(panel);
    });
  };

  // --- leaving -----------------------------------------------------------------
  // Quit from the menu goes back to the game, for this load (?boot=game); the
  // boot choice stays. An I_Error leaves its message on screen, with a way to
  // a different WAD in case it was the WAD's fault.
  let lastError = '';
  const shellPrintErr = Module.printErr || console.error;
  Module.printErr = (text) => {
    lastError = text;
    shellPrintErr(text);
  };
  const toGame = () => {
    const url = new URL(location.href);
    url.searchParams.set('boot', 'game');
    location.replace(url);
  };
  Module.onExit = (status) => {
    save();
    if (status === 0) {
      setTimeout(toGame, 300);
      return;
    }
    const box = document.createElement('div');
    box.style.cssText = panelStyle.replace('background:#16191c', 'background:rgba(0,0,0,.8)');
    box.textContent = 'DOOM stopped: ' + (lastError || 'exit status ' + status);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center';
    row.append(button('Back to the game', toGame),
               button('Choose another WAD', async () => {
                 await forgetWad(savesDirectory);
                 location.reload();
               }));
    box.append(row);
    document.body.append(box);
  };

  Module.flixDoom = { present, nextKey, mountSaves, chooseWad };
})();
