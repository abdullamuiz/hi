// Renders the app icons from SVG using the Playwright Chromium. Run: npm run icons
import { createRequire } from 'node:module';
// Uses an installed Playwright (project or global): npm i -D playwright, or NODE_PATH=$(npm root -g).
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
import { writeFileSync, mkdirSync } from 'node:fs';

const drop = (s) => `<path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z" fill="none" stroke="#FFFFFF" stroke-width="${s}" stroke-linecap="round" stroke-linejoin="round"/>`;
// Full-bleed ink square with a white drop. `pad` shrinks the glyph for maskable safe zone.
const icon = (size, pad, radius) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="${radius}" fill="#16181D"/>
  <g transform="translate(${pad} ${pad}) scale(${(100 - 2 * pad) / 24})">${drop(2)}<circle cx="17.6" cy="4.6" r="1.6" fill="#F2A15F"/><circle cx="20.4" cy="7.9" r="1.1" fill="#2F5BEA"/></g>
</svg>`;
const badge = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24">${drop(2.4).replace('#FFFFFF', '#000000')}</svg>`;

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon.svg', icon(512, 22, 22));
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, svg, transparent] of [
  ['icon-192.png', 192, icon(192, 22, 0), false],
  ['icon-512.png', 512, icon(512, 22, 0), false],
  ['icon-maskable-512.png', 512, icon(512, 30, 0), false],
  ['apple-touch-icon.png', 180, icon(180, 22, 0), false],
  ['badge-96.png', 96, badge, true],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`)}</body></html>`);
  writeFileSync(`public/icons/${name}`, await page.screenshot({ omitBackground: transparent }));
}
await browser.close();
console.log('icons written to public/icons');
