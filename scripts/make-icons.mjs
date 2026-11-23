// Rasterises the app icons from the SVG sources in public/icons/:
//   logo.svg           the "Hi" bubble on its own (favicon, in-app brand mark)
//   icon.svg           app icon: bubble on alabaster (iOS / Android / PWA)
//   icon-maskable.svg  same, shrunk into Android's maskable safe zone
// The letters are outlines of DM Serif Display (SIL Open Font License), so no font is needed at runtime.
// Run: npm run icons   (needs Playwright's Chromium)
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const src = (f) => readFileSync(`public/icons/${f}`, 'utf8');
const sized = (svg, n) => svg.replace('<svg ', `<svg width="${n}" height="${n}" `);
// Notification badge: Android uses only the alpha channel, so a plain bubble silhouette.
const bubble = src('logo.svg').match(/<path d="([^"]+)" fill="#232B47"\/>/)[1];
const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${bubble}" fill="#000"/></svg>`;

const jobs = [
  ['icon-192.png', 192, src('icon.svg'), false],
  ['icon-512.png', 512, src('icon.svg'), false],
  ['icon-maskable-512.png', 512, src('icon-maskable.svg'), false],
  ['apple-touch-icon.png', 180, src('icon.svg'), false],
  ['favicon-32.png', 32, src('logo.svg'), true],
  ['badge-96.png', 96, badge, true],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, svg, transparent] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${sized(svg, size)}</body></html>`);
  writeFileSync(`public/icons/${name}`, await page.screenshot({ omitBackground: transparent }));
}
await browser.close();
console.log('icons written to public/icons');
