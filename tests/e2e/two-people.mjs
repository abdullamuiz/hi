// End-to-end: people sign in (email link), add each other as contacts (share link and
// e-mail invite), chat, use every message action and play every Drop.
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

// A fake microphone (a steady tone) so voice notes can be recorded headless.
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };

const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` });

async function person(email, startUrl = APP) {
  const ctx = await browser.newContext({ ...phone, permissions: ['clipboard-read', 'clipboard-write', 'microphone'] });
  // Today's question stays off until its own step, so it doesn't shift the other checks.
  await ctx.addInitScript(() => { if (localStorage.getItem('hi.daily.e2e') !== 'on') localStorage.setItem('hi.daily.off', '1'); });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[${email}] pageerror`, e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error(`[${email}] console.${m.type()}`, m.text().slice(0, 300)); });
  await page.goto(startUrl);
  if (email.startsWith('alice')) {
    // Opening screen: Hi is drawn, the dot bounces, then the app opens through the dot.
    assert.equal(await page.locator('#splash').getAttribute('class'), 'play');
    await page.waitForTimeout(1200);
    await shot(page, 'splash-drawing');
    await page.locator('#splash').waitFor({ state: 'detached', timeout: 8000 });
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
  await page.locator('#splash').waitFor({ state: 'detached', timeout: 15000 });
  // First sign-in: profile setup. The name starts as the part of the e-mail before @.
  await page.getByText('Set up your profile').waitFor();
  assert.equal(await page.getByLabel('Your name').inputValue(), email.split('@')[0]);
  if (email.startsWith('alice')) {
    await page.locator('input[aria-label="Profile photo file"]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(AVATAR_PNG, 'base64') });
    await page.getByRole('button', { name: 'Remove photo' }).waitFor();
    await page.getByLabel('About').fill('Tea first, then talk');
    await shot(page, 'profile-setup');
  }
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('Set up your profile').waitFor({ state: 'detached' });
  return page;
}

const step = (s) => console.log('•', s);

// A small, colourful square for the profile photo.
const AVATAR_PNG = await (async () => {
  const p = await (await browser.newContext()).newPage();
  const b64 = await p.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 400;
    const g = c.getContext('2d'); g.fillStyle = '#1E7F93'; g.fillRect(0, 0, 600, 400); g.fillStyle = '#F2EFE6'; g.beginPath(); g.arc(300, 200, 120, 0, 7); g.fill();
    return c.toDataURL('image/png').split(',')[1];
  });
  await p.context().close();
  return b64;
})();

try {
  step('Alice adds a contact with a share link and writes before anyone joins');
  const alice = await person('alice@example.com');
  await alice.getByText('Start your first chat').waitFor();
  await shot(alice, 'chats-empty');
  await alice.getByRole('button', { name: 'Add contact' }).click();
  await alice.getByLabel('Their e-mail (optional)').fill('alice@example.com');
  await alice.getByRole('button', { name: 'Create invite link' }).click();
  await alice.getByText('That’s your own address').waitFor();
  await alice.getByLabel('Their e-mail (optional)').fill('');
  await alice.getByRole('button', { name: 'Create invite link' }).click();
  await alice.getByText('Invite ready').waitFor();
  const bobLink = (await alice.getByLabel('Invite link', { exact: true }).textContent()).trim();
  assert.match(bobLink, /\?join=[\w-]+&code=[\w-]{16,}&from=alice&u=/);
  await alice.getByRole('button', { name: 'Copy link' }).click();
  await alice.getByRole('status').filter({ hasText: 'Copied' }).waitFor();
  assert.equal(await alice.evaluate(() => navigator.clipboard.readText()), bobLink);
  await shot(alice, 'invite-ready');
  await alice.getByRole('button', { name: 'Open the chat' }).click();
  await alice.getByText('It’s just you here for now.').waitFor();
  await alice.locator('.hdr-name', { hasText: 'Just you' }).waitFor();
  await alice.getByRole('textbox', { name: 'Message' }).fill('Note to self: invite Bob');
  await alice.keyboard.press('Enter');
  await alice.getByText('Note to self: invite Bob').waitFor();
  await shot(alice, 'solo-room');
  await alice.getByRole('button', { name: 'Back to chats' }).click();
  await alice.getByText('Invite link not used yet').waitFor();

  step('Eve signs in and sees no invite');
  const eve = await person('eve@example.com');
  await eve.getByText('Start your first chat').waitFor();
  assert.equal(await eve.getByText(/invited you/).count(), 0);

  step('Notes to self: Eve turns a waiting chat into hers; no invite, no ticks, only solo Drops, a reminder to self');
  // Everyone gets one automatically, at the top of the list.
  await eve.locator('.chat-row.self-row', { hasText: 'Notes to self' }).waitFor();
  assert.equal(await eve.locator('.chat-row').first().evaluate((el) => el.classList.contains('self-row')), true, 'Notes to self is first');
  // Eve starts a chat, then keeps it for herself instead: the invite link stops working.
  await eve.getByRole('button', { name: 'Add contact' }).click();
  await eve.getByRole('button', { name: 'Create invite link' }).click();
  await eve.getByText('Invite ready').waitFor();
  const eveLink = (await eve.getByLabel('Invite link', { exact: true }).textContent()).trim();
  await eve.keyboard.press('Escape');
  await eve.getByRole('button', { name: /^Share the invite/ }).click();
  await eve.getByRole('button', { name: '📝 Make this my Notes to self' }).click();
  await eve.getByRole('status').filter({ hasText: 'This is now your Notes to self' }).waitFor();
  // The empty automatic one goes, so there's exactly one, and no chat waits for anyone.
  await eve.waitForFunction(() => document.querySelectorAll('.chat-row.self-row').length === 1 && document.querySelectorAll('.chat-row').length === 1);
  assert.equal(await eve.getByText('Invite link not used yet').count(), 0);
  await eve.getByRole('button', { name: /^Notes to self/ }).click();
  await eve.locator('.hdr-name', { hasText: 'Notes to self' }).waitFor();
  await eve.getByText('Only you can see this').waitFor();
  assert.equal(await eve.getByText('It’s just you here for now.').count(), 0, 'no invite banner');
  assert.equal(await eve.getByRole('button', { name: /^Your mood weather/ }).count(), 0, 'no mood in Notes to self');
  await eve.getByRole('textbox', { name: 'Message' }).fill('Passport renewal before March');
  await eve.keyboard.press('Enter');
  await eve.locator('.msg', { hasText: 'Passport renewal before March' }).waitFor();
  await eve.locator('input[type=file]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(AVATAR_PNG, 'base64') });
  await eve.locator('.photo-btn img').first().waitFor();
  await eve.waitForTimeout(800);
  assert.equal(await eve.locator('.status-mark').count(), 0, 'no ticks in Notes to self');
  assert.equal(await eve.getByText('Read', { exact: true }).count(), 0);
  // Only the Drops that work alone, and no Sessions.
  await eve.getByRole('button', { name: 'Add a Drop' }).click();
  await eve.locator('.tray-item', { hasText: 'Countdown' }).waitFor();
  assert.deepEqual((await eve.locator('.tray-item .tray-name').allTextContents()).sort(), ['Countdown', 'Decision Wheel', 'Time Capsule']);
  await shot(eve, 'self-tray');
  await eve.keyboard.press('Escape');
  // A reminder to self: scheduled, then sent now.
  await eve.getByRole('textbox', { name: 'Message' }).fill('Call the dentist');
  await eve.getByRole('button', { name: 'Send', exact: true }).click({ button: 'right' });
  await eve.getByRole('button', { name: /^Schedule…/ }).click();
  await eve.getByRole('button', { name: /^Tomorrow 8 am/ }).click();
  await eve.getByRole('status').filter({ hasText: 'Scheduled for' }).waitFor();
  await eve.getByRole('button', { name: 'Send now: Call the dentist' }).click();
  await eve.locator('.msg', { hasText: 'Call the dentist' }).getByText('· scheduled').waitFor();
  await eve.getByRole('button', { name: 'About Notes to self' }).click();
  await eve.getByRole('button', { name: 'Photos and media' }).waitFor();
  await shot(eve, 'self-info');
  await eve.keyboard.press('Escape');
  await shot(eve, 'self-chat');
  await eve.getByRole('button', { name: 'Back to chats' }).click();
  await eve.locator('.chat-row.self-row', { hasText: 'Call the dentist' }).waitFor();
  await shot(eve, 'self-list');

  step('Bob opens the link, signs in, joins, and sees what Alice wrote before');
  const bob = await person('bob@example.com', bobLink);
  await bob.getByRole('button', { name: 'Join alice' }).click();
  await bob.getByRole('textbox', { name: 'Message' }).waitFor();
  await bob.getByText('Note to self: invite Bob').waitFor();
  await bob.locator('.hdr-name', { hasText: 'alice' }).waitFor();
  await alice.getByRole('button', { name: /^bob/ }).click();
  await alice.locator('.hdr-name', { hasText: 'bob' }).waitFor();
  assert.equal(await alice.getByText('It’s just you here for now.').count(), 0);

  step('A used link can’t add anyone else; nor can Eve’s Notes to self link');
  await bob.goto(eveLink);
  await bob.getByRole('button', { name: 'Join eve' }).click();
  await bob.getByText('This invite link doesn’t work any more').waitFor();
  await bob.getByRole('button', { name: 'Go to my chats' }).click();
  // Bob's own Notes to self is there too; his chat with Alice is the only contact.
  await bob.locator('.chat-row.self-row').waitFor();
  await bob.getByRole('button', { name: /^alice/ }).click();
  await bob.getByText('Note to self: invite Bob').waitFor();
  await eve.goto(bobLink);
  await eve.getByRole('button', { name: 'Join alice' }).click();
  await eve.getByText('This invite link doesn’t work any more').waitFor();
  await shot(eve, 'join-link-used');
  await eve.getByRole('button', { name: 'Go to my chats' }).click();
  await eve.getByText('Start your first chat').waitFor();

  step('Text messages sync both ways');
  await alice.getByRole('textbox', { name: 'Message' }).fill('Finally finished Interstellar last night');
  await alice.getByRole('button', { name: 'Send', exact: true }).click();
  await bob.getByText('Finally finished Interstellar last night').waitFor();
  await bob.getByRole('textbox', { name: 'Message' }).fill('Same! I have thoughts. Lots of them.');
  await bob.keyboard.press('Enter');
  await alice.getByText('Same! I have thoughts.').waitFor();

  step('Ticks: my message shows ✓ on the server, then "Read" once Bob has seen it');
  await alice.getByRole('textbox', { name: 'Message' }).fill('Did you see the ending coming?');
  await alice.getByRole('button', { name: 'Send', exact: true }).click();
  await bob.getByText('Did you see the ending coming?').waitFor();
  await alice.locator('.msg', { hasText: 'Did you see the ending coming?' }).locator('.read-label').waitFor();
  assert.equal(await alice.locator('.read-label').count(), 1, 'only the newest read message says "Read"');
  await shot(alice, 'ticks-read');

  step('Message actions: reply-quote, react, phrase react, edit, copy, select');
  // The message itself, not a reply that quotes it.
  const msgWith = (page, text) => page.locator('.msg').filter({ hasText: text }).filter({ hasNot: page.locator('.quote', { hasText: text }) }).last();
  const actionsOn = async (page, text) => {
    await msgWith(page, text).locator('.msg-body').click({ button: 'right' });
    await page.getByRole('button', { name: 'Reply', exact: true }).waitFor();
  };
  // A real touch long-press on Bob's phone opens the same menu.
  {
    const box = await bob.locator('.msg', { hasText: 'Finally finished Interstellar' }).locator('.bubble').boundingBox();
    const cdp = await bob.context().newCDPSession(bob);
    const pt = [{ x: box.x + 20, y: box.y + box.height / 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
    await bob.waitForTimeout(700);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await bob.getByRole('button', { name: 'Reply', exact: true }).waitFor();
  await shot(bob, 'message-actions');
  await bob.getByRole('button', { name: 'Reply', exact: true }).click();
  await bob.getByText('Replying to alice').waitFor();
  await shot(bob, 'replying');
  await bob.getByRole('textbox', { name: 'Message' }).fill('Which part got you?');
  await bob.keyboard.press('Enter');
  const quote = alice.getByRole('button', { name: /Reply to You: Finally finished Interstellar/ });
  await quote.waitFor();
  await quote.click();
  await alice.locator('.msg.flash', { hasText: 'Finally finished Interstellar' }).waitFor();

  await actionsOn(alice, 'Which part got you?');
  await alice.getByRole('button', { name: 'React Love' }).click();
  await bob.getByRole('button', { name: 'Love, 1. Tap to add yours' }).waitFor();
  await bob.getByRole('button', { name: 'Love, 1. Tap to add yours' }).click();
  await alice.getByRole('button', { name: 'Love, 2. Tap to remove yours' }).waitFor();

  await actionsOn(bob, 'Finally finished Interstellar');
  await bob.getByRole('button', { name: /Phrase react/ }).click();
  await bob.getByRole('button', { name: 'finished', exact: true }).click();
  await bob.getByRole('button', { name: 'Interstellar', exact: true }).click();
  await shot(bob, 'phrase-picker');
  await bob.getByRole('button', { name: 'Phrase reaction Fire' }).click();
  await alice.getByRole('img', { name: '🔥 from bob on “finished Interstellar”' }).waitFor();
  await alice.locator('.phrase', { hasText: 'finished Interstellar' }).waitFor();

  await actionsOn(alice, 'Finally finished Interstellar');
  await alice.getByRole('button', { name: /^Edit/ }).click();
  await alice.getByText('Editing message').waitFor();
  assert.equal(await alice.getByRole('textbox', { name: 'Message' }).inputValue(), 'Finally finished Interstellar last night');
  await alice.getByRole('textbox', { name: 'Message' }).fill('Finally finished Interstellar last night!!');
  await alice.getByRole('button', { name: 'Save edit' }).click();
  await bob.locator('.msg', { hasText: 'last night!!' }).getByText('· edited').waitFor();
  assert.equal(await bob.getByText('last night!!').count(), 1);

  await actionsOn(alice, 'Which part got you?');
  await alice.getByRole('button', { name: 'Copy', exact: true }).click();
  await alice.getByRole('status').filter({ hasText: 'Copied' }).waitFor();
  assert.equal(await alice.evaluate(() => navigator.clipboard.readText()), 'Which part got you?');

  await actionsOn(alice, 'Same! I have thoughts.');
  await alice.getByRole('button', { name: 'Select', exact: true }).click();
  await msgWith(alice, 'Which part got you?').click();
  await alice.getByText('2 selected').waitFor();
  await shot(alice, 'select-mode');
  await alice.locator('.select-bar').getByRole('button', { name: 'Copy' }).click();
  await alice.getByRole('status').filter({ hasText: 'Copied' }).waitFor();
  assert.equal(await alice.evaluate(() => navigator.clipboard.readText()), 'Same! I have thoughts. Lots of them.\nWhich part got you?');
  await alice.locator('.select-bar').getByRole('button', { name: 'Delete' }).click();
  assert.equal(await alice.getByRole('button', { name: 'Delete for everyone' }).isDisabled(), true, 'not all mine');
  await alice.getByRole('button', { name: 'Cancel', exact: true }).click();
  await alice.getByRole('button', { name: 'Cancel selection' }).click();

  step('Delete for me (with undo) and delete for everyone');
  await actionsOn(bob, 'Note to self: invite Bob');
  await bob.getByRole('button', { name: 'Delete', exact: true }).click();
  await bob.getByRole('button', { name: 'Delete for me' }).click();
  await bob.getByRole('button', { name: 'Undo' }).waitFor();
  assert.equal(await bob.getByText('Note to self: invite Bob').count(), 0);
  await alice.getByText('Note to self: invite Bob').waitFor();
  await bob.getByRole('button', { name: 'Undo' }).click();
  await bob.getByText('Note to self: invite Bob').waitFor();

  await alice.getByRole('textbox', { name: 'Message' }).fill('oops, wrong chat');
  await alice.keyboard.press('Enter');
  await bob.getByText('oops, wrong chat').waitFor();
  await actionsOn(alice, 'oops, wrong chat');
  await alice.getByRole('button', { name: 'Delete', exact: true }).click();
  await alice.getByRole('button', { name: 'Delete for everyone' }).click();
  await alice.getByText('Delete for everyone?').waitFor();
  await alice.getByText('This removes it from both chats and can’t be undone.').waitFor();
  await shot(alice, 'delete-for-everyone');
  await alice.getByRole('button', { name: 'Delete for everyone' }).click();
  await bob.locator('.bubble.deleted', { hasText: 'Message deleted' }).waitFor();
  assert.equal(await bob.getByText('oops, wrong chat').count(), 0);

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
  // The linkPreview function runs on the new message and settles it (ok, or failed with no internet here).
  await alice.locator('.link-card:not([data-status="pending"])').first().waitFor({ timeout: 30_000 });

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

  step('Photo viewer: double-tap zoom, swipe to the next photo, swipe down to close, back gesture');
  const png2 = await alice.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 1200;
    const g = c.getContext('2d'); g.fillStyle = '#2F5BEA'; g.fillRect(0, 0, 900, 1200); g.fillStyle = '#FFFFFF'; g.font = 'bold 160px sans-serif'; g.fillText('Hi', 300, 650);
    return c.toDataURL('image/png').split(',')[1];
  });
  await alice.locator('input[type=file][accept="image/*"]').setInputFiles({ name: 'hi.png', mimeType: 'image/png', buffer: Buffer.from(png2, 'base64') });
  await bob.locator('.photo-btn img').nth(1).waitFor();
  await bob.locator('.photo-btn').first().click();
  const viewer = bob.getByRole('dialog', { name: /Photo from/ });
  await viewer.waitFor();
  await viewer.getByText('1 of 2').waitFor();
  const stage = viewer.locator('.viewer-img');
  await stage.locator('img').waitFor();
  const sbox = await stage.boundingBox();
  const cx = sbox.x + sbox.width / 2;
  const cy = sbox.y + sbox.height / 2;
  // Double-tap zooms in, double-tap again zooms back out.
  for (let i = 0; i < 2; i++) { await bob.mouse.click(cx, cy); await bob.waitForTimeout(60); }
  assert.equal(await stage.getAttribute('data-zoom'), '2.50', 'double-tap zooms in');
  await shot(bob, 'photo-viewer-zoomed');
  for (let i = 0; i < 2; i++) { await bob.mouse.click(cx, cy); await bob.waitForTimeout(60); }
  assert.equal(await stage.getAttribute('data-zoom'), '1.00', 'double-tap again zooms out');
  await bob.waitForTimeout(350);
  // Swipe left: the next photo.
  await bob.mouse.move(cx + 120, cy); await bob.mouse.down();
  for (let i = 1; i <= 6; i++) await bob.mouse.move(cx + 120 - i * 40, cy);
  await bob.mouse.up();
  await viewer.getByText('2 of 2').waitFor();
  await shot(bob, 'photo-viewer');
  // Swipe down: closed, still in the chat.
  await bob.mouse.move(cx, cy - 100); await bob.mouse.down();
  for (let i = 1; i <= 8; i++) await bob.mouse.move(cx, cy - 100 + i * 30);
  await bob.mouse.up();
  await viewer.waitFor({ state: 'detached' });
  await bob.getByRole('textbox', { name: 'Message' }).waitFor();
  // The back gesture closes the viewer, not the chat.
  await bob.locator('.photo-btn').nth(1).click();
  await viewer.waitFor();
  await bob.evaluate(() => history.back());
  await viewer.waitFor({ state: 'detached' });
  await bob.waitForTimeout(300);
  await bob.getByRole('textbox', { name: 'Message' }).waitFor();
  await bob.getByRole('button', { name: 'Back to chats' }).waitFor();

  step('Voice note: hold to record, partner plays it and reacts at a moment');
  const mic = alice.getByRole('button', { name: 'Record a voice note' });
  await mic.waitFor();
  const mbox = await mic.boundingBox();
  await alice.mouse.move(mbox.x + mbox.width / 2, mbox.y + mbox.height / 2);
  await alice.mouse.down();
  await alice.locator('.rec-bar').waitFor();
  await alice.waitForTimeout(1300);
  await shot(alice, 'voice-recording');
  await alice.waitForTimeout(1200);
  await alice.mouse.up();
  const bobVoice = bob.locator('.bubble.voice').last();
  await bobVoice.waitFor({ timeout: 20_000 });
  await bobVoice.locator('.voice-new').waitFor();
  const bars = await bobVoice.locator('.voice-wave i').count();
  assert.ok(bars >= 16, `waveform has bars (${bars})`);
  const heights = await bobVoice.locator('.voice-wave i').evaluateAll((els) => els.map((e) => parseFloat(e.style.height)));
  assert.ok(Math.max(...heights) > Math.min(...heights) || Math.max(...heights) > 3, 'waveform is not flat');
  const playLabel = await bobVoice.locator('.voice-play').getAttribute('aria-label');
  assert.match(playLabel, /Play voice note, 0:0[1-4]/, `duration shown (${playLabel})`);
  await bobVoice.locator('.voice-play').click();
  await bobVoice.getByRole('button', { name: 'Pause voice note' }).waitFor();
  await bob.waitForTimeout(900);
  const filled = await bobVoice.locator('.voice-wave i.on').count();
  assert.ok(filled > 0, 'playback moves along the waveform');
  // Played: the dot goes; Alice sees "Played".
  await bobVoice.locator('.voice-new').waitFor({ state: 'detached' });
  await alice.locator('.bubble.voice').last().getByText('Played').waitFor();
  await bobVoice.getByRole('button', { name: /^React at / }).click();
  await bobVoice.getByRole('button', { name: /^Love at / }).click();
  await alice.locator('.bubble.voice').last().getByRole('button', { name: /reacted ❤️ at 0:0/ }).waitFor();
  await bob.waitForTimeout(1500);
  await shot(bob, 'voice-note');
  await shot(alice, 'voice-note-sender');
  // Speed toggle.
  await bobVoice.getByRole('button', { name: /Playback speed 1x/ }).click();
  await bobVoice.getByRole('button', { name: /Playback speed 1.5x/ }).waitFor();

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

  step('The tray lists every Drop');
  await alice.getByRole('button', { name: 'Add a Drop' }).click();
  for (const t of ['Two Truths & a Lie', 'Truth or Dare', 'Predict Me', 'Rank It', 'Decision Wheel', 'Watch Party', 'Countdown', 'Poll', 'This or That', 'Time Capsule', 'Mood Check', 'Rewind']) {
    await alice.locator('.tray-item', { hasText: t }).waitFor();
  }
  assert.equal(await alice.locator('.tray-item', { hasText: 'Today’s question' }).count(), 0, 'the daily question isn’t in the tray');
  await shot(alice, 'tray-all');

  step('Poll: votes stay hidden until both have voted');
  await alice.locator('.tray-item', { hasText: 'Poll' }).click();
  await alice.getByRole('button', { name: 'Drop it' }).click();
  const pA = alice.getByRole('region', { name: 'Poll' });
  const pB = bob.getByRole('region', { name: 'Poll' });
  await pB.waitFor();
  await pB.getByRole('radio', { name: 'Beach' }).click();
  await pB.getByRole('button', { name: 'Vote', exact: true }).click();
  await pA.getByText('bob has voted · hidden').waitFor();
  assert.equal(await pA.locator('.them-tag').count(), 0);
  await pA.getByRole('radio', { name: 'City break' }).click();
  await pA.getByRole('button', { name: 'Vote', exact: true }).click();
  await pA.getByText('Split vote. Talk it out?').waitFor();
  await pB.locator('.them-tag', { hasText: 'alice' }).waitFor();
  await shot(alice, 'drop-poll');
  // A second poll where they agree: the bars race and the winner gets a crown.
  await bob.getByRole('button', { name: 'Add a Drop' }).click();
  await bob.locator('.tray-item', { hasText: 'Poll' }).click();
  await bob.getByRole('textbox', { name: 'Question', exact: true }).fill('Dinner tonight?');
  await bob.getByLabel('Options (one per line, 2–6)').fill('Pizza\nCurry');
  await bob.getByRole('button', { name: 'Drop it' }).click();
  const p2A = alice.getByRole('region', { name: 'Poll' }).last();
  const p2B = bob.getByRole('region', { name: 'Poll' }).last();
  await p2A.getByText('Dinner tonight?').waitFor();
  await p2A.getByRole('radio', { name: 'Curry' }).click();
  await p2A.getByRole('button', { name: 'Vote', exact: true }).click();
  await p2B.getByRole('radio', { name: 'Curry' }).click();
  await p2B.getByRole('button', { name: 'Vote', exact: true }).click();
  await p2B.getByText('You agree! 👑').waitFor();
  await p2B.locator('.poll-row.winner .poll-crown').waitFor();
  await bob.locator('#drop-fx[data-kind="crown"]').waitFor({ state: 'attached' });
  await shot(bob, 'drop-poll-crown');

  step('Two Truths & a Lie: the lie is picked while writing; a wrong guess waves red flags, a right one rains stars');
  const twoTruths = async (lie) => {
    await bob.getByRole('button', { name: 'Add a Drop' }).click();
    await bob.locator('.tray-item', { hasText: 'Two Truths' }).click();
    await bob.getByRole('radiogroup', { name: 'Which one is the lie?' }).getByRole('radio', { name: lie }).click();
    await bob.getByRole('button', { name: 'Drop it' }).click();
    return [bob.getByRole('region', { name: 'Two Truths & a Lie' }).last(), alice.getByRole('region', { name: 'Two Truths & a Lie' }).last()];
  };
  {
    const [tB, tA] = await twoTruths('I can juggle');
    // The lie is already sealed: Bob just waits; Alice can't see which one it is.
    await tB.getByText('Waiting for alice to guess').waitFor();
    await tA.getByText('Two are true. Which one is the lie?').waitFor();
    await tA.getByRole('radio', { name: 'I’ve never seen snow' }).click();
    await tA.getByRole('button', { name: 'Lock my guess' }).click();
    await tA.getByText('Fooled! bob got you.').waitFor();
    await alice.locator('#drop-fx[data-kind="flags"]').waitFor({ state: 'attached' });
    await shot(alice, 'two-truths-flags');
    await tB.getByText('You fooled alice.').waitFor();
    await bob.locator('#drop-fx[data-kind="flags"]').waitFor({ state: 'attached' });
  }
  {
    await alice.locator('#drop-fx').waitFor({ state: 'detached' });
    const [tB, tA] = await twoTruths('I can juggle');
    await tA.getByText('Two are true. Which one is the lie?').waitFor();
    await tA.getByRole('radio', { name: 'I can juggle' }).click();
    await tA.getByRole('button', { name: 'Lock my guess' }).click();
    await tA.getByText('You spotted it!').waitFor();
    await alice.locator('#drop-fx[data-kind="stars"]').waitFor({ state: 'attached' });
    await shot(alice, 'two-truths-stars');
    await tB.getByText('alice spotted it. Too easy?').waitFor();
  }

  step('Truth or Dare: Alice sets a dare, Bob answers it with a photo; the next one he skips');
  {
    await alice.getByRole('button', { name: 'Add a Drop' }).click();
    await alice.locator('.tray-item', { hasText: 'Truth or Dare' }).click();
    await alice.getByLabel(/^Your dare/).fill('Send a photo of your shoes.');
    await alice.getByRole('button', { name: 'Random your truth question' }).click();
    assert.ok((await alice.getByLabel(/^Your truth question/).inputValue()).length > 8, 'the dice fills a truth');
    await alice.getByRole('button', { name: 'Drop it' }).click();
    const dA = alice.getByRole('region', { name: 'Truth or Dare' }).last();
    const dB = bob.getByRole('region', { name: 'Truth or Dare' }).last();
    await dA.getByText('Waiting for bob to pick…').waitFor();
    assert.equal(await dB.getByText('Send a photo of your shoes.').count(), 0, 'the dare stays hidden until picked');
    await dB.getByRole('button', { name: 'Dare', exact: true }).click();
    await dB.getByText('Send a photo of your shoes.').waitFor();
    await dA.getByText('bob is on it…').waitFor();
    await shot(bob, 'truth-or-dare-dare');
    const shoes = await bob.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 800; c.height = 600;
      const g = c.getContext('2d'); g.fillStyle = '#8A5A3C'; g.fillRect(0, 0, 800, 600); g.fillStyle = '#fff'; g.fillRect(200, 250, 400, 120);
      return c.toDataURL('image/png').split(',')[1];
    });
    await dB.getByLabel('Your answer').fill('My trusty trainers');
    await dB.locator('input[aria-label="Choose a photo"]').setInputFiles({ name: 'shoes.png', mimeType: 'image/png', buffer: Buffer.from(shoes, 'base64') });
    await dA.locator('img.tod-photo').waitFor({ timeout: 20_000 });
    await dA.getByText('My trusty trainers').waitFor();
    await shot(alice, 'truth-or-dare-answer');

    await alice.getByRole('button', { name: 'Add a Drop' }).click();
    await alice.locator('.tray-item', { hasText: 'Truth or Dare' }).click();
    await alice.getByRole('button', { name: 'Drop it' }).click();
    const d2B = bob.getByRole('region', { name: 'Truth or Dare' }).last();
    await d2B.getByRole('button', { name: 'Skip 🐔' }).click();
    await bob.locator('#drop-fx[data-kind="chicken"]').waitFor({ state: 'attached' });
    await alice.getByRole('region', { name: 'Truth or Dare' }).last().getByText('bob chickened out!').waitFor();
  }

  step('Decision Wheel: both add options, one spin, same result on both phones');
  await alice.getByRole('button', { name: 'Add a Drop' }).click();
  await alice.locator('.tray-item', { hasText: 'Decision Wheel' }).click();
  await alice.getByRole('button', { name: 'Drop it' }).click();
  const wA = alice.getByRole('region', { name: 'Decision Wheel' });
  const wB = bob.getByRole('region', { name: 'Decision Wheel' });
  await wA.getByLabel('Add an option').fill('Sushi');
  await wA.getByRole('button', { name: 'Add', exact: true }).click();
  await wB.getByText('Sushi').waitFor();
  await wB.getByLabel('Add an option').fill('Tacos');
  await wB.getByRole('button', { name: 'Add', exact: true }).click();
  await wB.getByRole('button', { name: 'Spin the wheel' }).click();
  await wB.getByText('Spinning…').waitFor();
  await bob.waitForTimeout(1500);
  await shot(bob, 'wheel-spinning');
  await wA.getByText('The wheel chose').waitFor({ timeout: 15000 });
  await wB.locator('svg.wheel[aria-label^="Wheel stopped on"]').waitFor({ timeout: 15000 });
  await wB.getByText('The wheel chose').waitFor({ timeout: 15000 });
  assert.equal(await wA.locator('.gap-line b').textContent(), await wB.locator('.gap-line b').textContent());
  assert.equal(await wA.locator('svg.wheel').getAttribute('aria-label'), await wB.locator('svg.wheel').getAttribute('aria-label'), 'both wheels stop on the same slice');
  await shot(bob, 'wheel-landed');

  step('This or That: swipe a card to pick');
  {
    await alice.getByRole('button', { name: 'Add a Drop' }).click();
    await alice.locator('.tray-item', { hasText: 'This or That' }).click();
    await alice.getByLabel(/^Pairs, one per line/).fill('Tea / Coffee\nCats / Dogs\nSea / Sky');
    await alice.getByRole('button', { name: 'Drop it' }).click();
    const oA = alice.getByRole('region', { name: 'This or That' }).last();
    await oA.getByRole('button', { name: 'Start' }).click();
    const card = oA.locator('.tot-card');
    await card.waitFor();
    const box = await card.boundingBox();
    // Drag right past the threshold: "Coffee".
    await alice.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await alice.mouse.down();
    await alice.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 4 });
    await alice.mouse.move(box.x + box.width / 2 + 140, box.y + box.height / 2, { steps: 4 });
    await alice.mouse.up();
    await oA.getByText('Round 2 / 3').waitFor();
    await oA.getByRole('button', { name: 'Cats', exact: true }).click();
    await oA.getByRole('button', { name: 'Sky', exact: true }).click();
    await oA.locator('.tot-results li', { hasText: 'Coffee' }).waitFor();
  }

  step('Pin to scrapbook shows for both');
  await bobCard.getByRole('button', { name: 'Pin to scrapbook' }).click();
  await alice.locator('.badge', { hasText: '1' }).waitFor();
  await aliceCard.getByText('Pinned').waitFor();

  step('Pin a plain message');
  await actionsOn(alice, 'Which part got you?');
  await alice.locator('.sheet').getByRole('button', { name: 'Pin to scrapbook' }).click();
  await bob.locator('.badge', { hasText: '2' }).waitFor();

  step('Scrapbook: full screen, a photo scrap, a note both can edit, the Drop as a pop-up, drag to reorder');
  await actionsOn(alice, 'Cinema snacks were elite');
  await alice.locator('.sheet').getByRole('button', { name: 'Pin to scrapbook' }).click();
  await bob.locator('.badge', { hasText: '3' }).waitFor();
  await alice.getByRole('button', { name: 'Open scrapbook' }).click();
  const sbA = alice.getByRole('dialog', { name: 'Scrapbook' });
  await sbA.locator('.scrap-photo img').waitFor();
  await sbA.getByRole('button', { name: 'Note', exact: true }).click();
  await alice.getByLabel('Note', { exact: true }).fill('Bring snacks for movie night');
  await alice.getByRole('radio', { name: 'Colour #CFE6FF' }).click();
  await shot(alice, 'scrapbook-note-editor');
  await alice.getByRole('button', { name: 'Add note' }).click();
  await sbA.getByRole('button', { name: 'Note: Bring snacks for movie night' }).waitFor();
  // Bob edits Alice's note.
  await bob.getByRole('button', { name: 'Open scrapbook' }).click();
  const sbB = bob.getByRole('dialog', { name: 'Scrapbook' });
  await sbB.getByRole('button', { name: 'Note: Bring snacks for movie night' }).click();
  await bob.getByLabel('Note', { exact: true }).fill('Bring snacks AND drinks');
  await bob.getByRole('button', { name: 'Save note' }).click();
  await sbA.getByRole('button', { name: 'Note: Bring snacks AND drinks' }).waitFor();
  await sbA.getByText('edited by bob').waitFor();
  const scrapKinds = (page) => page.locator('[data-scrap]').evaluateAll((els) => els.map((e) => e.className.match(/kind-(note|photo|message|drop)/)[1]));
  assert.deepEqual(await scrapKinds(alice), ['note', 'photo', 'message', 'drop'], 'newest on top');
  await alice.waitForTimeout(300);
  await shot(alice, 'scrapbook-board');
  // Press and hold the Drop, drag it to the top.
  {
    const from = await sbA.locator('.scrap-drop').boundingBox();
    const to = await sbA.locator('[data-scrap]').first().boundingBox();
    await alice.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await alice.mouse.down();
    await alice.waitForTimeout(550);
    await alice.mouse.move(to.x + to.width * 0.2, to.y + to.height * 0.15, { steps: 10 });
    await shot(alice, 'scrapbook-drag');
    await alice.mouse.up();
  }
  await alice.waitForFunction(() => document.querySelector('[data-scrap]')?.classList.contains('kind-drop'));
  await bob.waitForFunction(() => document.querySelector('[data-scrap]')?.classList.contains('kind-drop'));
  assert.deepEqual(await scrapKinds(bob), ['drop', 'note', 'photo', 'message'], 'same order on both phones');
  // Keyboard/menu: move the note later.
  await sbB.locator('.kind-note').getByRole('button', { name: 'Scrap options' }).click();
  await sbB.getByRole('button', { name: 'Move later' }).click();
  await alice.waitForFunction(() => [...document.querySelectorAll('[data-scrap]')][2]?.classList.contains('kind-note'));
  // A pinned Drop opens as a pop-up, still the real card.
  await sbA.locator('.scrap-drop').click();
  const popA = alice.getByRole('dialog', { name: 'Drop' });
  await popA.getByRole('region', { name: 'Blind Reveal' }).waitFor();
  await shot(alice, 'scrapbook-drop-popup');
  await alice.keyboard.press('Escape');
  await popA.waitFor({ state: 'detached' });
  // A photo scrap opens the photo viewer; Escape closes only the viewer.
  await sbA.locator('.scrap-photo').click();
  await alice.locator('.viewer img').waitFor();
  await alice.keyboard.press('Escape');
  await alice.locator('.viewer').waitFor({ state: 'detached' });
  assert.ok(await sbA.isVisible(), 'scrapbook stays open');
  // A message scrap closes the scrapbook and jumps to the message.
  await sbA.locator('.scrap-msg').click();
  await sbA.waitFor({ state: 'detached' });
  await alice.locator('.msg.flash', { hasText: 'Which part got you?' }).waitFor();
  // Bob closes his with the back gesture.
  await bob.goBack();
  await sbB.waitFor({ state: 'detached' });
  await bob.getByRole('textbox', { name: 'Message' }).waitFor();

  step('Pin up to 3 messages to the top; a 4th asks what to do; the pinned bar jumps');
  for (const n of ['one', 'two', 'three', 'four']) {
    await alice.getByRole('textbox', { name: 'Message' }).fill(`Pin me ${n}`);
    await alice.keyboard.press('Enter');
    await bob.getByText(`Pin me ${n}`).waitFor();
  }
  for (const [i, n] of ['one', 'two', 'three'].entries()) {
    await actionsOn(alice, `Pin me ${n}`);
    await alice.getByRole('button', { name: 'Pin to top' }).click();
    await bob.locator('.pinned-ticks span').nth(i).waitFor();
  }
  await bob.getByRole('region', { name: 'Pinned messages' }).getByText('Pinned · 1/3').waitFor();
  await actionsOn(bob, 'Pin me four');
  await bob.getByRole('button', { name: 'Pin to top' }).click();
  await bob.getByText('Three messages are already pinned').waitFor();
  await shot(bob, 'pin-full');
  await bob.getByRole('button', { name: 'Move the oldest to Scrapbook' }).click();
  await alice.locator('.badge', { hasText: '5' }).waitFor();
  await alice.getByRole('region', { name: 'Pinned messages' }).getByText('Pin me two').waitFor();
  // The oldest went to the scrapbook and Bob's message took its place: three again.
  await alice.locator('.pinned-ticks span').nth(2).waitFor();
  assert.equal(await alice.locator('.pinned-ticks span').count(), 3);
  await alice.evaluate(() => document.querySelector('.feed').scrollTo(0, 0));
  await alice.locator('.pinned-main').click();
  await alice.locator('.msg.flash', { hasText: 'Pin me two' }).waitFor();
  await alice.getByRole('region', { name: 'Pinned messages' }).getByText('Pinned · 2/3').waitFor();
  await shot(alice, 'pinned-bar');
  await alice.getByRole('button', { name: 'Pinned message options' }).click();
  await alice.getByRole('button', { name: 'Unpin' }).click();
  await bob.locator('.pinned-ticks span').nth(2).waitFor({ state: 'detached' });

  step('Countdown banner: live time above the chat, opens the Drop, "It’s here" at zero');
  {
    const roomId = await alice.evaluate(() => localStorage.getItem('hi.room'));
    const DB = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
    const H = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
    const room = await (await fetch(`${DB}/rooms/${roomId}`, { headers: H })).json();
    const res = await fetch(`${DB}/rooms/${roomId}/drops?documentId=cd-e2e`, {
      method: 'POST', headers: H, body: JSON.stringify({ fields: {
        type: { stringValue: 'countdown' }, createdBy: { stringValue: room.fields.owner.stringValue },
        createdAt: { timestampValue: new Date().toISOString() },
        content: { mapValue: { fields: { title: { stringValue: 'Movie night' }, date: { stringValue: '' }, atMs: { integerValue: String(Date.now() + 9000) } } } },
      } }),
    });
    assert.equal(res.status, 200);
  }
  const cdA = alice.getByRole('region', { name: 'Upcoming countdown' });
  await cdA.getByText('Movie night').waitFor();
  {
    const left = /^0m (\d\d)s$/.exec(await cdA.locator('.cd-time').textContent());
    assert.ok(left && Number(left[1]) <= 10, 'about 9 s to go, worked out from the current time');
  }
  await shot(alice, 'countdown-banner');
  await cdA.locator('.cd-main').click();
  await alice.getByRole('dialog', { name: 'Countdown' }).getByRole('region', { name: 'Countdown' }).waitFor();
  await alice.keyboard.press('Escape');
  await alice.getByRole('dialog', { name: 'Countdown' }).waitFor({ state: 'detached' });
  await cdA.getByText('It’s here! 🎉').waitFor({ timeout: 20_000 });
  await bob.getByRole('region', { name: 'Upcoming countdown' }).getByText('It’s here! 🎉').waitFor();
  await cdA.getByRole('button', { name: 'Dismiss countdown' }).click();
  await cdA.waitFor({ state: 'detached' });

  step('Threads: Alice starts one under a message; Bob sees the tile with an unread dot and replies');
  await actionsOn(alice, 'Which part got you?');
  await alice.getByRole('button', { name: 'Start a thread' }).click();
  await alice.getByRole('dialog', { name: 'Thread' }).waitFor();
  await alice.getByText('No replies yet. Start the side chat.').waitFor();
  await alice.getByLabel('Reply in thread').fill('The docking scene, obviously');
  await alice.getByRole('button', { name: 'Send reply' }).click();
  await alice.getByRole('dialog', { name: 'Thread' }).getByText('1 reply').waitFor();
  await alice.getByRole('button', { name: 'Close thread' }).click();
  await alice.getByRole('dialog', { name: 'Thread' }).waitFor({ state: 'detached' });
  await alice.getByRole('textbox', { name: 'Message' }).waitFor();
  const tileB = bob.locator('.thread-tile');
  await tileB.getByText('1 reply').waitFor();
  assert.ok(await tileB.evaluate((el) => el.classList.contains('unread')), 'unread dot for Bob');
  await tileB.scrollIntoViewIfNeeded();
  await shot(bob, 'thread-tile');
  await tileB.click();
  const thB = bob.getByRole('dialog', { name: 'Thread' });
  await thB.getByText('The docking scene, obviously').waitFor();
  await thB.getByLabel('Reply in thread').fill('Agreed. And the waves.');
  await thB.getByRole('button', { name: 'Send reply' }).click();
  await thB.getByText('2 replies').waitFor();
  await shot(bob, 'thread-view');
  // The phone's back gesture closes the thread, not the chat.
  await bob.goBack();
  await thB.waitFor({ state: 'detached' });
  await bob.getByRole('textbox', { name: 'Message' }).waitFor();
  assert.equal(await tileB.evaluate((el) => el.classList.contains('unread')), false, 'read once opened');
  await alice.locator('.thread-tile', { hasText: '2 replies' }).waitFor();
  assert.ok(await alice.locator('.thread-tile').evaluate((el) => el.classList.contains('unread')), 'Bob’s reply is new for Alice');

  step('Today’s question: dropped once, hidden answers, banner until both answer');
  for (const p of [alice, bob]) {
    await p.evaluate(() => { localStorage.setItem('hi.daily.e2e', 'on'); localStorage.removeItem('hi.daily.off'); });
  }
  for (const p of [alice, bob]) {
    await p.reload();
    await p.locator('#splash').waitFor({ state: 'detached', timeout: 15000 });
    await p.getByRole('textbox', { name: 'Message' }).waitFor();
    const general = p.getByRole('tab', { name: /^General/ });
    if ((await general.getAttribute('aria-selected')) !== 'true') await general.click();
  }
  const dA = alice.getByRole('region', { name: 'Today’s question' });
  const dB = bob.getByRole('region', { name: 'Today’s question' });
  await alice.locator('.daily-banner').waitFor({ timeout: 20000 });
  await bob.locator('.daily-banner').waitFor({ timeout: 20000 });
  await dA.waitFor();
  assert.equal(await alice.getByRole('region', { name: 'Today’s question' }).count(), 1, 'only one per day, even with both phones open');
  await shot(alice, 'daily-banner');
  await alice.locator('.daily-banner').click();
  await dA.getByLabel('Your answer').fill('A good cup of tea');
  await dA.getByRole('button', { name: 'Answer', exact: true }).click();
  await bob.locator('.daily-banner', { hasText: 'alice answered · your turn' }).waitFor();
  await dB.getByLabel('Your answer').fill('Your voice note');
  await dB.getByRole('button', { name: 'Answer', exact: true }).click();
  await dA.getByText('Your voice note').waitFor();
  await dB.getByText('A good cup of tea').waitFor();
  await alice.locator('.daily-banner').waitFor({ state: 'detached' });
  await shot(bob, 'daily-revealed');
  // Turned off in the contact profile (private to Alice).
  await alice.locator('.hdr-who').click();
  await alice.getByRole('switch', { name: /Daily question/ }).click();
  await alice.getByText('Daily question off').waitFor();
  await alice.keyboard.press('Escape');

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
  // Opening screen set to Still: the next load shows the logo only until the app is ready.
  await alice.getByRole('radio', { name: 'Still' }).click();
  await alice.keyboard.press('Escape');
  // The choice follows the account: alice reloads and is still dark; bob is unaffected.
  await alice.reload();
  assert.notEqual(await alice.evaluate(() => document.getElementById('splash')?.className), 'play', 'still splash does not animate');
  await alice.getByRole('textbox', { name: 'Message' }).waitFor();
  assert.equal((await state(alice)).mode, 'dark');
  assert.equal((await state(bob)).mode, 'light', "bob's theme is his own");
  await alice.getByRole('button', { name: 'Switch to light mode' }).click();
  assert.equal((await state(alice)).mode, 'light');
  await alice.getByRole('button', { name: 'Switch to dark mode' }).click();

  step('Pull down and hold 2 s at the top of the chat to refresh (a quick tug does nothing)');
  // Scroll to the very top and make sure it stays there (late layout can nudge it).
  await alice.waitForFunction(() => {
    const f = document.querySelector('.feed');
    f.scrollTop = 0;
    const ok = window.__topSince && Date.now() - window.__topSince > 600;
    if (f.scrollTop !== 0) window.__topSince = 0; else if (!window.__topSince) window.__topSince = Date.now();
    return ok;
  }, null, { polling: 100 });
  {
    const cdp = await alice.context().newCDPSession(alice);
    const box = await alice.locator('.feed').boundingBox();
    const x = box.x + box.width / 2;
    const y0 = box.y + 20;
    const drag = async () => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
      for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + i * 25 }] });
    };
    let navigated = false;
    alice.on('framenavigated', () => { navigated = true; });
    // 1) Pull past the line but let go after half a second: nothing happens.
    await drag();
    await alice.locator('.ptr', { hasText: 'Keep holding to refresh' }).waitFor();
    await alice.waitForTimeout(500);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await alice.waitForTimeout(2500);
    assert.equal(navigated, false, 'a short pull must not reload');
    assert.equal(await alice.locator('.ptr').count(), 0);
    // 2) Pull and keep holding: reloads after ~2 s, without letting go.
    const reloaded = alice.waitForEvent('framenavigated');
    const t0 = Date.now();
    await drag();
    await alice.waitForTimeout(1000);
    await shot(alice, 'pull-to-refresh');
    await reloaded;
    const held = Date.now() - t0;
    assert.ok(held >= 1900, `reloaded after ${held} ms, expected about 2000`);
    await alice.getByRole('textbox', { name: 'Message' }).waitFor();
  }

  step('A second contact by e-mail invite: Alice’s list shows two chats');
  await alice.getByRole('button', { name: 'Back to chats' }).click();
  await alice.getByRole('button', { name: 'Add contact' }).click();
  await alice.getByLabel('Their e-mail (optional)').fill('carol@example.com');
  await alice.getByRole('button', { name: 'Create invite link' }).click();
  await alice.getByText('Invite ready').waitFor();
  await alice.keyboard.press('Escape');
  await alice.getByText('Waiting for carol@example.com to join').waitFor();
  const carol = await person('carol@example.com');
  await carol.getByText('alice invited you').waitFor();
  await shot(carol, 'chats-invite');
  await carol.getByRole('button', { name: 'Accept' }).click();
  await carol.getByRole('textbox', { name: 'Message' }).fill('Hi Alice, it’s Carol!');
  await carol.keyboard.press('Enter');
  await alice.getByRole('button', { name: /^carol.*unread messages/ }).waitFor();
  await alice.getByRole('button', { name: /^bob/ }).waitFor();
  assert.equal(await alice.locator('.chat-row:not(.self-row)').count(), 2);
  assert.equal(await alice.locator('.chat-row.self-row').count(), 1, 'plus Notes to self');
  await shot(alice, 'chats-two');
  await alice.getByRole('button', { name: /^carol/ }).click();
  await alice.getByText('Hi Alice, it’s Carol!').waitFor();
  assert.equal(await alice.getByText('Which part got you?').count(), 0, 'chats are separate');
  await alice.getByRole('button', { name: 'Back to chats' }).click();
  await alice.getByRole('button', { name: /^carol/ }).waitFor();
  // Read once opened (the read marker may take a moment to sync back).
  await alice.getByRole('button', { name: /^carol(?!.*unread messages)/ }).waitFor();

  step('Outsider cannot see anything');
  await eve.reload();
  await eve.getByText('Start your first chat').waitFor();
  await alice.getByRole('button', { name: /^bob/ }).click();
  await alice.getByRole('textbox', { name: 'Message' }).waitFor();

  await bob.evaluate(() => document.querySelector('.feed').scrollTo(0, 0));
  await shot(bob, 'bob-top');
  await alice.evaluate(() => { const f = document.querySelector('.feed'); f.scrollTop = f.scrollHeight; });
  await shot(alice, 'alice-bottom');
  await alice.getByRole('button', { name: 'Add a Drop' }).click();
  await shot(alice, 'tray');
  await alice.keyboard.press('Escape');
  await alice.getByRole('button', { name: 'Open scrapbook' }).click();
  await shot(alice, 'scrapbook');
  await alice.keyboard.press('Escape');

  step('Profile photo shows to the other person; About in the contact profile');
  await bob.locator('.hdr-who img[src^="data:image/jpeg"]').waitFor();
  await bob.getByRole('button', { name: 'alice’s profile' }).click();
  await bob.getByText('Tea first, then talk').waitFor();
  await shot(bob, 'contact-profile');
  await bob.keyboard.press('Escape');

  step('Notes: Alice shares a 24 h note; Bob replies to it from his chat list');
  await alice.getByRole('button', { name: 'Back to chats' }).click();
  await alice.getByRole('button', { name: 'Add a note' }).click();
  await alice.getByRole('radio', { name: '📚' }).click();
  await alice.getByLabel('Note', { exact: true }).fill('exam tomorrow, send snacks');
  await alice.getByRole('button', { name: 'Share note' }).click();
  await alice.getByRole('status').filter({ hasText: 'Note shared for 24 hours' }).waitFor();
  await alice.getByRole('button', { name: 'Your note: 📚 exam tomorrow, send snacks. Change it' }).waitFor();
  await bob.getByRole('button', { name: 'Back to chats' }).click();
  const aliceNote = bob.getByRole('button', { name: 'alice’s note: 📚 exam tomorrow, send snacks. Reply' });
  await aliceNote.waitFor();
  await shot(bob, 'chats-notes');
  await aliceNote.click();
  await bob.getByLabel('Reply to alice’s note').fill('Good luck!! Snacks incoming');
  await bob.getByRole('button', { name: 'Send reply' }).click();
  await bob.getByRole('status').filter({ hasText: 'Reply sent' }).waitFor();
  await alice.getByRole('button', { name: /^bob.*unread messages/ }).click();
  await alice.locator('.msg', { hasText: 'Good luck!! Snacks incoming' }).getByText('Replied to your note').waitFor();
  await shot(alice, 'note-reply');

  step('Typing shows in the chat list');
  await alice.getByRole('button', { name: 'Back to chats' }).click();
  await bob.locator('.chat-open', { hasText: 'alice' }).click();
  await bob.getByRole('textbox', { name: 'Message' }).fill('typing a long thought');
  await alice.locator('.chat-sub.typing', { hasText: 'typing…' }).waitFor();
  await shot(alice, 'chats-typing');
  await bob.getByRole('textbox', { name: 'Message' }).fill('');
  await alice.locator('.chat-sub.typing').waitFor({ state: 'detached' });

  step('Nickname and mute (private to Alice)');
  await alice.getByRole('button', { name: /^bob/ }).click();
  await alice.getByRole('button', { name: 'bob’s profile' }).click();
  await alice.getByRole('button', { name: 'Nickname' }).click();
  await alice.getByLabel('Your name for them').fill('Bobby 🐻');
  await alice.getByRole('button', { name: 'Save', exact: true }).click();
  await alice.keyboard.press('Escape');
  await alice.locator('.hdr-name', { hasText: 'Bobby 🐻' }).waitFor();
  await bob.locator('.hdr-name', { hasText: 'alice' }).waitFor();
  await alice.getByRole('button', { name: 'Bobby 🐻’s profile' }).click();
  await alice.getByRole('switch', { name: 'Mute notifications' }).click();
  await alice.getByRole('switch', { name: 'Unmute notifications' }).waitFor();
  await alice.keyboard.press('Escape');
  await alice.getByRole('button', { name: 'Back to chats' }).click();
  await alice.getByRole('button', { name: /^Bobby 🐻.*muted/ }).waitFor();

  step('Read receipts off: nobody sees "Read" (both ways)');
  await bob.getByRole('button', { name: 'Settings' }).click();
  await bob.getByRole('radiogroup', { name: 'Read receipts' }).getByRole('radio', { name: 'Off' }).click();
  await bob.getByText('Nobody sees when you’ve read their messages').waitFor();
  await bob.keyboard.press('Escape');
  await alice.getByRole('button', { name: /^Bobby 🐻/ }).click();
  await alice.getByRole('textbox', { name: 'Message' }).fill('Are you reading these?');
  await alice.getByRole('button', { name: 'Send', exact: true }).click();
  await bob.getByText('Are you reading these?').waitFor();
  await alice.locator('.msg', { hasText: 'Are you reading these?' }).getByRole('img', { name: 'Sent' }).waitFor();
  await alice.waitForTimeout(1500);
  assert.equal(await alice.locator('.read-label').count(), 0, 'no "Read" while Bob has read receipts off');
  await bob.getByRole('button', { name: 'Settings' }).click();
  await bob.getByRole('radiogroup', { name: 'Read receipts' }).getByRole('radio', { name: 'On' }).click();
  await bob.keyboard.press('Escape');
  await alice.locator('.msg', { hasText: 'Are you reading these?' }).locator('.read-label').waitFor();

  step('Urgent: Bob sends one from the long-press Send menu');
  await bob.getByRole('textbox', { name: 'Message' }).fill('Call me when you can');
  await bob.getByRole('button', { name: 'Send', exact: true }).click({ button: 'right' });
  await bob.getByText('3 left today').waitFor();
  await shot(bob, 'send-options');
  await bob.getByRole('button', { name: /^Send as urgent/ }).click();
  await alice.locator('.msg', { hasText: 'Call me when you can' }).getByText('Urgent').waitFor();

  step('Effects: keyword chip, confetti once on each phone (not again after a reload), sealed, whisper, shout');
  const fxCount = (p) => p.evaluate(() => (window.__hiFx ? window.__hiFx.count : 0));
  const [aliceFx0, bobFx0] = [await fxCount(alice), await fxCount(bob)];
  // A suggestion can be dismissed…
  await bob.getByRole('textbox', { name: 'Message' }).fill('thank you so much');
  await bob.getByRole('button', { name: 'Send with ✨ Glow?' }).waitFor();
  await bob.getByRole('button', { name: 'No effect' }).click();
  assert.equal(await bob.getByRole('button', { name: /^Send with/ }).count(), 0);
  await bob.getByRole('textbox', { name: 'Message' }).fill('');
  // …or applied with one tap; it's never applied by itself.
  await alice.getByRole('textbox', { name: 'Message' }).fill('Congrats on the new job!');
  await alice.getByRole('button', { name: 'Send with 🎉 Confetti?' }).click();
  await alice.getByText('Sending with Confetti').waitFor();
  await alice.getByRole('button', { name: 'Send', exact: true }).click();
  await bob.locator('#fx-layer[data-effect="confetti"]').waitFor({ state: 'attached' });
  await bob.waitForTimeout(500);
  await shot(bob, 'effect-confetti');
  await bob.locator('#fx-layer').waitFor({ state: 'detached', timeout: 10_000 });
  assert.equal(await fxCount(bob), bobFx0 + 1, 'confetti played once for Bob');
  assert.equal(await fxCount(alice), aliceFx0 + 1, 'and once for Alice as she sent it');
  const congrats = bob.locator('.msg', { hasText: 'Congrats on the new job!' });
  await congrats.getByRole('button', { name: 'Replay Confetti' }).waitFor();
  await bob.reload();
  await bob.getByText('Congrats on the new job!').waitFor();
  await bob.waitForTimeout(1500);
  assert.equal(await fxCount(bob), 0, 'no replay after a reload');
  assert.equal(await bob.locator('#fx-layer').count(), 0);
  // Tapping the label replays it.
  await bob.locator('.msg', { hasText: 'Congrats on the new job!' }).getByRole('button', { name: 'Replay Confetti' }).click();
  await bob.locator('#fx-layer[data-effect="confetti"]').waitFor({ state: 'attached' });
  assert.equal(await fxCount(bob), 1);

  // Sealed, from the long-press Send menu: Alice only sees an envelope until she opens it.
  await bob.getByRole('textbox', { name: 'Message' }).fill('Meet me at the jetty at 7');
  await bob.getByRole('button', { name: 'Send', exact: true }).click({ button: 'right' });
  await bob.getByRole('button', { name: /^Effects…/ }).click();
  await shot(bob, 'effects-sheet');
  await bob.getByRole('button', { name: /^Sealed/ }).click();
  await bob.getByText('Sending with Sealed').waitFor();
  await bob.getByRole('button', { name: 'Send', exact: true }).click();
  const sealed = alice.locator('.msg', { hasText: 'Sealed message' });
  await sealed.getByRole('button', { name: /Tap to open/ }).waitFor();
  assert.equal(await alice.getByText('Meet me at the jetty at 7').count(), 0, 'sealed text stays hidden');
  await shot(alice, 'effect-sealed');
  await sealed.getByRole('button', { name: /Tap to open/ }).click();
  await alice.getByText('Meet me at the jetty at 7').waitFor();

  // Whisper: blurred until tapped.
  await alice.getByRole('textbox', { name: 'Message' }).fill('psst, I already booked it');
  await alice.getByRole('button', { name: 'Send', exact: true }).click({ button: 'right' });
  await alice.getByRole('button', { name: /^Effects…/ }).click();
  await alice.getByRole('button', { name: /^Whisper/ }).click();
  await alice.getByRole('button', { name: 'Send', exact: true }).click();
  await bob.getByRole('button', { name: 'Whispered message. Tap to reveal' }).click();
  await bob.locator('.fx-whisper-text', { hasText: 'psst, I already booked it' }).waitFor();

  // Shout: big text that shakes on arrival.
  await alice.getByRole('textbox', { name: 'Message' }).fill('WE ARE GOING');
  await alice.getByRole('button', { name: 'Send', exact: true }).click({ button: 'right' });
  await alice.getByRole('button', { name: /^Effects…/ }).click();
  await alice.getByRole('button', { name: /^Shout/ }).click();
  await alice.getByRole('button', { name: 'Send', exact: true }).click();
  await bob.locator('.bubble.fx-shout.fx-go', { hasText: 'WE ARE GOING' }).waitFor();
  await shot(bob, 'effect-shout');

  step('Effects respect reduced motion and the Settings switch');
  await bob.emulateMedia({ reducedMotion: 'reduce' });
  const before = await fxCount(bob);
  await alice.getByRole('textbox', { name: 'Message' }).fill('Happy birthday Bob!');
  await alice.getByRole('button', { name: 'Send with 🎈 Balloons?' }).click();
  await alice.getByRole('button', { name: 'Send', exact: true }).click();
  await bob.locator('.msg', { hasText: 'Happy birthday Bob!' }).getByText('Sent with Balloons').waitFor();
  await bob.waitForTimeout(800);
  assert.equal(await fxCount(bob), before, 'no animation with reduced motion');
  assert.equal(await bob.locator('#fx-layer').count(), 0);
  await bob.emulateMedia({ reducedMotion: 'no-preference' });
  await bob.getByRole('button', { name: 'Settings' }).click();
  await bob.getByRole('radiogroup', { name: 'Play effects' }).getByRole('radio', { name: 'Off' }).click();
  await bob.keyboard.press('Escape');
  await alice.getByRole('textbox', { name: 'Message' }).fill('Happy new year!');
  await alice.getByRole('button', { name: 'Send with 🎆 Fireworks?' }).click();
  await alice.getByRole('button', { name: 'Send', exact: true }).click();
  await bob.locator('.msg', { hasText: 'Happy new year!' }).getByText('Sent with Fireworks').waitFor();
  await bob.waitForTimeout(800);
  assert.equal(await fxCount(bob), before, 'no animation with effects turned off');
  // Drop moments are off too: an agreed poll gives no crown overlay on Bob's phone.
  {
    const dropFx = () => bob.evaluate(() => (window.__hiDropFx || []).length);
    const fxBefore = await dropFx();
    await alice.getByRole('button', { name: 'Add a Drop' }).click();
    await alice.locator('.tray-item', { hasText: 'Poll' }).click();
    await alice.getByRole('textbox', { name: 'Question', exact: true }).fill('Quiet poll?');
    await alice.getByLabel('Options (one per line, 2–6)').fill('Yes\nNo');
    await alice.getByRole('button', { name: 'Drop it' }).click();
    const qA = alice.getByRole('region', { name: 'Poll' }).last();
    const qB = bob.getByRole('region', { name: 'Poll' }).last();
    await qB.getByText('Quiet poll?').waitFor();
    await qA.getByRole('radio', { name: 'Yes' }).click();
    await qA.getByRole('button', { name: 'Vote', exact: true }).click();
    await qB.getByRole('radio', { name: 'Yes' }).click();
    await qB.getByRole('button', { name: 'Vote', exact: true }).click();
    await qB.getByText('You agree! 👑').waitFor();
    await bob.waitForTimeout(600);
    assert.equal(await dropFx(), fxBefore, 'no Drop overlay with effects turned off');
    assert.equal(await bob.locator('#drop-fx').count(), 0);
  }
  await bob.getByRole('button', { name: 'Settings' }).click();
  await bob.getByRole('radiogroup', { name: 'Play effects' }).getByRole('radio', { name: 'On' }).click();
  await bob.keyboard.press('Escape');

  step('Scheduled messages: schedule, edit, send now, cancel, and one that sends itself');
  const scheduleVia = async (text, pick) => {
    await alice.getByRole('textbox', { name: 'Message' }).fill(text);
    await alice.getByRole('button', { name: 'Send', exact: true }).click({ button: 'right' });
    await alice.getByRole('button', { name: /^Schedule…/ }).click();
    await alice.getByText('Schedule message').waitFor();
    await pick();
    await alice.getByRole('status').filter({ hasText: 'Scheduled for' }).waitFor();
  };
  // ~1–1.5 minutes ahead (the picker works in whole minutes).
  const soon = await alice.evaluate(() => {
    const d = new Date(Date.now() + 90_000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  });
  await scheduleVia('Good morning from the past', async () => {
    await alice.getByLabel('Or pick a date and time').fill(soon);
    await alice.getByRole('button', { name: 'Schedule', exact: true }).click();
  });
  await scheduleVia('Second thought, sent early', () => alice.getByRole('button', { name: /^Tomorrow 8 am/ }).click());
  await scheduleVia('Never mind this one', () => alice.getByRole('button', { name: /^Next Monday 9 am/ }).click());
  await alice.getByText('3 scheduled').waitFor();
  assert.equal(await alice.getByRole('textbox', { name: 'Message' }).inputValue(), '', 'the composer is cleared');
  await alice.getByRole('button', { name: '3 scheduled' }).click(); // more than two start folded
  await shot(alice, 'scheduled-strip');
  // Bob can't see any of them yet.
  assert.equal(await bob.getByText('Good morning from the past').count(), 0);
  await alice.getByRole('button', { name: 'Edit scheduled message: Good morning from the past' }).click();
  await alice.getByLabel('Message', { exact: true }).last().fill('Good morning from the past!');
  await alice.getByRole('button', { name: 'Save', exact: true }).click();
  await alice.getByRole('button', { name: 'Send now: Second thought, sent early' }).click();
  await bob.locator('.msg', { hasText: 'Second thought, sent early' }).getByText('· scheduled').waitFor();
  await alice.getByRole('button', { name: 'Cancel scheduled message: Never mind this one' }).click();
  await alice.getByText('1 scheduled').waitFor();
  // The last one sends itself while Alice has the app open.
  await bob.getByText('Good morning from the past!').waitFor({ timeout: 150_000 });
  await alice.locator('.sched-strip').waitFor({ state: 'detached' });
  assert.equal(await bob.getByText('Never mind this one').count(), 0);

  step('Quiet hours in Settings');
  await alice.getByRole('button', { name: 'Settings' }).click();
  await alice.getByRole('radiogroup', { name: 'Quiet hours' }).getByRole('radio', { name: 'On' }).click();
  await alice.getByLabel('Quiet hours start').waitFor();
  await alice.getByText('Notifications wait until 07:00').waitFor();
  await shot(alice, 'settings-quiet');
  await alice.getByRole('radiogroup', { name: 'Quiet hours' }).getByRole('radio', { name: 'Off' }).click();
  await alice.keyboard.press('Escape');

  step('Mute a chat from the list: for 8 hours, then unmute');
  await alice.getByRole('button', { name: 'Back to chats' }).click();
  await alice.getByRole('button', { name: 'Muted. Change notifications for Bobby 🐻' }).click();
  await alice.getByRole('button', { name: 'Unmute' }).click();
  await alice.getByRole('button', { name: 'Mute notifications for Bobby 🐻' }).click();
  await alice.getByRole('button', { name: 'For 8 hours' }).click();
  await alice.getByRole('button', { name: /^Bobby 🐻.*muted/ }).waitFor();
  await shot(alice, 'chats-muted');
  await alice.getByRole('button', { name: 'Muted. Change notifications for Bobby 🐻' }).click();
  await alice.getByText(/^Muted until/).waitFor();
  await alice.getByRole('button', { name: 'Unmute' }).click();
  await alice.getByRole('button', { name: 'Mute notifications for Bobby 🐻' }).waitFor();

  step('Remove contact: Carol leaves; Alice keeps a read-only copy and deletes it');
  await carol.getByRole('button', { name: 'alice’s profile' }).click();
  await carol.getByRole('button', { name: 'Remove contact' }).click();
  await carol.getByText('Remove alice?').waitFor();
  await carol.getByRole('button', { name: 'Remove contact' }).click();
  await carol.getByText('Start your first chat').waitFor();
  await alice.getByRole('button', { name: /^carol.*carol left this chat/ }).click();
  await alice.getByText('carol left this chat. You can read it').waitFor();
  await alice.getByText('Hi Alice, it’s Carol!').waitFor();
  assert.equal(await alice.getByRole('textbox', { name: 'Message' }).count(), 0, 'read-only');
  await shot(alice, 'left-chat');
  await alice.getByRole('button', { name: 'Delete chat' }).click();
  await alice.getByRole('button', { name: /^Bobby/ }).waitFor();
  assert.equal(await alice.locator('.chat-row:not(.self-row)').count(), 1);

  step('Block: Dave joins with a link, Alice blocks him');
  await alice.getByRole('button', { name: 'Add contact' }).click();
  await alice.getByRole('button', { name: 'Create invite link' }).click();
  await alice.getByText('Invite ready').waitFor();
  const daveLink = (await alice.getByLabel('Invite link', { exact: true }).textContent()).trim();
  await alice.keyboard.press('Escape');
  const dave = await person('dave@example.com', daveLink);
  await dave.getByRole('button', { name: 'Join alice' }).click();
  await dave.getByRole('textbox', { name: 'Message' }).waitFor();
  await alice.getByRole('button', { name: /^dave/ }).click();
  await alice.getByRole('button', { name: 'dave’s profile' }).click();
  await alice.getByRole('button', { name: 'Block' }).click();
  await alice.getByText('Block dave?').waitFor();
  await alice.getByRole('button', { name: 'Block' }).click();
  await alice.getByRole('button', { name: 'Add contact' }).waitFor();
  assert.equal(await alice.getByRole('button', { name: /^dave/ }).count(), 0);
  await dave.getByText('alice left this chat.').waitFor();
  await alice.getByRole('button', { name: 'Settings' }).click();
  await alice.locator('.settings-row', { hasText: 'dave' }).getByRole('button', { name: 'Unblock' }).waitFor();
  await shot(alice, 'settings-blocked');
  await alice.keyboard.press('Escape');

  step('Search this chat across tabs (finds a message in the archived Trip tab and jumps to it)');
  await alice.getByRole('button', { name: /^Bobby/ }).click();
  await alice.getByRole('textbox', { name: 'Message' }).waitFor();
  await alice.getByRole('button', { name: 'Search this chat' }).click();
  await alice.getByLabel('Search messages').fill('march FLIGHTS');
  const hit = alice.locator('.result-row', { hasText: 'Flights are cheap in March' });
  await hit.waitFor();
  assert.equal(await hit.locator('mark').count() >= 2, true, 'both words highlighted');
  await alice.locator('.result-head', { hasText: 'Trip' }).waitFor();
  await shot(alice, 'search-chat');
  await hit.click();
  await alice.getByRole('tab', { name: /^Trip/, selected: true }).waitFor();
  await alice.locator('.msg.flash', { hasText: 'Flights are cheap in March' }).waitFor();

  step('Media filter: photos of this chat as a grid');
  await alice.getByRole('button', { name: 'Search this chat' }).click();
  await alice.getByRole('radio', { name: 'Photos' }).click();
  await alice.locator('.photo-cell img').first().waitFor();
  assert.ok(await alice.locator('.photo-cell').count() >= 2);
  await shot(alice, 'search-photos');
  await alice.getByRole('radio', { name: 'Voice' }).click();
  await alice.locator('.result-row', { hasText: 'Voice note' }).first().waitFor();
  await alice.keyboard.press('Escape');

  step('Search all chats from the chat list, then open the result');
  await alice.getByRole('tab', { name: /General/ }).click();
  await alice.getByRole('button', { name: 'Back to chats' }).click();
  await alice.getByRole('button', { name: 'Search all chats' }).click();
  await alice.getByLabel('Search messages').fill('thoughts');
  await alice.locator('.result-head', { hasText: 'Bobby' }).waitFor();
  await shot(alice, 'search-all');
  await alice.locator('.result-row', { hasText: 'I have thoughts' }).click();
  await alice.locator('.msg.flash', { hasText: 'Same! I have thoughts.' }).waitFor();

  step('Disappearing tab: on for 7 days, announced, timer icon, messages carry an expiry and vanish when it passes');
  await alice.getByRole('tab', { name: /General.*options/ }).click();
  await alice.getByRole('radiogroup', { name: 'Disappearing messages' }).getByRole('radio', { name: '7 days' }).click();
  await alice.getByText('You turned on disappearing messages (7 days)').waitFor();
  await bob.getByText('alice turned on disappearing messages (7 days)').waitFor();
  await alice.getByRole('tab', { name: /General, disappearing messages \(7 days\)/ }).waitFor();
  assert.equal(await bob.locator('.tab-chip .tab-timer').count(), 1);
  await alice.getByRole('textbox', { name: 'Message' }).fill('This one will vanish');
  await alice.keyboard.press('Enter');
  await bob.getByText('This one will vanish').waitFor();
  await shot(bob, 'disappearing-on');
  {
    const roomId = await alice.evaluate(() => localStorage.getItem('hi.room'));
    const base = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/rooms/${roomId}/tabs/general/messages`;
    const H = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
    const list = await (await fetch(`${base}?pageSize=300`, { headers: H })).json();
    const doc = list.documents.find((d) => d.fields.text?.stringValue === 'This one will vanish');
    const exp = Date.parse(doc.fields.expiresAt.timestampValue);
    assert.ok(Math.abs(exp - (Date.now() + 7 * 24 * 3_600_000)) < 10 * 60_000, 'expires in about 7 days');
    // Time passes: move its expiry into the past (the TTL policy would delete it later).
    const res = await fetch(`http://127.0.0.1:8080/v1/${doc.name}?updateMask.fieldPaths=expiresAt`, {
      method: 'PATCH', headers: H, body: JSON.stringify({ fields: { expiresAt: { timestampValue: new Date(Date.now() - 1000).toISOString() } } }),
    });
    assert.equal(res.status, 200);
  }
  await bob.getByText('This one will vanish').waitFor({ state: 'detached', timeout: 25_000 });
  await alice.getByText('This one will vanish').waitFor({ state: 'detached', timeout: 25_000 });
  await alice.getByRole('tab', { name: /General.*options/ }).click();
  await alice.getByRole('radiogroup', { name: 'Disappearing messages' }).getByRole('radio', { name: 'Off' }).click();
  await alice.getByText('You turned off disappearing messages').waitFor();
  await bob.locator('.tab-chip .tab-timer').waitFor({ state: 'detached' });

  step('Export: ZIP (chat.txt, chat.json, media) and the PDF print view');
  await alice.getByRole('button', { name: 'Bobby 🐻’s profile' }).click();
  await alice.getByRole('button', { name: 'Export chat' }).click();
  await shot(alice, 'export-sheet');
  const [download] = await Promise.all([
    alice.waitForEvent('download', { timeout: 60_000 }),
    alice.getByRole('button', { name: /ZIP with photos/ }).click(),
  ]);
  assert.match(download.suggestedFilename(), /^Hi chat - Bobby.* - \d{4}-\d\d-\d\d\.zip$/);
  {
    const { unzipSync, strFromU8 } = require('fflate');
    const files = unzipSync(new Uint8Array(await (await import('node:fs/promises')).readFile(await download.path())));
    const txt = strFromU8(files['chat.txt']);
    assert.ok(txt.includes('Flights are cheap in March'), 'other tabs included');
    assert.ok(txt.includes('== Trip =='));
    assert.ok(!txt.includes('This one will vanish'), 'expired messages left out');
    assert.ok(!txt.includes('oops, wrong chat'), 'deleted messages left out');
    assert.ok(JSON.parse(strFromU8(files['chat.json'])).messages.length > 5);
    assert.ok(Object.keys(files).some((f) => f.startsWith('photos/')), 'photos included');
  }
  await alice.evaluate(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  await alice.getByRole('button', { name: 'Bobby 🐻’s profile' }).click();
  await alice.getByRole('button', { name: 'Export chat' }).click();
  await alice.getByRole('radio', { name: 'Only “General”' }).click();
  await alice.getByRole('button', { name: 'PDF (print or save)' }).click();
  await alice.waitForFunction(() => window.__printed === 1, null, { timeout: 30_000 });
  assert.match(await alice.locator('#print-root h1').textContent(), /^Hi · alice & Bobby 🐻 · General$/);
  assert.equal(await alice.locator('#print-root .print-tab').count(), 1, 'only the chosen tab');
  await alice.emulateMedia({ media: 'print' });
  await shot(alice, 'export-print');
  await alice.emulateMedia({ media: 'screen' });
  await alice.evaluate(() => dispatchEvent(new Event('afterprint')));
  await alice.getByRole('textbox', { name: 'Message' }).waitFor();

  step('Hot streak: Alice proposes, Bob accepts, both send → 🔥1');
  {
    const ensureChat = async (page, name) => {
      if (!(await page.getByRole('button', { name: 'Back to chats' }).count())) await page.locator('.chat-open', { hasText: name }).first().click();
      await page.getByRole('textbox', { name: 'Message' }).waitFor();
    };
    await ensureChat(alice, 'Bobby');
    await ensureChat(bob, 'alice');
  }
  await alice.getByRole('button', { name: 'Bobby 🐻’s profile' }).click();
  await alice.getByRole('button', { name: /^Hot streak/ }).click();
  await alice.getByRole('button', { name: 'Start a streak with Bobby 🐻' }).click();
  await bob.getByText('alice wants to start a hot streak').waitFor();
  await bob.waitForTimeout(500); // let the sheet / slide settle
  await shot(bob, 'streak-invite');
  await bob.locator('.streak-invite').getByRole('button', { name: 'Start' }).click();
  await alice.getByRole('textbox', { name: 'Message' }).fill('Streak day one 🔥');
  await alice.keyboard.press('Enter');
  await bob.getByText('Streak day one 🔥').waitFor();
  await bob.getByRole('textbox', { name: 'Message' }).fill('Let’s keep it going');
  await bob.keyboard.press('Enter');
  await alice.getByRole('button', { name: 'Hot streak: 1 day' }).waitFor();
  await bob.getByRole('button', { name: 'Hot streak: 1 day' }).waitFor();
  await alice.getByRole('button', { name: 'Hot streak: 1 day' }).click();
  await alice.getByText('You ✓ · Bobby 🐻 ✓').waitFor();
  await alice.waitForTimeout(500); // let the sheet / slide settle
  await shot(alice, 'streak-sheet');
  await alice.keyboard.press('Escape');

  step('A week of history (seeded) → 🔥7, a one-time milestone card, and 🔥 in the chat list');
  const stRoom = await alice.evaluate(() => localStorage.getItem('hi.room'));
  const ST_DB = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
  const ST_H = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
  const roomDoc = await (await fetch(`${ST_DB}/rooms/${stRoom}`, { headers: ST_H })).json();
  const uids = roomDoc.fields.members.arrayValue.values.map((v) => v.stringValue);
  const stTz = 'Indian/Maldives';
  const keyOf = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: stTz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  for (let d = 1; d <= 6; d++) {
    const res = await fetch(`${ST_DB}/rooms/${stRoom}/days/${keyOf(Date.now() - d * 86400000)}`, {
      method: 'PATCH', headers: ST_H, body: JSON.stringify({ fields: { uids: { arrayValue: { values: uids.map((u) => ({ stringValue: u })) } } } }),
    });
    assert.equal(res.status, 200);
  }
  {
    // The streak was turned on six days ago.
    const res = await fetch(`${ST_DB}/rooms/${stRoom}?updateMask.fieldPaths=streak.since`, {
      method: 'PATCH', headers: ST_H,
      body: JSON.stringify({ fields: { streak: { mapValue: { fields: { since: { timestampValue: new Date(Date.now() - 6 * 86400000).toISOString() } } } } } }),
    });
    assert.equal(res.status, 200);
  }
  await alice.getByRole('button', { name: 'Hot streak: 7 days' }).waitFor();
  await alice.locator('.memory-card.milestone', { hasText: '7-day streak' }).waitFor();
  await alice.waitForTimeout(500); // let the sheet / slide settle
  await shot(alice, 'milestone');
  await bob.locator('.memory-card.milestone', { hasText: '7-day streak' }).waitFor();
  await alice.locator('.memory-card.milestone').getByRole('button', { name: 'Dismiss' }).click();

  step('On This Day: a message from a year ago shows at the top of General');
  {
    const ago = new Date(Date.now() - 365 * 86400000);
    // Noon in the room's zone on the same calendar day last year.
    const k = keyOf(Date.now());
    const lastYear = `${Number(k.slice(0, 4)) - 1}${k.slice(4)}`;
    const at = new Date(`${lastYear}T07:00:00Z`);
    assert.ok(Math.abs(at - ago) < 3 * 86400000);
    const res = await fetch(`${ST_DB}/rooms/${stRoom}/tabs/general/messages?documentId=old-beach`, {
      method: 'POST', headers: ST_H,
      body: JSON.stringify({ fields: { uid: { stringValue: uids.find((u) => u !== uids[0]) || uids[0] }, kind: { stringValue: 'text' }, text: { stringValue: 'Remember the beach bonfire? 🔥' }, createdAt: { timestampValue: at.toISOString() } } }),
    });
    assert.equal(res.status, 200);
  }
  // The chat looks when it opens: go back to the list (🔥 shows there too) and open it again.
  await alice.getByRole('button', { name: 'Back to chats' }).click();
  await alice.locator('.chat-open', { hasText: 'Bobby' }).locator('.row-streak', { hasText: '7' }).waitFor();
  assert.match(await alice.locator('.chat-open', { hasText: 'Bobby' }).getAttribute('aria-label'), /7-day streak/);
  await shot(alice, 'chats-streak');
  await alice.locator('.chat-open', { hasText: 'Bobby' }).click();
  const otd = alice.locator('.memory-card.otd');
  await otd.getByText('On this day, 1 year ago').waitFor();
  await otd.getByText('Remember the beach bonfire? 🔥').waitFor();
  assert.equal(await alice.locator('.memory-card.milestone').count(), 0, 'a milestone is celebrated once');
  await alice.waitForTimeout(500); // let the sheet / slide settle
  await shot(alice, 'on-this-day');
  await otd.getByRole('button', { name: 'Show' }).click();
  await alice.locator('.msg.flash', { hasText: 'Remember the beach bonfire?' }).waitFor();
  await otd.getByRole('button', { name: 'Dismiss On this day' }).click();
  await otd.waitFor({ state: 'detached' });

  step('Rewind: slides from the profile, swipe, share as an image; and the Rewind Drop');
  await alice.getByRole('button', { name: 'Bobby 🐻’s profile' }).click();
  await alice.getByRole('button', { name: 'Rewind', exact: true }).click();
  const rw = alice.getByRole('dialog', { name: /^Rewind/ });
  await rw.locator('.rewind-title', { hasText: 'You and Bobby 🐻' }).waitFor({ timeout: 30_000 });
  await alice.waitForTimeout(500); // let the sheet / slide settle
  await shot(alice, 'rewind-cover');
  await rw.getByRole('button', { name: 'Next slide' }).click();
  await rw.locator('.rewind-kicker', { hasText: 'Who said more' }).waitFor();
  await alice.waitForTimeout(500); // let the sheet / slide settle
  await shot(alice, 'rewind-who');
  await alice.keyboard.press('ArrowRight');
  await rw.getByRole('region', { name: /^Slide 3 of/ }).waitFor();
  await rw.locator('.rewind-kicker', { hasText: 'Top emoji' }).waitFor();
  // Swipe left for the next slide, right to go back.
  {
    const box = await rw.locator('.rewind-stage').boundingBox();
    const y = box.y + box.height / 2;
    await alice.mouse.move(box.x + box.width * 0.8, y);
    await alice.mouse.down();
    await alice.mouse.move(box.x + box.width * 0.2, y, { steps: 5 });
    await alice.mouse.up();
    await rw.getByRole('region', { name: /^Slide 4 of/ }).waitFor();
    await alice.mouse.move(box.x + box.width * 0.2, y);
    await alice.mouse.down();
    await alice.mouse.move(box.x + box.width * 0.8, y, { steps: 5 });
    await alice.mouse.up();
    await rw.getByRole('region', { name: /^Slide 3 of/ }).waitFor();
  }
  const [rwImg] = await Promise.all([
    alice.waitForEvent('download', { timeout: 30_000 }),
    rw.getByRole('button', { name: 'Share as image' }).click(),
  ]);
  assert.match(rwImg.suggestedFilename(), /^hi-rewind-.+\.png$/);
  {
    const buf = await (await import('node:fs/promises')).readFile(await rwImg.path());
    assert.equal(buf.subarray(1, 4).toString(), 'PNG');
  }
  await rw.getByRole('radio', { name: 'This year' }).click();
  await rw.locator('.rewind-kicker', { hasText: /Rewind · \d{4}/ }).waitFor();
  await rw.getByRole('button', { name: 'Close Rewind' }).click();
  await rw.waitFor({ state: 'detached' });
  await alice.getByRole('textbox', { name: 'Message' }).waitFor();
  // The Rewind Drop: Bob watches it from the card.
  await alice.getByRole('button', { name: 'Add a Drop' }).click();
  await alice.locator('.tray-item', { hasText: 'Rewind' }).click();
  const rwCard = bob.getByRole('region', { name: 'Rewind' }).last();
  await rwCard.getByText(/with alice/).waitFor();
  await rwCard.getByText(/messages/).waitFor({ timeout: 30_000 });
  await bob.waitForTimeout(500); // let the sheet / slide settle
  await shot(bob, 'rewind-drop');
  await rwCard.getByRole('button', { name: 'Watch Rewind' }).click();
  const rwBob = bob.getByRole('dialog', { name: /^Rewind/ });
  await rwBob.locator('.rewind-title', { hasText: 'You and alice' }).waitFor({ timeout: 30_000 });
  await bob.goBack();
  await rwBob.waitFor({ state: 'detached' });
  await bob.getByRole('textbox', { name: 'Message' }).waitFor();

  step('Session: Mini Type Test — answer at your own pace, resume after a reload, reveal together');
  // The four-question test is behind a developer switch; the real Type Test has 32 questions.
  for (const p of [alice, bob]) {
    await p.evaluate(() => localStorage.setItem('hi.sessions.dev', '1'));
    const general = p.getByRole('tab', { name: /^General/ });
    if ((await general.getAttribute('aria-selected')) !== 'true') await general.click();
  }
  await alice.getByRole('button', { name: 'Add a Drop' }).click();
  await alice.locator('.session-item', { hasText: /^🧭 Type Test/ }).scrollIntoViewIfNeeded();
  await alice.waitForTimeout(400);
  await shot(alice, 'tray-sessions');
  await alice.locator('.session-item', { hasText: 'Mini Type Test' }).click();
  const sesA = () => alice.getByRole('dialog', { name: 'Mini Type Test' });
  const sesB = () => bob.getByRole('dialog', { name: 'Mini Type Test' });
  await sesA().getByText('4 quick questions', { exact: false }).waitFor();
  await sesA().getByText('not a clinical or official assessment', { exact: false }).waitFor();
  const cardB = bob.getByRole('region', { name: 'Mini Type Test' }).last();
  await cardB.getByText('alice started a Mini Type Test').waitFor();
  await sesA().getByRole('button', { name: 'Start' }).click();
  await sesA().getByText('Question 1 of 4').waitFor();
  await sesA().getByRole('radio', { name: 'Out with a group, the more the merrier' }).click();
  await sesA().getByText('Question 2 of 4').waitFor();
  await alice.waitForTimeout(500); // let the question fade in
  await shot(alice, 'session-question');
  await sesA().getByRole('radio', { name: 'Clear steps and real examples' }).click();
  await sesA().getByText('Question 3 of 4').waitFor();
  await cardB.getByText('alice 2/4').waitFor();
  // Alice reloads mid-session: the card says Continue and she resumes at question 3.
  await alice.reload();
  await alice.locator('#splash').waitFor({ state: 'detached', timeout: 15000 });
  const cardA = alice.getByRole('region', { name: 'Mini Type Test' }).last();
  await cardA.getByText('You 2/4').waitFor({ timeout: 20000 });
  await cardA.getByRole('button', { name: 'Continue' }).click();
  await sesA().getByText('Question 3 of 4').waitFor();
  // Going back shows the earlier answer still chosen.
  await sesA().getByRole('button', { name: '← Previous question' }).click();
  await sesA().getByRole('radio', { name: 'Clear steps and real examples', checked: true }).waitFor();
  await sesA().getByRole('radio', { name: 'Clear steps and real examples' }).click();
  await sesA().getByText('Question 3 of 4').waitFor();
  // Bob joins while Alice is in it: he sees her progress and that she's there now.
  await cardB.getByRole('button', { name: 'Join' }).click();
  await sesB().getByRole('button', { name: 'Start' }).click();
  await sesB().locator('.session-progress', { hasText: 'alice 2/4' }).waitFor();
  await sesB().locator('.session-progress .here-dot').waitFor();
  for (const [n, opt] of [[1, 'A quiet night in, maybe with one close friend'], [2, 'The big idea first, details later'], [3, 'Tell them what you love about it'], [4, 'Made up as you go']]) {
    await sesB().getByText(`Question ${n} of 4`).waitFor();
    await sesB().getByRole('radio', { name: opt }).click();
  }
  await sesB().getByText('All 4 answered').waitFor();
  await sesB().getByRole('button', { name: 'Finish' }).click();
  await sesB().getByText('Waiting for alice', { exact: false }).waitFor();
  // Bob's answers stay hidden from Alice until she finishes too.
  await sesA().locator('.session-progress', { hasText: 'Bobby 🐻 done' }).waitFor();
  await sesA().getByRole('radio', { name: 'Point out what might go wrong' }).click();
  await sesA().getByText('Question 4 of 4').waitFor();
  await sesA().getByRole('radio', { name: 'Planned day by day' }).click();
  await sesA().getByRole('button', { name: 'Finish' }).click();
  // The reveal, step by step.
  await sesA().locator('.type-card', { hasText: 'ESTJ' }).waitFor({ timeout: 20000 });
  await sesA().locator('.type-card', { hasText: 'INFP' }).getByText('The Daydreamer').waitFor();
  await sesB().locator('.type-card', { hasText: 'INFP' }).waitFor({ timeout: 20000 });
  await alice.waitForTimeout(1200); // let the cards flip
  await shot(alice, 'session-reveal-types');
  await sesA().getByRole('button', { name: 'Next' }).click();
  await sesA().getByRole('img', { name: /^Energy: you 100% Fills up with people, Bobby 🐻 0%/ }).waitFor();
  await alice.waitForTimeout(600);
  await shot(alice, 'session-reveal-scales');
  await sesA().getByRole('button', { name: 'Next' }).click();
  await sesA().getByText('Nowhere! You balance each other out.').waitFor();
  assert.equal(await sesA().locator('.match-card.differ').count(), 4);
  await sesA().getByRole('button', { name: 'Next' }).click();
  assert.equal(await sesA().locator('.prompt-card').count(), 3);
  await alice.waitForTimeout(600);
  await shot(alice, 'session-reveal-prompts');
  await sesA().getByRole('button', { name: 'Next' }).click();
  await sesA().locator('.session-hero', { hasText: 'You ESTJ · Bobby 🐻 INFP' }).waitFor();
  await alice.waitForTimeout(800);
  await shot(alice, 'session-reveal-finish');
  const [sesImg] = await Promise.all([
    alice.waitForEvent('download', { timeout: 30_000 }),
    sesA().getByRole('button', { name: 'Share as image' }).click(),
  ]);
  assert.equal(sesImg.suggestedFilename(), 'hi-mini-type.png');
  await sesA().getByRole('button', { name: 'Pin result' }).click();
  await alice.getByText('Pinned to scrapbook').waitFor();
  await sesA().getByRole('button', { name: 'Talk about it' }).click();
  await sesA().waitFor({ state: 'detached' });
  assert.match(await alice.getByRole('textbox', { name: 'Message' }).inputValue(), /^We got ESTJ and INFP!/);
  await alice.getByRole('textbox', { name: 'Message' }).fill('');
  // The cards in the chat now show both results.
  await cardA.locator('.session-codes', { hasText: 'ESTJ' }).waitFor();
  await cardB.locator('.session-codes', { hasText: 'INFP' }).waitFor();
  // Reopening goes back to the reveal step you were on; the back gesture closes it.
  await cardA.getByRole('button', { name: 'See results' }).click();
  await sesA().locator('.session-hero').waitFor();
  await alice.goBack();
  await sesA().waitFor({ state: 'detached' });
  await bob.goBack();
  await sesB().waitFor({ state: 'detached' });
  await bob.getByRole('textbox', { name: 'Message' }).waitFor();

  // Every send above went through (the activity day rides in the same batch as each message).
  assert.equal(await alice.locator('.msg.failed').count(), 0, `no unsent messages (alice): ${(await alice.locator('.msg.failed').allTextContents()).join(' | ')}`);
  assert.equal(await bob.locator('.msg.failed').count(), 0, `no unsent messages (bob): ${(await bob.locator('.msg.failed').allTextContents()).join(' | ')} ${await bob.evaluate(() => Object.keys(localStorage).filter((k) => /fail/i.test(k)).map((k) => localStorage.getItem(k)).join(' '))}`);

  step('Streak off');
  await bob.getByRole('button', { name: /^Hot streak: \d+ days?$/ }).click();
  await bob.getByRole('button', { name: 'Turn off streak' }).click();
  await alice.locator('.streak-chip').waitFor({ state: 'detached' });

  step('Delete account (Eve, who has no chats)');
  await eve.getByRole('button', { name: 'Settings' }).click();
  await eve.getByRole('button', { name: 'Delete account' }).click();
  await eve.getByText('Delete your account?').waitFor();
  await eve.getByRole('button', { name: 'Continue' }).click();
  await shot(eve, 'delete-account');
  await eve.getByRole('button', { name: 'Delete my account forever' }).click();
  await eve.getByRole('button', { name: /Use e-mail instead/ }).waitFor({ timeout: 20000 });
  console.log('\nE2E PASSED — screenshots in', SHOTS);
} catch (e) {
  console.error('\nE2E FAILED:', e);
  for (const c of browser.contexts()) for (const p of c.pages()) console.error('rows:', await p.evaluate(() => [...document.querySelectorAll('.chat-open')].map((b) => b.getAttribute('aria-label'))).catch(() => ''));
  for (const [i, c] of browser.contexts().entries()) for (const p of c.pages()) await p.screenshot({ path: `${SHOTS}/failure-${i}.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
