// Builds public/icons/ from the designer's icon set in design/icons/.
//
//   design/icons/navy/   the app icon set that ships (matches the default "Hi" theme)
//   design/icons/teal/   alternate colourway; its colours are used for the dark-mode favicon
//
// Copies the navy PNGs/SVGs as-is, then generates:
//   favicon.svg              navy bubble, switching to the teal bubble when the browser is in dark mode
//   favicon-16/48.png        raster favicons (32/64 are the designer's); favicon.ico bundles 16, 32 and 48
//   badge-96.png             monochrome bubble for Android notification badges
//
// Run: npm run icons   (needs Playwright's Chromium)
import { createRequire } from 'node:module';
import { copyFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const SRC = 'design/icons/navy';
const OUT = 'public/icons';
mkdirSync(OUT, { recursive: true });

for (const f of [
  'icon-192.png', 'icon-512.png', 'icon-1024.png', 'maskable-192.png', 'maskable-512.png',
  'apple-touch-icon.png', 'android-foreground-432.png', 'favicon-32.png', 'favicon-64.png',
  'bubble.svg', 'ios.svg', 'maskable.svg', 'android-foreground.svg',
]) copyFileSync(`${SRC}/${f}`, `${OUT}/${f}`);

// --- favicon.svg: same artwork, colours as classes so dark mode can swap them.
const NAVY = '#252C48', TEAL_BUBBLE = '#1E7F93', DOT = '#54B5C6', LETTERS = '#F2EFE6';
const navySvg = readFileSync(`${SRC}/favicon.svg`, 'utf8');
const adaptive = navySvg
  .replaceAll(`fill="${NAVY}"`, 'class="b"')
  .replaceAll(`fill="${LETTERS}"`, 'class="l"')
  .replace(`fill="${DOT}"`, 'class="d"')
  .replace(/>/, `><style>.b{fill:${NAVY}}.l{fill:${LETTERS}}.d{fill:${DOT}}` +
    `@media (prefers-color-scheme:dark){.b{fill:${TEAL_BUBBLE}}.d{fill:${NAVY}}}</style>`);
if (/fill="#/.test(adaptive.replace(/<style>.*<\/style>/, ''))) throw new Error('favicon.svg: unexpected colours in source');
writeFileSync(`${OUT}/favicon.svg`, adaptive);

// --- rasters
const sized = (svg, n) => svg.replace(/width="\d+" height="\d+"/, `width="${n}" height="${n}"`);
const bubblePaths = [...navySvg.matchAll(/<(rect|path)[^>]*fill="#252C48"[^>]*\/>/g)].map((m) => m[0].replace(/fill="#252C48"/, 'fill="#000"'));
const badge = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${bubblePaths.join('')}</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
async function png(svg, n) {
  await page.setViewportSize({ width: n, height: n });
  await page.setContent(`<html><body style="margin:0;background:transparent">${sized(svg, n)}</body></html>`);
  return page.screenshot({ omitBackground: true });
}
// 32 and 64 come hand-tuned from the designer; render only the missing sizes.
const fav = { 32: readFileSync(`${SRC}/favicon-32.png`) };
for (const n of [16, 48]) {
  fav[n] = await png(navySvg, n);
  writeFileSync(`${OUT}/favicon-${n}.png`, fav[n]);
}
writeFileSync(`${OUT}/badge-96.png`, await png(badge, 96));
await browser.close();

// --- favicon.ico: an ICO container holding PNG images (supported by every current browser).
const imgs = [16, 32, 48].map((n) => ({ n, data: fav[n] }));
const header = Buffer.alloc(6 + 16 * imgs.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(imgs.length, 4);
let offset = header.length;
imgs.forEach(({ n, data }, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(n, e); header.writeUInt8(n, e + 1); header.writeUInt8(0, e + 2); header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(data.length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += data.length;
});
writeFileSync('public/favicon.ico', Buffer.concat([header, ...imgs.map((x) => x.data)]));
console.log('icons written to public/icons and public/favicon.ico');
