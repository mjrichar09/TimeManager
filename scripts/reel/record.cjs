// Scripted recordings for the reel. Every take is identical and can be re-shot.
// Phone scenes run against the local dev server, which should be pointed at a
// Neon branch: the takes tap categories, drag edges, finish chores and save a
// plan. See scripts/reel/README.md.
//
//   node scripts/reel/record.cjs                 every scene
//   node scripts/reel/record.cjs plan,explorer   just those
const fs = require('fs');
const path = require('path');
const { DIR, BASE, password, planWeek, addDays, playwright } = require('./config.cjs');

const { chromium } = playwright();
const RAW = path.join(DIR, 'raw');
const WEEK = planWeek();
fs.mkdirSync(RAW, { recursive: true });
const only = process.argv[2] ? process.argv[2].split(',') : null;

// Tap ripple on the phone, an arrow cursor on desktop. Injected before any page script.
const INDICATOR = (mode) => `
(() => {
  const mode = ${JSON.stringify(mode)};
  const install = () => {
    const st = document.createElement('style');
    st.textContent = \`
      .reel-tap{position:fixed;z-index:2147483647;pointer-events:none;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;
        background:rgba(20,20,20,.18);border:2px solid rgba(20,20,20,.55);transform:scale(.6);opacity:0;transition:transform .18s ease-out,opacity .25s}
      .reel-tap.on{transform:scale(1);opacity:1}
      @media (prefers-color-scheme: dark){.reel-tap{background:rgba(255,255,255,.2);border-color:rgba(255,255,255,.7)}}
      .reel-cursor{position:fixed;z-index:2147483647;pointer-events:none;left:0;top:0;width:22px;height:22px;transform:translate(-2px,-2px)}
      .reel-cursor.down svg{transform:scale(.88);transform-origin:2px 2px}
      nextjs-portal{display:none!important}
    \`;
    document.documentElement.appendChild(st);
    if (mode === 'phone') {
      const dot = document.createElement('div'); dot.className = 'reel-tap'; document.documentElement.appendChild(dot);
      addEventListener('pointerdown', (e) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; dot.classList.add('on'); }, true);
      addEventListener('pointermove', (e) => { if (dot.classList.contains('on')) { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; } }, true);
      addEventListener('pointerup', () => setTimeout(() => dot.classList.remove('on'), 120), true);
    } else {
      const c = document.createElement('div'); c.className = 'reel-cursor';
      c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M2 2 L2 18 L6.5 13.8 L9.6 20.4 L12.4 19.2 L9.3 12.7 L15.5 12.7 Z" fill="#141414" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
      document.documentElement.appendChild(c);
      addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
      addEventListener('mousedown', () => c.classList.add('down'), true);
      addEventListener('mouseup', () => c.classList.remove('down'), true);
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function smoothScroll(page, to, ms = 1200) {
  await page.evaluate(([to, ms]) => new Promise((res) => {
    const from = scrollY, t0 = performance.now();
    const ease = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (now) => { const t = Math.min(1, (now - t0) / ms); scrollTo(0, from + (to - from) * ease(t)); if (t < 1) requestAnimationFrame(step); else res(); };
    requestAnimationFrame(step);
  }), [to, ms]);
}

/** Glide the pointer to a point, the way a hand moves, not a teleport. */
let cur = { x: 200, y: 600 };
async function glide(page, x, y, ms = 500) {
  const steps = Math.max(8, Math.round(ms / 16));
  const from = { ...cur };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    await sleep(ms / steps);
  }
  cur = { x, y };
}
async function tapAt(page, x, y, move = 450) {
  await glide(page, x, y, move);
  await sleep(90);
  await page.mouse.down(); await sleep(110); await page.mouse.up();
}
async function tap(page, locator, move) {
  const b = await locator.boundingBox();
  if (!b) throw new Error('no box for ' + locator);
  await tapAt(page, b.x + b.width / 2, b.y + b.height / 2, move);
}
async function drag(page, from, to, ms = 1200) {
  await glide(page, from.x, from.y, 400);
  await sleep(120);
  await page.mouse.down();
  await sleep(150);
  await glide(page, to.x, to.y, ms);
  await sleep(250);
  await page.mouse.up();
}

const marks = fs.existsSync(path.join(RAW, 'marks.json')) ? JSON.parse(fs.readFileSync(path.join(RAW, 'marks.json'))) : {};

/**
 * One take. Frames come from Chrome's screencast at full device resolution
 * (Playwright's own recorder captures at 1x). Chrome only sends a frame when
 * the page changes, so each frame keeps its timestamp and the assembler holds
 * it until the next one.
 */
async function scene(browser, name, kind, storage, run) {
  if (only && !only.includes(name)) return;
  const phone = kind === 'phone';
  const ctx = await browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 810 },
    deviceScaleFactor: phone ? 1.25 : 1,
    timezoneId: 'America/New_York',
    colorScheme: 'light',
    storageState: storage,
  });
  await ctx.addInitScript(INDICATOR(kind));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 160)));
  cur = phone ? { x: 300, y: 700 } : { x: 1300, y: 700 };

  const dir = path.join(RAW, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  let recording = false;
  let loop = null;
  let stopAt = 0;
  // A tight loop of full-resolution captures. Chrome's screencast would be
  // cheaper but delivers frames at 1x under device emulation.
  const grab = async () => {
    while (recording) {
      const t = Date.now() / 1000;
      const vp = page.viewportSize();
      const { x, y } = await cdp.send('Runtime.evaluate', { expression: '({x: scrollX, y: scrollY})', returnByValue: true }).then((r) => r.result.value);
      const r = await cdp.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 90,
        clip: { x, y, width: vp.width, height: vp.height, scale: phone ? 1.25 : 1 },
      });
      const file = path.join(dir, `${String(frames.length).padStart(5, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      frames.push({ file, t });
    }
  };
  const notes = {};
  let startWall = 0;
  const mark = {
    note: (k) => { notes[k] = +(Date.now() / 1000 - startWall).toFixed(2); },
    start: async () => {
      recording = true;
      startWall = Date.now() / 1000;
      loop = grab();
    },
    end: async () => {
      stopAt = Date.now() / 1000;
      recording = false;
      await loop;
    },
  };
  await run(page, mark);
  await ctx.close();

  // ffmpeg concat list: each frame held until the next arrives.
  const lines = [];
  frames.forEach((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : stopAt;
    lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
  });
  lines.push(`file '${frames[frames.length - 1].file}'`);
  fs.writeFileSync(path.join(dir, 'list.txt'), lines.join('\n'));
  const dur = stopAt - frames[0].t;
  marks[name] = { kind, frames: frames.length, duration: +dur.toFixed(2), notes };
  console.log(name, marks[name], errs.length ? errs : '');
}

(async () => {
  const browser = await chromium.launch();

  // Log in once and warm every route, so no take records a compile. The
  // explorer is a local file and needs neither.
  let storage;
  if (!only || only.some((n) => n !== 'explorer')) {
  const login = await browser.newContext({ timezoneId: 'America/New_York' });
  const lp = await login.newPage();
  await lp.goto(BASE + '/login');
  await lp.fill('#password', password());
  await lp.click('button[type=submit]');
  await lp.waitForLoadState('networkidle');
  for (const r of ['/tally', '/tally/reconcile', '/rounds', '/rounds/plan', '/rounds/renewals']) {
    await lp.goto(BASE + r, { waitUntil: 'networkidle', timeout: 120000 });
  }
  storage = await login.storageState();
  await login.close();
  }

  await scene(browser, 'capture', 'phone', storage, async (page, mark) => {
    await page.goto(BASE + '/tally', { waitUntil: 'networkidle' });
    await sleep(1800);
    await mark.start();
    await sleep(2200);
    // Whatever is open from an earlier take, tap the other one.
    const openText = await page.locator('main button:disabled').first().innerText();
    const target = openText.startsWith('Household chores') ? /^Personal fun/ : /^Household chores/;
    await tap(page, page.getByRole('button', { name: target }), 700);
    await sleep(3300);
    await mark.end();
  });

  await scene(browser, 'reconcile', 'phone', storage, async (page, mark) => {
    await page.goto(BASE + '/tally/reconcile', { waitUntil: 'networkidle' });
    await sleep(1800);
    await mark.start();
    await sleep(900);
    // The longest closed block among the evening's last few, so the drag and the
    // split have room whatever earlier takes did to the day.
    const pieces = page.locator('main .rounded-\\[4px\\] > button');
    const n = await pieces.count();
    let best = null, bestW = 0;
    for (let i = Math.max(0, n - 9); i < n - 1; i++) {
      const b = await pieces.nth(i).boundingBox();
      const label = await pieces.nth(i).getAttribute('aria-label');
      if (b && b.width > bestW && !label.startsWith('Nothing')) { best = pieces.nth(i); bestW = b.width; }
    }
    await tap(page, best, 600);
    await sleep(1100);
    const h = await page.getByRole('button', { name: 'Drag the end' }).boundingBox();
    await drag(page, { x: h.x + h.width / 2, y: h.y + h.height / 2 }, { x: h.x + h.width / 2 - 42, y: h.y + h.height / 2 }, 1300);
    await sleep(1600);
    // Tap the tape inside the block to place the split, then split.
    const s = await page.getByRole('button', { name: 'Drag the start' }).boundingBox();
    const e = await page.getByRole('button', { name: 'Drag the end' }).boundingBox();
    await tapAt(page, s.x + (e.x - s.x) * 0.62 + 16, s.y + s.height * 0.75, 600);
    await sleep(900);
    await tap(page, page.getByRole('button', { name: /^Split at/ }), 600);
    await sleep(1500);
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.no-scrollbar')].pop();
      const target = [...row.querySelectorAll('button')].find((b) => b.textContent.includes('Social / family'));
      row.scrollTo({ left: target.offsetLeft - 40, behavior: 'smooth' });
    });
    await sleep(900);
    await tap(page, page.locator('section').getByRole('button', { name: 'Social / family', exact: true }), 600);
    // Hold until the save lands and the heading reads the new category.
    await page.locator('section h2', { hasText: 'Social / family' }).waitFor({ timeout: 15000 });
    await sleep(1600);
    await mark.end();
  });

  await scene(browser, 'today', 'phone', storage, async (page, mark) => {
    await page.goto(BASE + '/rounds', { waitUntil: 'networkidle' });
    await sleep(1500);
    await mark.start();
    await sleep(1300);
    await tap(page, page.locator('button[aria-label^="Time "]:enabled').first(), 700);
    await sleep(3600);
    await tap(page, page.getByRole('button', { name: 'STOP' }), 600);
    await sleep(2600);
    await mark.end();
  });

  await scene(browser, 'plan', 'phone', storage, async (page, mark) => {
    // Next week, cleared off camera, so the take shows the planner filling it.
    await page.goto(BASE + '/rounds/plan?week=' + WEEK, { waitUntil: 'networkidle' });
    await sleep(1200);
    for (const day of await page.locator('[data-day]').all()) {
      await day.click();
      for (let guard = 0; guard < 20; guard++) {
        const remove = page.locator('button[aria-label^="Remove "]').first();
        if (!(await remove.count())) break;
        await remove.click();
      }
    }
    await page.locator(`[data-day="${WEEK}"]`).click();
    await page.evaluate(() => scrollTo(0, 0));
    await sleep(900);
    await mark.start();
    await sleep(1600);
    await tap(page, page.getByRole('button', { name: 'Suggest again' }), 700);
    await page.locator('button[aria-label^="Remove "]').first().waitFor({ timeout: 15000 }).catch(() => {});
    await sleep(2200);
    await tap(page, page.locator(`[data-day="${addDays(WEEK, 5)}"]`), 650);
    await sleep(1800);
    await tap(page, page.getByRole('button', { name: 'Save this plan' }), 650);
    await sleep(2000);
    await mark.end();
  });

  await scene(browser, 'renewals', 'phone', storage, async (page, mark) => {
    await page.goto(BASE + '/rounds/renewals', { waitUntil: 'networkidle' });
    await sleep(1500);
    await mark.start();
    await sleep(1500);
    await smoothScroll(page, 330, 1600);
    await sleep(2200);
    await mark.end();
  });

  await scene(browser, 'explorer', 'desktop', undefined, async (page, mark) => {
    await page.goto('file://' + path.join(DIR, 'explorer-rec.html'), { waitUntil: 'load' });
    await sleep(2400);
    await mark.start();
    await sleep(2600);
    const top = async (sel, off = 24) => page.evaluate(([sel, off]) => document.querySelector(sel).getBoundingClientRect().top + scrollY - off, [sel, off]);
    await smoothScroll(page, await top('#p-cats'), 1300);
    await sleep(700);
    await tap(page, page.getByRole('button', { name: /^Media \/ scroll:/ }), 800);
    await sleep(2800);
    await smoothScroll(page, await top('#p-weeks'), 1400);
    await sleep(700);
    await tap(page, page.getByRole('button', { name: 'Compare week of Aug 31' }), 800);
    await sleep(1400);
    await smoothScroll(page, await top('#week-lens', 160), 1000);
    await sleep(2400);
    await smoothScroll(page, await top('#p-energy'), 1300);
    await sleep(700);
    await tap(page, page.locator('#en-hl button[data-v="moved"]'), 700);
    await sleep(2600);
    mark.note('cut');
    await smoothScroll(page, await top('#p-disp'), 1300);
    await sleep(2800);
    await smoothScroll(page, await top('#p-buy'), 1300);
    await sleep(700);
    const r = await page.locator('#pct-household-chores').boundingBox();
    await drag(page, { x: r.x + r.width - 6, y: r.y + r.height / 2 }, { x: r.x + r.width * 0.5, y: r.y + r.height / 2 }, 1100);
    await sleep(2800);
    await mark.end();
  });

  fs.writeFileSync(path.join(RAW, 'marks.json'), JSON.stringify(marks, null, 2));
  await browser.close();
})();
