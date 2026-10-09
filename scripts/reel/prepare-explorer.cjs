// Prepares the two files the reel needs before recording:
//
//   fonts.css          IBM Plex (latin) as data URIs. The cards are rendered from
//                      it, and the headless browser can't always reach Google
//                      Fonts, so nothing is fetched at render time.
//   explorer-rec.html  The baseline explorer with those fonts inlined and the
//                      Goals section removed. The reel doesn't show goals.
//
//   node scripts/reel/prepare-explorer.cjs [path/to/explorer.html]
//
// The explorer page isn't in the repo: it embeds export:review data. Pass its
// path, or put it at .reel/tally-explorer.html.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { DIR } = require('./config.cjs');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const FONTS_URL =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Sans+Condensed:wght@400;500;600&display=swap';

// curl rather than fetch: it honours HTTPS_PROXY and the system CA bundle
// without extra flags, which matters in sandboxes.
const css = execSync(`curl -sS -A "${UA}" "${FONTS_URL}"`).toString();
const blocks = css.split('/* ').filter((b) => b.startsWith('latin */'));
let fonts = '';
for (const b of blocks) {
  const body = b.slice(b.indexOf('@font-face'));
  const m = body.match(/url\((https:[^)]+\.woff2)\)/);
  const data = execSync(`curl -sS "${m[1]}"`).toString('base64');
  fonts += body.replace(m[1], `data:font/woff2;base64,${data}`) + '\n';
}
fs.writeFileSync(path.join(DIR, 'fonts.css'), fonts);
console.log(`fonts.css: ${blocks.length} faces, ${(fonts.length / 1024).toFixed(0)} KB`);

const input = process.argv[2] || process.env.EXPLORER_HTML || path.join(DIR, 'tally-explorer.html');
if (!fs.existsSync(input)) {
  console.log(`No explorer page at ${input}; skipping explorer-rec.html. The explorer scene needs it.`);
  process.exit(0);
}

let html = fs.readFileSync(input, 'utf8');
html = html
  .replace(/<link rel="preconnect"[^>]*>\s*/g, '')
  .replace(/<link rel="stylesheet" href="https:\/\/fonts.googleapis.com[^>]*>/, `<style>${fonts}</style>`);
// The reel does not show goals: drop the section, and guard its script so the
// rest of the page still boots without it.
html = html.replace(/<section class="panel" id="p-goals">[\s\S]*?<\/section>/, '');
html = html.replace("(function () {\n  $('#goals').innerHTML", "(function () {\n  if (!$('#goals')) return;\n  $('#goals').innerHTML");

const page = html.startsWith('<!doctype')
  ? html
  : `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`;
fs.writeFileSync(path.join(DIR, 'explorer-rec.html'), page);
console.log(`explorer-rec.html: ${(page.length / 1024).toFixed(0)} KB, goals removed`);
