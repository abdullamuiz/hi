// End-to-end: two people sign in (email link), pair up, chat and play every Drop.
// Runs against the Emulator Suite:  npm run test:e2e
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const AUTH = 'http://127.0.0.1:9099';
const PROJECT = 'demo-drops';
const SHOTS = process.env.SHOTS_DIR || 'test-results/e2e';
mkdirSync(SHOTS, { recursive: true });

// Never let the e2e run talk to the real Firebase project.
process.env.VITE_USE_EMULATORS = 'true';
const server = await createServer({ server: { host: '127.0.0.1', port: 5174, strictPort: true }, logLevel: 'error' });
await server.listen();
const APP = 'http://127.0.0.1:5174/';

await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });

const browser = await chromium.launch();
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };

const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` });

async function person(email) {
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[${email}] pageerror`, e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error(`[${email}] console.${m.type()}`, m.text().slice(0, 300)); });
  await page.goto(APP);
  if (email.startsWith('alice')) {
    await shot(page, 'sign-in');
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await shot(page, 'sign-in-dark');
    await page.getByRole('button', { name: 'Switch to light mode' }).click();
  }
  await page.getByRole('button', { name: /Use e-mail instead/ }).click();
  await page.getByLabel('E-mail me a sign-in link').fill(email);
  await page.getByRole('button', { name: 'Send link' }).click();
  await page.getByText(`Link sent to ${email}`).waitFor();
  const { oobCodes } = await (await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/oobCodes`)).json();
  const code = oobCodes.filter((c) => c.email === email).pop();
  const link = new URL(code.oobLink);
  await page.goto(`${APP}?mode=signIn&oobCode=${link.searchParams.get('oobCode')}&apiKey=demo-key&lang=en`);
  return page;
}

const step = (s) => console.log('•', s);

try {
  step('Alice starts alone, writes, and invites Bob later');
  const alice = await person('alice@example.com');
  await alice.getByRole('button', { name: 'Skip, invite later' }).click();
  await alice.getByText('It’s just you here for now.').waitFor();
  await alice.locator('.hdr-name', { hasText: 'Just you' }).waitFor();
  await alice.getByRole('textbox', { name: 'Message' }).fill('Note to self: invite Bob');
  await alice.keyboard.press('Enter');
  await alice.getByText('Note to self: invite Bob').waitFor();
  await shot(alice, 'solo-room');
  await alice.getByRole('button', { name: 'Invite someone' }).click();
  await alice.getByLabel(/Their e-mail/).fill('alice@example.com');
  await alice.getByRole('button', { name: 'Save invite' }).click();
  await alice.getByText('That’s your own address').waitFor();
  await alice.getByLabel(/Their e-mail/).fill('bob@example.com');
  await alice.getByRole('button', { name: 'Save invite' }).click();
  await alice.getByText('Invited bob@example.com').waitFor();
  await shot(alice, 'invite-sheet');
  await alice.getByRole('button', { name: 'Done' }).click();
  await alice.getByText('Waiting for bob@example.com to join').waitFor();

  step('Eve signs in and sees no invite');
  const eve = await person('eve@example.com');
  await eve.getByText('Start your room').waitFor();
  assert.equal(await eve.getByText(/invited you/).count(), 0);

  step('Bob signs in and joins, and sees what Alice wrote before');
  const bob = await person('bob@example.com');
  await bob.getByRole('button', { name: /Join alice/i }).click();
  await bob.getByRole('textbox', { name: 'Message' }).waitFor();
  await bob.getByText('Note to self: invite Bob').waitFor();
  await bob.locator('.hdr-name', { hasText: 'alice' }).waitFor();
  await alice.locator('.hdr-name', { hasText: 'bob' }).waitFor();
  assert.equal(await alice.getByText('It’s just you here for now.').count(), 0);

  step('Text messages sync both ways');
  await alice.getByRole('textbox', { name: 'Message' }).fill('Finally finished Interstellar last night');
  await alice.getByRole('button', { name: 'Send', exact: true }).click();
  await bob.getByText('Finally finished Interstellar last night').waitFor();
  await bob.getByRole('textbox', { name: 'Message' }).fill('Same! I have thoughts. Lots of them.');
  await bob.keyboard.press('Enter');
  await alice.getByText('Same! I have thoughts.').waitFor();

  step('Tabs: create, unread count, open, rename, archive');
  await alice.getByRole('button', { name: 'New tab' }).click();
  await alice.getByLabel('Name').fill('Trip plans');
  await alice.getByRole('radio', { name: '#1E7F93' }).click();
  await alice.getByRole('button', { name: 'Create tab' }).click();
  await alice.getByRole('tab', { name: /Trip plans/, selected: true }).waitFor();
  await alice.getByRole('textbox', { name: 'Message' }).fill('Flights are cheap in March');
  await alice.keyboard.press('Enter');
  await alice.getByText('Flights are cheap in March').waitFor();
  await bob.getByRole('tab', { name: 'Trip plans, 1 unread' }).waitFor();
  assert.equal(await bob.getByText('Flights are cheap in March').count(), 0, 'other tab messages stay out of General');
  await shot(bob, 'tabs-unread');
  await bob.getByRole('tab', { name: /Trip plans/ }).click();
  await bob.getByText('Flights are cheap in March').waitFor();
  await bob.getByRole('tab', { name: /Trip plans.*options/ }).click();
  await bob.getByLabel('Name').fill('Trip');
  await bob.getByRole('button', { name: 'Save' }).click();
  await alice.getByRole('tab', { name: /^Trip \(tap/ }).waitFor();
  await alice.getByRole('tab', { name: /^Trip/ }).click();
  await alice.getByRole('button', { name: 'Archive tab' }).click();
  await alice.getByRole('tab', { name: /General/, selected: true }).waitFor();
  await alice.getByRole('button', { name: 'Archived · 1' }).waitFor();
  await bob.getByRole('tab', { name: /General/ }).click();
  await bob.getByRole('button', { name: 'Archived · 1' }).waitFor();
  await alice.getByText('Same! I have thoughts.').waitFor();

  step('Link card');
  await bob.getByRole('textbox', { name: 'Message' }).fill('Rewatching this before we talk https://www.youtube.com/watch?v=zSWdZVtXT7E');
  await bob.keyboard.press('Enter');
  await alice.getByText('Rewatching this before we talk').waitFor();
  assert.equal(await bob.getByRole('textbox', { name: 'Message' }).inputValue(), '', 'composer clears after send');
  await alice.getByText('youtube.com').first().waitFor();

  step('Photo upload (compressed client-side) shows for the partner');
  const png = await alice.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 3000; c.height = 2000;
    const g = c.getContext('2d'); g.fillStyle = '#DCE6F5'; g.fillRect(0, 0, 3000, 2000); g.fillStyle = '#F2A15F'; g.beginPath(); g.arc(2200, 600, 260, 0, 7); g.fill();
    return c.toDataURL('image/png').split(',')[1];
  });
  await alice.getByRole('textbox', { name: 'Message' }).fill('Cinema snacks were elite');
  await alice.locator('input[type=file]').setInputFiles({ name: 'snacks.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await bob.getByText('Cinema snacks were elite').waitFor();
  const img = bob.locator('.photo-btn img').first();
  await img.waitFor();
  const natural = await img.evaluate((el) => new Promise((r) => (el.complete ? r([el.naturalWidth, el.naturalHeight]) : el.addEventListener('load', () => r([el.naturalWidth, el.naturalHeight])))));
  assert.deepEqual(natural, [1600, 1067], 'photo should be scaled to 1600px');

  step('Blind Reveal: answers stay hidden until both lock in');
  await bob.getByRole('button', { name: 'Add a Drop' }).click();
  await bob.locator('.tray-item', { hasText: 'Blind Reveal' }).click();
  await bob.getByRole('button', { name: 'Drop it' }).click();
  const bobCard = bob.getByRole('region', { name: 'Blind Reveal' });
  const aliceCard = alice.getByRole('region', { name: 'Blind Reveal' });
  await aliceCard.waitFor();
  await bobCard.getByPlaceholder('Your answer, kept private').fill('Hopeful');
  await bobCard.getByRole('button', { name: 'Lock in & flip' }).click();
  await aliceCard.getByText('bob has answered · hidden').waitFor();
  assert.equal(await aliceCard.getByText('Hopeful').count(), 0);
  await bobCard.getByText('Flips when they lock in').waitFor();
  await aliceCard.getByPlaceholder('Your answer, kept private').fill('Wrecked');
  await aliceCard.getByRole('button', { name: 'Lock in & flip' }).click();
  await aliceCard.getByText('Hopeful').waitFor();
  await bobCard.getByText('Wrecked').waitFor();

  step('Gap Slider');
  await alice.getByRole('button', { name: 'Add a Drop' }).click();
  await alice.locator('.tray-item', { hasText: 'Gap Slider' }).click();
  await alice.getByRole('button', { name: 'Drop it' }).click();
  const gA = alice.getByRole('region', { name: 'Gap Slider' });
  const gB = bob.getByRole('region', { name: 'Gap Slider' });
  await gB.waitFor();
  await gA.getByLabel('Your take').fill('20');
  await gA.getByRole('button', { name: 'Lock my take' }).click();
  await gB.getByLabel('Your take').fill('82');
  await gB.getByRole('button', { name: 'Lock my take' }).click();
  await gA.getByText('62', { exact: true }).waitFor();
  await gB.getByText('points apart. Big gap.', { exact: false }).waitFor();

  step('Feeling Map, scene 1');
  await bob.getByRole('button', { name: 'Add a Drop' }).click();
  await bob.locator('.tray-item', { hasText: 'Feeling Map' }).click();
  await bob.getByLabel('What did you watch?').fill('Interstellar');
  await bob.getByLabel('Scenes (one per line)').fill("Leaving Earth\nMiller's planet");
  await bob.getByRole('button', { name: 'Drop it' }).click();
  const fA = alice.getByRole('region', { name: 'Feeling Map' });
  const fB = bob.getByRole('region', { name: 'Feeling Map' });
  await fA.waitFor();
  await fA.getByRole('button', { name: /Mood grid/ }).click({ position: { x: 80, y: 100 } });
  await fA.getByRole('button', { name: 'Lock in & reveal' }).click();
  await fB.getByText('alice placed their dot · hidden until you lock in').waitFor();
  await fB.getByRole('button', { name: /Mood grid/ }).click({ position: { x: 260, y: 40 } });
  await fB.getByRole('button', { name: 'Lock in & reveal' }).click();
  await fB.locator('.dot.them').waitFor();
  await fA.locator('.dot.them').waitFor();
  await shot(alice, 'feeling-map-revealed');
  for (const [p, f] of [[alice, fA], [bob, fB]]) {
    await f.getByRole('button', { name: 'Next scene' }).click();
    await f.getByRole('button', { name: /Mood grid/ }).click({ position: { x: p === alice ? 300 : 60, y: 150 } });
    await f.getByRole('button', { name: 'Lock in & reveal' }).click();
  }
  await fA.getByRole('button', { name: 'See summary' }).click();
  await fA.getByText('You felt most differently at').waitFor();

  step('Tag-team Story');
  await alice.getByRole('button', { name: 'Add a Drop' }).click();
  await alice.locator('.tray-item', { hasText: 'Tag-team Story' }).click();
  await alice.getByRole('button', { name: 'Drop it' }).click();
  const sB = bob.getByRole('region', { name: 'Tag-team Story' });
  await sB.getByText('The ship drifted past the last moon').waitFor();
  await sB.getByPlaceholder('Write the next line…').fill('Then the radio crackled.');
  await sB.getByRole('button', { name: 'Add' }).click();
  await alice.getByRole('region', { name: 'Tag-team Story' }).getByText('Then the radio crackled.').waitFor();
  await sB.getByText('alice is writing the next line…').waitFor();

  step('Pin to scrapbook shows for both');
  await bobCard.getByRole('button', { name: 'Pin to scrapbook' }).click();
  await alice.locator('.badge', { hasText: '1' }).waitFor();
  await aliceCard.getByText('Pinned').waitFor();

  step('Mood weather');
  await alice.getByRole('button', { name: /Your mood weather/ }).click();
  await shot(alice, 'mood-sheet');
  await alice.getByRole('button', { name: /Stormy/ }).click();
  await bob.getByText(/Stormy · online/).waitFor();
  await bob.getByRole('img', { name: "alice's mood: Stormy" }).waitFor();
  await alice.getByRole('button', { name: 'Your mood weather: Stormy. Change it' }).waitFor();
  await shot(bob, 'header-their-mood');

  step('Light/dark toggle, themes and icons');
  const state = (p) => p.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    mode: document.documentElement.dataset.mode,
    favicon: document.querySelector('link[rel="icon"][type="image/svg+xml"]').getAttribute('href'),
  }));
  assert.deepEqual(await state(alice), { theme: 'hi-light', mode: 'light', favicon: './icons/favicon-teal.svg' });
  await shot(alice, 'theme-hi');
  await alice.getByRole('button', { name: 'Switch to dark mode' }).click();
  assert.deepEqual(await state(alice), { theme: 'hi-dark', mode: 'dark', favicon: './icons/favicon-navy.svg' });
  await shot(alice, 'theme-dark');
  await alice.getByRole('button', { name: 'Settings' }).click();
  await alice.getByRole('radio', { name: /^Hi/, checked: true }).waitFor();
  await alice.getByRole('radio', { name: 'Dark', checked: true }).waitFor();
  await shot(alice, 'settings-dark');
  // Another palette keeps the chosen mode: Forest dark.
  await alice.getByRole('radio', { name: /Forest/ }).click();
  assert.equal((await state(alice)).theme, 'forest-dark');
  await shot(alice, 'settings-forest-dark');
  await alice.getByRole('radio', { name: /^Hi/ }).click();
  await alice.keyboard.press('Escape');
  // The choice follows the account: alice reloads and is still dark; bob is unaffected.
  await alice.reload();
  await alice.getByRole('textbox', { name: 'Message' }).waitFor();
  assert.equal((await state(alice)).mode, 'dark');
  assert.equal((await state(bob)).mode, 'light', "bob's theme is his own");
  await alice.getByRole('button', { name: 'Switch to light mode' }).click();
  assert.equal((await state(alice)).mode, 'light');
  await alice.getByRole('button', { name: 'Switch to dark mode' }).click();

  step('Pull down at the top of the chat to refresh');
  await alice.evaluate(() => { document.querySelector('.feed').scrollTop = 0; });
  {
    const cdp = await alice.context().newCDPSession(alice);
    const box = await alice.locator('.feed').boundingBox();
    const x = box.x + box.width / 2;
    const y0 = box.y + 20;
    const reloaded = alice.waitForEvent('framenavigated');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + i * 25 }] });
    await alice.locator('.ptr', { hasText: 'Release to refresh' }).waitFor();
    await shot(alice, 'pull-to-refresh');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await reloaded;
    await alice.getByRole('textbox', { name: 'Message' }).waitFor();
  }

  step('Outsider cannot see anything');
  await eve.reload();
  await eve.getByText('Start your room').waitFor();

  await bob.evaluate(() => document.querySelector('.feed').scrollTo(0, 0));
  await shot(bob, 'bob-top');
  await alice.evaluate(() => { const f = document.querySelector('.feed'); f.scrollTop = f.scrollHeight; });
  await shot(alice, 'alice-bottom');
  await alice.getByRole('button', { name: 'Add a Drop' }).click();
  await shot(alice, 'tray');
  await alice.keyboard.press('Escape');
  await alice.getByRole('button', { name: 'Open scrapbook' }).click();
  await shot(alice, 'scrapbook');
  console.log('\nE2E PASSED — screenshots in', SHOTS);
} catch (e) {
  console.error('\nE2E FAILED:', e);
  for (const [i, c] of browser.contexts().entries()) for (const p of c.pages()) await p.screenshot({ path: `${SHOTS}/failure-${i}.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
