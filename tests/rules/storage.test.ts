import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { getBytes, ref, uploadBytes, type FirebaseStorage } from 'firebase/storage';

let env: RulesTestEnvironment;
const ROOM = 'sroom';
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

const st = (uid: string) => env.authenticatedContext(uid).storage() as unknown as FirebaseStorage;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-drops',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
    storage: { rules: readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'rooms', ROOM), { owner: 'alice', ownerName: 'A', members: ['alice', 'bob'], invites: ['bob@example.com'], createdAt: new Date() });
  });
});
afterAll(async () => { await env?.cleanup(); });

describe('photo storage', () => {
  it('a member uploads into their own folder; the partner can read it', async () => {
    const path = `rooms/${ROOM}/photos/alice/p1.jpg`;
    await assertSucceeds(uploadBytes(ref(st('alice'), path), jpeg, { contentType: 'image/jpeg' }));
    await assertSucceeds(getBytes(ref(st('bob'), path)));
    await assertFails(getBytes(ref(st('eve'), path)));
  });

  it('rejects uploads into someone else\'s folder, non-images, and outsiders', async () => {
    await assertFails(uploadBytes(ref(st('alice'), `rooms/${ROOM}/photos/bob/x.jpg`), jpeg, { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(ref(st('alice'), `rooms/${ROOM}/photos/alice/x.jpg`), jpeg, { contentType: 'text/html' }));
    await assertFails(uploadBytes(ref(st('eve'), `rooms/${ROOM}/photos/eve/x.jpg`), jpeg, { contentType: 'image/jpeg' }));
  });

  it('rejects files over 5 MB', async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    await assertFails(uploadBytes(ref(st('alice'), `rooms/${ROOM}/photos/alice/big.jpg`), big, { contentType: 'image/jpeg' }));
  });
});

describe('voice storage', () => {
  const audio = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
  it('a member uploads a voice note into their own folder; the partner can read it', async () => {
    const path = `rooms/${ROOM}/voice/alice/v1.webm`;
    await assertSucceeds(uploadBytes(ref(st('alice'), path), audio, { contentType: 'audio/webm' }));
    await assertSucceeds(uploadBytes(ref(st('alice'), `rooms/${ROOM}/voice/alice/v2.m4a`), audio, { contentType: 'audio/mp4' }));
    await assertSucceeds(getBytes(ref(st('bob'), path)));
    await assertFails(getBytes(ref(st('eve'), path)));
  });

  it('rejects other folders, other file types, outsiders and big files', async () => {
    await assertFails(uploadBytes(ref(st('alice'), `rooms/${ROOM}/voice/bob/x.webm`), audio, { contentType: 'audio/webm' }));
    await assertFails(uploadBytes(ref(st('alice'), `rooms/${ROOM}/voice/alice/x.mp3`), audio, { contentType: 'audio/mpeg' }));
    await assertFails(uploadBytes(ref(st('alice'), `rooms/${ROOM}/voice/alice/y.webm`), audio, { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(ref(st('eve'), `rooms/${ROOM}/voice/eve/x.webm`), audio, { contentType: 'audio/webm' }));
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    await assertFails(uploadBytes(ref(st('alice'), `rooms/${ROOM}/voice/alice/big.webm`), big, { contentType: 'audio/webm' }));
  });
});
