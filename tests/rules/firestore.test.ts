import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';

let env: RulesTestEnvironment;
const ROOM = 'room1';

const alice = () => env.authenticatedContext('alice', { email: 'alice@example.com', email_verified: true }).firestore() as unknown as Firestore;
const bob = () => env.authenticatedContext('bob', { email: 'bob@example.com', email_verified: true }).firestore() as unknown as Firestore;
const eve = () => env.authenticatedContext('eve', { email: 'eve@example.com', email_verified: true }).firestore() as unknown as Firestore;
const bobUnverified = () => env.authenticatedContext('bob', { email: 'bob@example.com', email_verified: false }).firestore() as unknown as Firestore;

async function seedRoom(members: string[] = ['alice', 'bob']) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'rooms', ROOM), { owner: 'alice', ownerName: 'Alice', members, invites: ['bob@example.com'], createdAt: new Date() });
    await setDoc(doc(db, 'rooms', ROOM, 'drops', 'd1'), { type: 'blind-reveal', createdBy: 'alice', createdAt: new Date(), content: {} });
  });
}

function sealedRef(db: Firestore, uid: string, key = 'answer') {
  return doc(db, 'rooms', ROOM, 'drops', 'd1', 'sealed', `${uid}_${key}`);
}
function lockRef(db: Firestore, uid: string, key = 'answer') {
  return doc(db, 'rooms', ROOM, 'drops', 'd1', 'locks', `${uid}_${key}`);
}
async function lockIn(db: Firestore, uid: string, value: unknown, key = 'answer') {
  const b = writeBatch(db);
  b.set(sealedRef(db, uid, key), { uid, key, value, locked: true, updatedAt: serverTimestamp() });
  b.set(lockRef(db, uid, key), { uid, key, at: serverTimestamp() });
  await b.commit();
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-drops',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

describe('rooms', () => {
  it('lets a user create a room with exactly one invite', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'rooms', 'r2'), {
      owner: 'alice', ownerName: 'Alice', members: ['alice'], invites: ['bob@example.com'], createdAt: serverTimestamp(),
    }));
  });

  it('rejects a room created with an extra member', async () => {
    await assertFails(setDoc(doc(alice(), 'rooms', 'r2'), {
      owner: 'alice', ownerName: 'Alice', members: ['alice', 'eve'], invites: ['bob@example.com'], createdAt: serverTimestamp(),
    }));
  });

  it('lets only the invited, verified e-mail join, and only once', async () => {
    await seedRoom(['alice']);
    await assertFails(updateDoc(doc(eve(), 'rooms', ROOM), { members: ['alice', 'eve'] }));
    await assertFails(updateDoc(doc(bobUnverified(), 'rooms', ROOM), { members: ['alice', 'bob'] }));
    await assertSucceeds(updateDoc(doc(bob(), 'rooms', ROOM), { members: ['alice', 'bob'] }));
    // Room is now full: nobody can be added, invites can't be changed.
    await assertFails(updateDoc(doc(alice(), 'rooms', ROOM), { invites: ['eve@example.com'] }));
    await assertFails(updateDoc(doc(bob(), 'rooms', ROOM), { members: ['alice', 'bob', 'eve'] }));
  });

  it('lets the invitee find the room by e-mail before joining', async () => {
    await seedRoom(['alice']);
    await assertSucceeds(getDocs(query(collection(bob(), 'rooms'), where('invites', 'array-contains', 'bob@example.com'))));
    await assertFails(getDocs(query(collection(eve(), 'rooms'), where('invites', 'array-contains', 'bob@example.com'))));
  });

  it('hides the room from outsiders', async () => {
    await seedRoom();
    await assertFails(getDoc(doc(eve(), 'rooms', ROOM)));
    await assertFails(getDocs(collection(eve(), 'rooms', ROOM, 'messages')));
  });
});

describe('messages', () => {
  it('members can post as themselves only', async () => {
    await seedRoom();
    await assertSucceeds(setDoc(doc(alice(), 'rooms', ROOM, 'messages', 'm1'), { uid: 'alice', kind: 'text', text: 'hi', createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(alice(), 'rooms', ROOM, 'messages', 'm2'), { uid: 'bob', kind: 'text', text: 'hi', createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(eve(), 'rooms', ROOM, 'messages', 'm3'), { uid: 'eve', kind: 'text', text: 'hi', createdAt: serverTimestamp() }));
  });

  it('messages are immutable', async () => {
    await seedRoom();
    await setDoc(doc(alice(), 'rooms', ROOM, 'messages', 'm1'), { uid: 'alice', kind: 'text', text: 'hi', createdAt: serverTimestamp() });
    await assertFails(updateDoc(doc(alice(), 'rooms', ROOM, 'messages', 'm1'), { text: 'edited' }));
  });

  it('a photo message must point at the sender\'s own folder', async () => {
    await seedRoom();
    const base = { uid: 'alice', kind: 'photo', text: '', createdAt: serverTimestamp() };
    await assertSucceeds(setDoc(doc(alice(), 'rooms', ROOM, 'messages', 'p1'), { ...base, photo: { path: `rooms/${ROOM}/photos/alice/abc.jpg`, width: 10, height: 10 } }));
    await assertFails(setDoc(doc(alice(), 'rooms', ROOM, 'messages', 'p2'), { ...base, photo: { path: `rooms/${ROOM}/photos/bob/abc.jpg`, width: 10, height: 10 } }));
  });

  it('a link message starts pending', async () => {
    await seedRoom();
    await assertSucceeds(setDoc(doc(alice(), 'rooms', ROOM, 'messages', 'l1'), {
      uid: 'alice', kind: 'link', text: '', createdAt: serverTimestamp(),
      link: { url: 'https://example.com', domain: 'example.com', title: null, description: null, image: null, siteName: null, isVideo: false, status: 'pending' },
    }));
    await assertFails(setDoc(doc(alice(), 'rooms', ROOM, 'messages', 'l2'), {
      uid: 'alice', kind: 'link', text: '', createdAt: serverTimestamp(),
      link: { url: 'javascript:alert(1)', status: 'pending' },
    }));
  });
});

describe('members & mood weather', () => {
  it('each member writes only their own profile', async () => {
    await seedRoom();
    const p = { uid: 'alice', name: 'Alice', photoURL: null, mood: 'sunny', lastSeen: null, typingUntil: null };
    await assertSucceeds(setDoc(doc(alice(), 'rooms', ROOM, 'members', 'alice'), p));
    await assertFails(setDoc(doc(alice(), 'rooms', ROOM, 'members', 'bob'), { ...p, uid: 'bob' }));
    await assertFails(setDoc(doc(alice(), 'rooms', ROOM, 'members', 'alice'), { ...p, mood: 'tornado' }));
  });

  it('accepts a first profile write without optional fields, then a mood update', async () => {
    await seedRoom();
    const ref = doc(bob(), 'rooms', ROOM, 'members', 'bob');
    await assertSucceeds(setDoc(ref, { uid: 'bob', name: 'Bob', photoURL: null, lastSeen: serverTimestamp() }, { merge: true }));
    await assertSucceeds(setDoc(ref, { uid: 'bob', mood: 'foggy' }, { merge: true }));
    await assertSucceeds(setDoc(ref, { uid: 'bob', typingUntil: new Date(Date.now() + 5000) }, { merge: true }));
    await assertFails(setDoc(ref, { uid: 'bob', extra: 1 }, { merge: true }));
  });
});

describe('sealed answers (hidden until both lock in)', () => {
  it('the partner cannot read an unlocked answer', async () => {
    await seedRoom();
    await assertSucceeds(setDoc(sealedRef(alice(), 'alice'), { uid: 'alice', key: 'answer', value: 'Wrecked', locked: false, updatedAt: serverTimestamp() }));
    await assertSucceeds(getDoc(sealedRef(alice(), 'alice')));
    await assertFails(getDoc(sealedRef(bob(), 'alice')));
  });

  it('the partner cannot read a locked answer until they lock too', async () => {
    await seedRoom();
    await lockIn(alice(), 'alice', 'Wrecked');
    await assertFails(getDoc(sealedRef(bob(), 'alice')));
    // ...but can see THAT alice locked.
    await assertSucceeds(getDoc(lockRef(bob(), 'alice')));
    await lockIn(bob(), 'bob', 'Hopeful');
    await assertSucceeds(getDoc(sealedRef(bob(), 'alice')));
    await assertSucceeds(getDoc(sealedRef(alice(), 'bob')));
  });

  it('a lock on a different key does not unlock this one', async () => {
    await seedRoom();
    await lockIn(alice(), 'alice', { x: 1, y: 2 }, 's0');
    await lockIn(bob(), 'bob', { x: 3, y: 4 }, 's1');
    await assertFails(getDoc(sealedRef(bob(), 'alice', 's0')));
  });

  it('nobody can write someone else\'s answer', async () => {
    await seedRoom();
    await assertFails(setDoc(sealedRef(bob(), 'alice'), { uid: 'alice', key: 'answer', value: 'x', locked: false, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(bob(), 'rooms', ROOM, 'drops', 'd1', 'sealed', 'alice_answer'), { uid: 'bob', key: 'answer', value: 'x', locked: false, updatedAt: serverTimestamp() }));
  });

  it('a locked answer is frozen', async () => {
    await seedRoom();
    await lockIn(alice(), 'alice', 'Wrecked');
    await assertFails(setDoc(sealedRef(alice(), 'alice'), { uid: 'alice', key: 'answer', value: 'Changed', locked: false, updatedAt: serverTimestamp() }));
  });

  it('a lock marker requires a locked answer', async () => {
    await seedRoom();
    await assertFails(setDoc(lockRef(bob(), 'bob'), { uid: 'bob', key: 'answer', at: serverTimestamp() }));
    await setDoc(sealedRef(bob(), 'bob'), { uid: 'bob', key: 'answer', value: 'x', locked: false, updatedAt: serverTimestamp() });
    await assertFails(setDoc(lockRef(bob(), 'bob'), { uid: 'bob', key: 'answer', at: serverTimestamp() }));
  });

  it('queries only ever return your own answers', async () => {
    await seedRoom();
    await lockIn(alice(), 'alice', 'Wrecked');
    const sealed = collection(bob(), 'rooms', ROOM, 'drops', 'd1', 'sealed');
    await assertSucceeds(getDocs(query(sealed, where('uid', '==', 'bob'))));
    await assertFails(getDocs(sealed));
    await assertFails(getDocs(query(sealed, where('uid', '==', 'alice'))));
  });

  it('outsiders cannot read even fully revealed answers', async () => {
    await seedRoom();
    await lockIn(alice(), 'alice', 'Wrecked');
    await lockIn(bob(), 'bob', 'Hopeful');
    await assertFails(getDoc(sealedRef(eve(), 'alice')));
  });
});

describe('drops, entries & pins', () => {
  it('entries are append-only and attributed', async () => {
    await seedRoom();
    const e = doc(bob(), 'rooms', ROOM, 'drops', 'd1', 'entries', 'e1');
    await assertSucceeds(setDoc(e, { uid: 'bob', text: 'Once upon a time', createdAt: serverTimestamp() }));
    await assertFails(updateDoc(e, { text: 'changed' }));
    await assertFails(setDoc(doc(bob(), 'rooms', ROOM, 'drops', 'd1', 'entries', 'e2'), { uid: 'alice', text: 'forged', createdAt: serverTimestamp() }));
  });

  it('a drop message must reference a drop the sender created in the same batch', async () => {
    await seedRoom();
    const db = bob();
    const b = writeBatch(db);
    b.set(doc(db, 'rooms', ROOM, 'drops', 'd2'), { type: 'gap-slider', createdBy: 'bob', createdAt: serverTimestamp(), content: { question: 'q' } });
    b.set(doc(db, 'rooms', ROOM, 'messages', 'md'), { uid: 'bob', kind: 'drop', text: '', dropId: 'd2', createdAt: serverTimestamp() });
    await assertSucceeds(b.commit());
    // d1 was created by alice
    await assertFails(setDoc(doc(bob(), 'rooms', ROOM, 'messages', 'mx'), { uid: 'bob', kind: 'drop', text: '', dropId: 'd1', createdAt: serverTimestamp() }));
  });

  it('pins belong to the pinner', async () => {
    await seedRoom();
    await assertSucceeds(setDoc(doc(alice(), 'rooms', ROOM, 'pins', 'p1'), { by: 'alice', title: 'T', detail: 'D', dropId: 'd1', messageId: null, createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(alice(), 'rooms', ROOM, 'pins', 'p2'), { by: 'bob', title: 'T', detail: 'D', dropId: null, messageId: null, createdAt: serverTimestamp() }));
  });
});

describe('push tokens', () => {
  it('are private to their owner', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'users', 'alice', 'tokens', 'tok123'), { token: 'tok123', ua: 'test', updatedAt: serverTimestamp() }));
    await assertFails(getDoc(doc(bob(), 'users', 'alice', 'tokens', 'tok123')));
    await assertFails(setDoc(doc(bob(), 'users', 'alice', 'tokens', 'tok9'), { token: 'tok9', ua: '', updatedAt: serverTimestamp() }));
  });
});
