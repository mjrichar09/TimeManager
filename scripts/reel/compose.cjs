// Builds the reel from the raw takes: cards and frames are HTML rendered to PNG
// in IBM Plex, the takes are dropped into them with ffmpeg, and the scenes are
// joined with short crossfades. One run makes both the 16:9 and the 1:1 cut.
//
//   node scripts/reel/compose.cjs     after record.cjs and prepare-explorer.cjs
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { DIR, playwright, ffmpeg } = require('./config.cjs');

const { chromium } = playwright();
const FF = ffmpeg();
const OUT = path.join(DIR, 'out');
const TMP = path.join(DIR, 'build');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });
const FONTS = fs.readFileSync(path.join(DIR, 'fonts.css'), 'utf8');
const marks = JSON.parse(fs.readFileSync(path.join(DIR, 'raw/marks.json')));

const FPS = 30;
const XF = 0.45; // crossfade seconds

// The reel's argument, in order: Tally (see where the time goes, so you can
// focus and cut or hand off the rest), then Rounds (chores planned for you, so
// they leave your head). Each scene is a take, optionally a slice of one.
// Clock-driven scenes stay near 1x so the stopwatch doesn't visibly race.
const SEQUENCE = [
  { card: 'title', eyebrow: 'Tally & Rounds', title: 'Spend your time on what matters. Let the chores plan themselves.', sub: 'Two small apps for a calmer week.', dur: 4.4 },
  { card: 'ch-tally', eyebrow: '01 · Tally', title: 'Know where your time goes', sub: 'Then focus on what matters, and cut or hand off the rest.', dur: 3.6 },
  { take: 'capture', speed: 1.0, eyebrow: 'Tally · Capture', title: 'One tap when you switch', sub: 'The day builds itself on a 24-hour dial. Blue charges you, red drains you.' },
  { take: 'reconcile', speed: 1.2, eyebrow: 'Tally · Reconcile', title: 'Tidy up in seconds', sub: 'Missed a tap? Drag an edge, split a block or relabel it.' },
  { take: 'explorer', to: 'cut', speed: 1.25, eyebrow: 'Tally · Insights', title: 'See where your time really goes', sub: 'Hours by category and week, and how your energy tracked them.' },
  { take: 'explorer', from: 'cut', speed: 1.15, eyebrow: 'Tally · Insights', title: 'Know what to cut or hand off', sub: 'Check the hours you meant to cut really fell, and see what outsourcing would cost.' },
  { card: 'ch-rounds', eyebrow: '02 · Rounds', title: 'Chores, off your mind', sub: 'Every recurring chore and renewal, planned ahead so you never have to remember them.', dur: 3.6 },
  { take: 'plan', speed: 1.0, eyebrow: 'Rounds · Plan', title: 'Your week, planned for you', sub: 'Chores are fitted into each day’s free time by how long they take and when they’re due.' },
  { take: 'today', speed: 1.1, eyebrow: 'Rounds · Today', title: 'Start the day already decided', sub: 'Today’s chores are chosen for you. Time one and its estimate learns.' },
  { take: 'renewals', speed: 1.0, eyebrow: 'Rounds · Renewals', title: 'Long-term tasks, handled', sub: 'Inspections and renewals count down, then slot into the plan when their window opens.' },
  { card: 'end', eyebrow: 'Tally & Rounds', title: 'Focus on what matters. Let the rest run itself.', sub: 'Track your time. Plan your chores. Clear your head.', dur: 4.4 },
];

const C = { ground: '#e9e8e3', ink: '#141414', ink2: '#5a5954', ink3: '#8d8c85', charge: '#2a78d6', drain: '#e34948' };

const page = (w, h, body, bg = C.ground) => `<!doctype html><html><head><meta charset="utf-8"><style>
${FONTS}
*{box-sizing:border-box;margin:0}
html,body{width:${w}px;height:${h}px;background:${bg};overflow:hidden}
body{font-family:'IBM Plex Sans',sans-serif;color:${C.ink};-webkit-font-smoothing:antialiased;position:relative}
.eyebrow{font:500 ${w > 1500 ? 20 : 18}px 'IBM Plex Mono',monospace;letter-spacing:.14em;text-transform:uppercase;color:${C.ink3}}
.title{font-family:'IBM Plex Sans Condensed',sans-serif;font-weight:600;letter-spacing:-.01em;line-height:1.02;text-wrap:balance}
.sub{color:${C.ink2};line-height:1.4;text-wrap:pretty}
.ticks{display:flex;gap:10px;align-items:center}
.ticks i{display:block;width:10px;height:10px;border-radius:2px}
</style></head><body>${body}</body></html>`;

const legend = `<div class="ticks"><i style="background:${C.charge}"></i><i style="background:#a9a8a0"></i><i style="background:${C.drain}"></i></div>`;

function layouts(fmt) {
  const sq = fmt === 'square';
  const W = sq ? 1080 : 1920, H = sq ? 1080 : 1080;
  // Phone screen box (the take is scaled into this), and its bezel.
  const screenH = sq ? 780 : 900;
  const screenW = Math.round((screenH * 390) / 844);
  const bez = sq ? 12 : 14;
  const phoneX = sq ? Math.round((W - screenW - bez * 2) / 2) : 1180;
  const phoneY = sq ? 250 : Math.round((H - screenH - bez * 2) / 2);
  const screen = { x: phoneX + bez, y: phoneY + bez, w: screenW, h: screenH };
  // Browser window for the explorer.
  const winW = sq ? 1000 : 1560;
  const winH = Math.round((winW * 810) / 1440);
  const bar = sq ? 26 : 36;
  const winX = Math.round((W - winW) / 2);
  const winY = sq ? 300 : 148;
  const win = { x: winX, y: winY + bar, w: winW, h: winH };
  return { sq, W, H, screen, bez, phoneX, phoneY, win, bar, winX, winY };
}

function captionHTML(L, s, kind) {
  if (L.sq) {
    const top = kind === 'desktop' ? 96 : 54;
    return `<div style="position:absolute;left:64px;right:64px;top:${top}px">
      <div class="eyebrow">${s.eyebrow}</div>
      <div class="title" style="font-size:60px;margin-top:12px">${s.title}</div>
      <div class="sub" style="font-size:24px;margin-top:10px;max-width:900px">${s.sub}</div></div>`;
  }
  if (kind === 'desktop') {
    return `<div style="position:absolute;left:${L.winX}px;top:30px">
      <div style="display:flex;align-items:baseline;gap:22px"><div class="eyebrow">${s.eyebrow}</div><div class="title" style="font-size:44px">${s.title}</div></div>
      <div class="sub" style="font-size:22px;margin-top:6px">${s.sub}</div></div>`;
  }
  return `<div style="position:absolute;left:150px;top:0;bottom:0;width:860px;display:flex;flex-direction:column;justify-content:center;gap:22px">
    <div class="eyebrow">${s.eyebrow}</div>
    <div class="title" style="font-size:96px">${s.title}</div>
    <div class="sub" style="font-size:32px;max-width:760px">${s.sub}</div>
    <div style="margin-top:18px">${legend}</div></div>`;
}

function phoneBG(L, s) {
  const r = L.sq ? 50 : 58;
  return page(L.W, L.H, `${captionHTML(L, s, 'phone')}
    <div style="position:absolute;left:${L.phoneX}px;top:${L.phoneY}px;width:${L.screen.w + L.bez * 2}px;height:${L.screen.h + L.bez * 2}px;border-radius:${r}px;background:#1b1b1a;box-shadow:0 40px 80px -30px rgba(0,0,0,.45),0 0 0 2px #2c2c2a"></div>`);
}
function phoneFrame(L) {
  // Transparent everywhere except the bezel: a ring drawn with a huge inset
  // shadow-free border so the take's square corners are covered.
  const r = L.sq ? 50 : 58, ri = r - L.bez;
  return page(L.W, L.H, `
    <svg width="${L.W}" height="${L.H}" style="position:absolute;inset:0">
      <defs><mask id="m"><rect width="100%" height="100%" fill="white"/>
        <rect x="${L.screen.x}" y="${L.screen.y}" width="${L.screen.w}" height="${L.screen.h}" rx="${ri}" fill="black"/></mask></defs>
      <rect x="${L.phoneX}" y="${L.phoneY}" width="${L.screen.w + L.bez * 2}" height="${L.screen.h + L.bez * 2}" rx="${r}" fill="#1b1b1a" mask="url(#m)"/>
      <rect x="${L.screen.x + L.screen.w / 2 - (L.sq ? 48 : 56)}" y="${L.screen.y + 10}" width="${L.sq ? 96 : 112}" height="${L.sq ? 26 : 30}" rx="${L.sq ? 13 : 15}" fill="#1b1b1a"/>
    </svg>`, 'transparent');
}
function desktopBG(L, s) {
  return page(L.W, L.H, `${captionHTML(L, s, 'desktop')}
    <div style="position:absolute;left:${L.winX}px;top:${L.winY}px;width:${L.win.w}px;height:${L.win.h + L.bar}px;border-radius:12px;background:#fcfcfb;box-shadow:0 40px 80px -30px rgba(0,0,0,.4),0 0 0 1px #d9d8d2;overflow:hidden">
      <div style="height:${L.bar}px;background:#eceae5;border-bottom:1px solid #d9d8d2;display:flex;align-items:center;gap:8px;padding:0 14px">
        <i style="width:12px;height:12px;border-radius:50%;background:#e34948;opacity:.8"></i><i style="width:12px;height:12px;border-radius:50%;background:#e8b04a"></i><i style="width:12px;height:12px;border-radius:50%;background:#5fb35f"></i>
        <span style="margin-left:14px;font:500 ${L.sq ? 11 : 13}px 'IBM Plex Mono',monospace;color:#8d8c85">Tally Baseline Explorer</span>
      </div></div>`);
}
function cardHTML(L, c, accent) {
  const big = c.title.length > 40 ? (L.sq ? 72 : 100) : L.sq ? 84 : 120;
  return page(L.W, L.H, `<div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 ${L.sq ? 80 : 160}px;gap:${L.sq ? 22 : 28}px">
    <div class="eyebrow">${c.eyebrow}</div>
    <div class="title" style="font-size:${big}px;max-width:${L.sq ? 920 : 1500}px">${c.title}</div>
    <div class="sub" style="font-size:${L.sq ? 30 : 38}px">${c.sub}</div>
    <div style="margin-top:12px">${accent}</div></div>`);
}

async function renderPNGs(browser, fmt) {
  const L = layouts(fmt);
  const ctx = await browser.newContext({ viewport: { width: L.W, height: L.H } });
  const p = await ctx.newPage();
  const shot = async (html, file, transparent = false) => {
    await p.setContent(html, { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: file, omitBackground: transparent });
  };
  for (const [i, s] of SEQUENCE.entries()) {
    const file = path.join(TMP, `${fmt}-${i}.png`);
    if (s.card) await shot(cardHTML(L, s, legend), file);
    else await shot(marks[s.take].kind === 'phone' ? phoneBG(L, s) : desktopBG(L, s), file);
  }
  await shot(phoneFrame(L), path.join(TMP, `${fmt}-phone-frame.png`), true);
  await ctx.close();
  return L;
}

const ff = (args) => execFileSync(FF, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });

function sceneClip(fmt, L, s, i) {
  const m = marks[s.take];
  const at = (v, fallback) => (v === undefined ? fallback : typeof v === 'string' ? m.notes[v] : v);
  const from = at(s.from, 0);
  const to = at(s.to, m.duration);
  // Still frames either side, so a caption can be read before anything moves
  // and the result of the action sits on screen before the cut.
  const holdIn = s.holdIn ?? 1.1, holdOut = s.holdOut ?? 1.0;
  const dur = (to - from) / s.speed + holdIn + holdOut;
  const out = path.join(TMP, `${fmt}-${i}.mp4`);
  const list = path.join(DIR, 'raw', s.take, 'list.txt');
  const box = m.kind === 'phone' ? L.screen : L.win;
  const fg = m.kind === 'phone'
    ? `[0:v][v]overlay=${box.x}:${box.y}[a];[a][2:v]overlay=0:0`
    : `[0:v][v]overlay=${box.x}:${box.y}`;
  const inputs = ['-loop', '1', '-framerate', String(FPS), '-i', path.join(TMP, `${fmt}-${i}.png`), '-f', 'concat', '-safe', '0', '-i', list];
  if (m.kind === 'phone') inputs.push('-loop', '1', '-framerate', String(FPS), '-i', path.join(TMP, `${fmt}-phone-frame.png`));
  ff([
    ...inputs,
    '-filter_complex',
    `[1:v]trim=start=${from}:end=${to},setpts=(PTS-STARTPTS)/${s.speed},fps=${FPS},tpad=start_mode=clone:start_duration=${holdIn}:stop_mode=clone:stop_duration=${holdOut},scale=${box.w}:${box.h}:flags=lanczos,format=rgba[v];${fg},format=yuv420p[o]`,
    '-map', '[o]', '-t', dur.toFixed(3), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', out,
  ]);
  return { file: out, dur };
}

function cardClip(fmt, i, dur) {
  const out = path.join(TMP, `${fmt}-${i}.mp4`);
  ff(['-loop', '1', '-framerate', String(FPS), '-i', path.join(TMP, `${fmt}-${i}.png`), '-t', String(dur), '-r', String(FPS), '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', out]);
  return { file: out, dur };
}

function join(fmt, clips) {
  const args = [];
  clips.forEach((c) => args.push('-i', c.file));
  let filter = '';
  let prev = '[0:v]';
  let offset = 0;
  for (let i = 1; i < clips.length; i++) {
    offset += clips[i - 1].dur - XF;
    const label = i === clips.length - 1 ? '[o]' : `[x${i}]`;
    filter += `${prev}[${i}:v]xfade=transition=fade:duration=${XF}:offset=${offset.toFixed(3)}${label};`;
    prev = `[x${i}]`;
  }
  const out = path.join(OUT, fmt === 'square' ? 'tally-rounds-reel-1080x1080.mp4' : 'tally-rounds-reel-1920x1080.mp4');
  ff([...args, '-filter_complex', filter.replace(/;$/, ''), '-map', '[o]', '-r', String(FPS), '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
  const total = clips.reduce((n, c) => n + c.dur, 0) - XF * (clips.length - 1);
  console.log(fmt, '→', path.basename(out), total.toFixed(1) + 's');
}

(async () => {
  const browser = await chromium.launch();
  for (const fmt of ['wide', 'square']) {
    const L = await renderPNGs(browser, fmt);
    const clips = SEQUENCE.map((s, i) => (s.card ? cardClip(fmt, i, s.dur) : sceneClip(fmt, L, s, i)));
    join(fmt, clips);
  }
  await browser.close();
})();
