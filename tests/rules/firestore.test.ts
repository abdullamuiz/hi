import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  arrayRemove,
  arrayUnion,
  increment,
  collection,
  deleteDoc,
  deleteField,
  doc,
  FieldPath,
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
    await setDoc(doc(db, 'rooms', ROOM, 'tabs', 'general'), tabDoc('alice', 'General'));
  });
}

function tabDoc(createdBy: string, name: string, extra: Record<string, unknown> = {}) {
  return { name, colour: '#232B47', wallpaper: null, mode: 'casual', disappearing: false, archived: false, order: 0, createdBy, createdAt: new Date(), lastMessageAt: null, ...extra };
}
const msgs = (db: Firestore, tab = 'general') => collection(db, 'rooms', ROOM, 'tabs', tab, 'messages');

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
      owner: 'alice', ownerName: 'Alice', members: ['alice'], invites: ['bob@example.com'], timezone: 'Indian/Maldives', createdAt: serverTimestamp(),
    }));
  });

  it('lets a user start a room alone and invite someone later', async () => {
    const ref = doc(alice(), 'rooms', 'solo');
    await assertSucceeds(setDoc(ref, { owner: 'alice', ownerName: 'Alice', members: ['alice'], invites: [], timezone: 'Indian/Maldives', createdAt: serverTimestamp() }));
    // Bob isn't invited yet, so he can't join.
    await assertFails(updateDoc(doc(bob(), 'rooms', 'solo'), { members: ['alice', 'bob'] }));
    await assertFails(updateDoc(ref, { invites: ['alice@example.com'] }));
    await assertFails(updateDoc(ref, { invites: ['bob@example.com', 'eve@example.com'] }));
    await assertFails(updateDoc(ref, { invites: ['Bob@Example.com'] }));
    await assertSucceeds(updateDoc(ref, { invites: ['bob@example.com'] }));
    await assertSucceeds(updateDoc(doc(bob(), 'rooms', 'solo'), { members: ['alice', 'bob'] }));
    await assertFails(updateDoc(ref, { invites: ['eve@example.com'] }));
  });

  it('creates room, profile and General tab in one atomic write', async () => {
    const db = alice();
    const b = writeBatch(db);
    b.set(doc(db, 'rooms', 'atomic'), { owner: 'alice', ownerName: 'Alice', members: ['alice'], invites: [], timezone: 'Indian/Maldives', createdAt: serverTimestamp() });
    b.set(doc(db, 'rooms', 'atomic', 'members', 'alice'), { uid: 'alice', name: 'Alice', photoURL: null, lastSeen: serverTimestamp() });
    b.set(doc(db, 'rooms', 'atomic', 'tabs', 'general'), { ...tabDoc('alice', 'General'), createdAt: serverTimestamp() });
    await assertSucceeds(b.commit());
    // ...but nobody can add a profile or tab to a room they aren't in.
    await assertFails(setDoc(doc(eve(), 'rooms', 'atomic', 'members', 'eve'), { uid: 'eve', name: 'Eve', photoURL: null }));
    await assertFails(setDoc(doc(eve(), 'rooms', 'atomic', 'tabs', 'x'), { ...tabDoc('eve', 'X'), createdAt: serverTimestamp() }));
  });

  it('rejects a room created with two invites', async () => {
    await assertFails(setDoc(doc(alice(), 'rooms', 'r3'), {
      owner: 'alice', ownerName: 'Alice', members: ['alice'], invites: ['bob@example.com', 'eve@example.com'], createdAt: serverTimestamp(),
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
    await assertFails(getDocs(msgs(eve())));
  });
});

describe('messages', () => {
  it('members can post as themselves only', async () => {
    await seedRoom();
    await assertSucceeds(setDoc(doc(msgs(alice()), 'm1'), { uid: 'alice', kind: 'text', text: 'hi', createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(msgs(alice()), 'm2'), { uid: 'bob', kind: 'text', text: 'hi', createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(msgs(eve()), 'm3'), { uid: 'eve', kind: 'text', text: 'hi', createdAt: serverTimestamp() }));
  });

  it('messages are immutable', async () => {
    await seedRoom();
    await setDoc(doc(msgs(alice()), 'm1'), { uid: 'alice', kind: 'text', text: 'hi', createdAt: serverTimestamp() });
    await assertFails(updateDoc(doc(msgs(alice()), 'm1'), { text: 'edited' }));
  });

  it('a photo message must point at the sender\'s own folder', async () => {
    await seedRoom();
    const base = { uid: 'alice', kind: 'photo', text: '', createdAt: serverTimestamp() };
    await assertSucceeds(setDoc(doc(msgs(alice()), 'p1'), { ...base, photo: { path: `rooms/${ROOM}/photos/alice/abc.jpg`, width: 10, height: 10 } }));
    await assertFails(setDoc(doc(msgs(alice()), 'p2'), { ...base, photo: { path: `rooms/${ROOM}/photos/bob/abc.jpg`, width: 10, height: 10 } }));
  });

  it('a photo may carry a thumbnail next to it in the sender\'s folder', async () => {
    await seedRoom();
    const base = { uid: 'alice', kind: 'photo', text: '', createdAt: serverTimestamp() };
    await assertSucceeds(setDoc(doc(msgs(alice()), 't1'), { ...base, photo: { path: `rooms/${ROOM}/photos/alice/t1.jpg`, thumbPath: `rooms/${ROOM}/photos/alice/t1_t.jpg`, width: 10, height: 10 } }));
    await assertFails(setDoc(doc(msgs(alice()), 't2'), { ...base, photo: { path: `rooms/${ROOM}/photos/alice/t2.jpg`, thumbPath: `rooms/${ROOM}/photos/bob/t2_t.jpg`, width: 10, height: 10 } }));
  });

  it('a view-once photo lives under once/{me}/{tab}/{id}.jpg, without caption or thumbnail', async () => {
    await seedRoom();
    const base = { uid: 'alice', kind: 'photo', text: '', createdAt: serverTimestamp() };
    const once = (id: string) => ({ path: `rooms/${ROOM}/once/alice/general/${id}.jpg`, width: 10, height: 10 });
    await assertSucceeds(setDoc(doc(msgs(alice()), 'o1'), { ...base, viewLimit: 1, photo: once('o1') }));
    await assertSucceeds(setDoc(doc(msgs(alice()), 'o2'), { ...base, viewLimit: 2, photo: once('o2') }));
    await assertFails(setDoc(doc(msgs(alice()), 'o3'), { ...base, viewLimit: 3, photo: once('o3') }));
    await assertFails(setDoc(doc(msgs(alice()), 'o4'), { ...base, viewLimit: 1, photo: once('other') }));
    await assertFails(setDoc(doc(msgs(alice()), 'o5'), { ...base, text: 'caption', viewLimit: 1, photo: once('o5') }));
    await assertFails(setDoc(doc(msgs(alice()), 'o6'), { ...base, viewLimit: 1, photo: { ...once('o6'), thumbPath: `rooms/${ROOM}/photos/alice/o6_t.jpg` } }));
    await assertFails(setDoc(doc(msgs(alice()), 'o7'), { ...base, photo: once('o7') }));
    await assertFails(setDoc(doc(msgs(alice()), 'o8'), { ...base, viewLimit: 1, viewCount: 0, photo: once('o8') }));
  });

  it('views: only the recipient, one at a time, up to the limit; the limit never changes', async () => {
    await seedRoom();
    const base = { uid: 'alice', kind: 'photo', text: '', createdAt: serverTimestamp() };
    await assertSucceeds(setDoc(doc(msgs(alice()), 'v1'), { ...base, viewLimit: 2, photo: { path: `rooms/${ROOM}/once/alice/general/v1.jpg`, width: 1, height: 1 } }));
    const r = (db: Firestore) => doc(msgs(db), 'v1');
    await assertFails(updateDoc(r(alice()), { viewCount: 1 }));          // the sender can't
    await assertFails(updateDoc(r(eve()), { viewCount: 1 }));            // outsiders can't
    await assertFails(updateDoc(r(bob()), { viewCount: 2 }));            // not two at once
    await assertFails(updateDoc(r(bob()), { viewLimit: 9 }));            // the limit is fixed
    await assertFails(updateDoc(r(bob()), { viewCount: 1, text: 'x' })); // nothing else
    await assertSucceeds(updateDoc(r(bob()), { viewCount: increment(1) }));
    await assertSucceeds(updateDoc(r(bob()), { viewCount: increment(1) }));
    await assertFails(updateDoc(r(bob()), { viewCount: increment(1) })); // used up
    // A normal photo has no views to count.
    await assertSucceeds(setDoc(doc(msgs(alice()), 'n1'), { ...base, photo: { path: `rooms/${ROOM}/photos/alice/n1.jpg`, width: 1, height: 1 } }));
    await assertFails(updateDoc(doc(msgs(bob()), 'n1'), { viewCount: 1 }));
  });

  it('a link message starts pending', async () => {
    await seedRoom();
    await assertSucceeds(setDoc(doc(msgs(alice()), 'l1'), {
      uid: 'alice', kind: 'link', text: '', createdAt: serverTimestamp(),
      link: { url: 'https://example.com', domain: 'example.com', title: null, description: null, image: null, siteName: null, isVideo: false, status: 'pending' },
    }));
    await assertFails(setDoc(doc(msgs(alice()), 'l2'), {
      uid: 'alice', kind: 'link', text: '', createdAt: serverTimestamp(),
      link: { url: 'javascript:alert(1)', status: 'pending' },
    }));
  });
});

describe('tabs', () => {
  const newTab = (uid: string, extra: Record<string, unknown> = {}) => ({ ...tabDoc(uid, 'Plans', { order: 1 }), createdAt: serverTimestamp(), ...extra });

  it('members create tabs; outsiders cannot see them', async () => {
    await seedRoom();
    await assertSucceeds(setDoc(doc(bob(), 'rooms', ROOM, 'tabs', 'plans'), newTab('bob')));
    await assertFails(setDoc(doc(bob(), 'rooms', ROOM, 'tabs', 'x'), newTab('alice')));
    await assertFails(setDoc(doc(bob(), 'rooms', ROOM, 'tabs', 'y'), newTab('bob', { colour: 'red' })));
    await assertFails(getDocs(collection(eve(), 'rooms', ROOM, 'tabs')));
    await assertFails(setDoc(doc(eve(), 'rooms', ROOM, 'tabs', 'z'), newTab('eve')));
  });

  it('either member can rename/recolour/archive; General cannot be archived', async () => {
    await seedRoom();
    await setDoc(doc(bob(), 'rooms', ROOM, 'tabs', 'plans'), newTab('bob'));
    await assertSucceeds(updateDoc(doc(alice(), 'rooms', ROOM, 'tabs', 'plans'), { name: 'Trip', colour: '#36AFC6', archived: true }));
    await assertFails(updateDoc(doc(alice(), 'rooms', ROOM, 'tabs', 'plans'), { createdBy: 'alice' }));
    await assertFails(updateDoc(doc(alice(), 'rooms', ROOM, 'tabs', 'plans'), { mode: 'work' }));
    await assertFails(updateDoc(doc(alice(), 'rooms', ROOM, 'tabs', 'general'), { archived: true }));
    await assertFails(updateDoc(doc(alice(), 'rooms', ROOM, 'tabs', 'plans'), { lastMessageAt: new Date(2020, 1, 1) }));
  });

  it('a message and the tab bump commit together', async () => {
    await seedRoom();
    const db = alice();
    const b = writeBatch(db);
    b.set(doc(msgs(db), 'm1'), { uid: 'alice', kind: 'text', text: 'hi', createdAt: serverTimestamp() });
    b.update(doc(db, 'rooms', ROOM, 'tabs', 'general'), { lastMessageAt: serverTimestamp() });
    await assertSucceeds(b.commit());
  });

  it('messages need an existing tab', async () => {
    await seedRoom();
    await assertFails(setDoc(doc(msgs(alice(), 'nope'), 'm1'), { uid: 'alice', kind: 'text', text: 'hi', createdAt: serverTimestamp() }));
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
    await assertSucceeds(setDoc(ref, { uid: 'bob', typingUntil: new Date(Date.now() + 5000), typingTab: 'general' }, { merge: true }));
    await assertSucceeds(setDoc(ref, { uid: 'bob', lastRead: { general: serverTimestamp() } }, { merge: true }));
    await assertFails(setDoc(ref, { uid: 'bob', extra: 1 }, { merge: true }));
  });
});

describe('a secret picked while creating a Drop (Two Truths: the lie)', () => {
  it('can be sealed and locked in the same write as the new Drop, and stays hidden', async () => {
    await seedRoom();
    const db = alice();
    const b = writeBatch(db);
    const d = doc(db, 'rooms', ROOM, 'drops', 'tt1');
    b.set(d, { type: 'two-truths', createdBy: 'alice', createdAt: serverTimestamp(), content: { a: 'x', b: 'y', c: 'z' } });
    b.set(doc(d, 'sealed', 'alice_lie'), { uid: 'alice', key: 'lie', value: 2, locked: true, updatedAt: serverTimestamp() });
    b.set(doc(d, 'locks', 'alice_lie'), { uid: 'alice', key: 'lie', at: serverTimestamp() });
    await assertSucceeds(b.commit());
    // Bob can't read the lie until he has locked his guess under the same key.
    await assertFails(getDoc(doc(bob(), 'rooms', ROOM, 'drops', 'tt1', 'sealed', 'alice_lie')));
    const bdb = bob();
    const g = writeBatch(bdb);
    g.set(doc(bdb, 'rooms', ROOM, 'drops', 'tt1', 'sealed', 'bob_lie'), { uid: 'bob', key: 'lie', value: 1, locked: true, updatedAt: serverTimestamp() });
    g.set(doc(bdb, 'rooms', ROOM, 'drops', 'tt1', 'locks', 'bob_lie'), { uid: 'bob', key: 'lie', at: serverTimestamp() });
    await assertSucceeds(g.commit());
    await assertSucceeds(getDoc(doc(bdb, 'rooms', ROOM, 'drops', 'tt1', 'sealed', 'alice_lie')));
  });

  it('a Time Capsule still refuses an early open after the change to getAfter', async () => {
    await seedRoom();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'rooms', ROOM, 'drops', 'tc1'), { type: 'time-capsule', createdBy: 'alice', createdAt: new Date(), content: { openOn: '2099-01-01', openAtMs: Date.UTC(2099, 0, 1) } });
    });
    await assertFails(setDoc(doc(bob(), 'rooms', ROOM, 'drops', 'tc1', 'sealed', 'bob_msg'), { uid: 'bob', key: 'msg', value: 'opened', locked: true, updatedAt: serverTimestamp() }));
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
    b.set(doc(msgs(db), 'md'), { uid: 'bob', kind: 'drop', text: '', dropId: 'd2', createdAt: serverTimestamp() });
    await assertSucceeds(b.commit());
    // d1 was created by alice
    await assertFails(setDoc(doc(msgs(bob()), 'mx'), { uid: 'bob', kind: 'drop', text: '', dropId: 'd1', createdAt: serverTimestamp() }));
  });

  it('pins belong to the pinner', async () => {
    await seedRoom();
    await assertSucceeds(setDoc(doc(alice(), 'rooms', ROOM, 'pins', 'p1'), { by: 'alice', title: 'T', detail: 'D', dropId: 'd1', messageId: null, createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(alice(), 'rooms', ROOM, 'pins', 'p2'), { by: 'bob', title: 'T', detail: 'D', dropId: null, messageId: null, createdAt: serverTimestamp() }));
  });
});

const CODE = 'a1B2c3D4e5F6g7H8i9J0';
const carol = () => env.authenticatedContext('carol', { email: 'carol@example.com', email_verified: false }).firestore() as unknown as Firestore;

/** Joins a room with a share-link code: the same batch the app sends. */
function joinWithCode(db: Firestore, uid: string, code: string, room = ROOM) {
  const b = writeBatch(db);
  b.update(doc(db, 'rooms', room), { members: arrayUnion(uid), invites: [], inviteCode: deleteField(), joinCode: code });
  b.set(doc(db, 'rooms', room, 'members', uid), { uid, name: uid, photoURL: null, lastSeen: serverTimestamp() });
  return b.commit();
}

async function seedSolo(extra: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'rooms', ROOM), { owner: 'alice', ownerName: 'Alice', members: ['alice'], invites: [], inviteCode: CODE, createdAt: new Date(), ...extra });
    await setDoc(doc(db, 'rooms', ROOM, 'tabs', 'general'), tabDoc('alice', 'General'));
  });
}

describe('many contacts & share links', () => {
  it('a room can be created with a share-link code, but not a weak one', async () => {
    const base = { owner: 'alice', ownerName: 'Alice', members: ['alice'], invites: [], timezone: 'Indian/Maldives', createdAt: serverTimestamp() };
    await assertSucceeds(setDoc(doc(alice(), 'rooms', 'c1'), { ...base, inviteCode: CODE }));
    await assertFails(setDoc(doc(alice(), 'rooms', 'c2'), { ...base, inviteCode: 'short' }));
    await assertFails(setDoc(doc(alice(), 'rooms', 'c3'), { ...base, inviteCode: 'has spaces and is long enough' }));
  });

  it('a person can have several rooms', async () => {
    const base = { owner: 'alice', ownerName: 'Alice', members: ['alice'], invites: [], timezone: 'Indian/Maldives', createdAt: serverTimestamp() };
    await assertSucceeds(setDoc(doc(alice(), 'rooms', 'x1'), base));
    await assertSucceeds(setDoc(doc(alice(), 'rooms', 'x2'), { ...base, invites: ['bob@example.com'] }));
    await assertSucceeds(getDocs(query(collection(alice(), 'rooms'), where('members', 'array-contains', 'alice'))));
  });

  it('anyone with the right code joins (even an unverified account); the code is then used up', async () => {
    await seedSolo();
    await assertFails(joinWithCode(carol(), 'carol', 'wrongwrongwrongwrong'));
    await assertSucceeds(joinWithCode(carol(), 'carol', CODE));
    await assertSucceeds(getDoc(doc(carol(), 'rooms', ROOM)));
    // Full now: the same link can't add anyone else.
    await assertFails(joinWithCode(eve(), 'eve', CODE));
    await assertFails(getDoc(doc(eve(), 'rooms', ROOM)));
  });

  it('strangers can neither read a room nor join it without the code', async () => {
    await seedSolo();
    await assertFails(getDoc(doc(eve(), 'rooms', ROOM)));
    await assertFails(updateDoc(doc(eve(), 'rooms', ROOM), { members: ['alice', 'eve'] }));
    // Joining must use up the code and add only yourself.
    await assertFails(updateDoc(doc(eve(), 'rooms', ROOM), { members: ['alice', 'eve'], joinCode: CODE }));
    await assertFails(updateDoc(doc(eve(), 'rooms', ROOM), { members: ['alice', 'eve', 'mallory'], invites: [], inviteCode: deleteField(), joinCode: CODE }));
    // ...and a room without a code can't be joined by code.
    await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'rooms', ROOM), { inviteCode: deleteField() }));
    await assertFails(joinWithCode(eve(), 'eve', CODE));
  });

  it('you cannot join your own room by code', async () => {
    await seedSolo();
    await assertFails(updateDoc(doc(alice(), 'rooms', ROOM), { members: ['alice', 'alice'], invites: [], inviteCode: deleteField(), joinCode: CODE }));
  });

  it('the owner can regenerate or revoke the code while alone, nobody else can', async () => {
    await seedSolo();
    await assertSucceeds(updateDoc(doc(alice(), 'rooms', ROOM), { inviteCode: 'Z'.repeat(20) }));
    await assertFails(joinWithCode(carol(), 'carol', CODE));
    await assertSucceeds(updateDoc(doc(alice(), 'rooms', ROOM), { inviteCode: deleteField() }));
    await assertFails(updateDoc(doc(eve(), 'rooms', ROOM), { inviteCode: 'E'.repeat(20) }));
  });

  it('an e-mail invitee can decline; the owner can remove a room nobody joined', async () => {
    await seedSolo({ invites: ['bob@example.com'] });
    await assertFails(updateDoc(doc(eve(), 'rooms', ROOM), { invites: [] }));
    await assertSucceeds(updateDoc(doc(bob(), 'rooms', ROOM), { invites: [] }));
    await assertFails(deleteDoc(doc(bob(), 'rooms', ROOM)));
    await assertSucceeds(deleteDoc(doc(alice(), 'rooms', ROOM)));
  });

  it('a full room cannot be deleted', async () => {
    await seedRoom();
    await assertFails(deleteDoc(doc(alice(), 'rooms', ROOM)));
  });

  it('an e-mail invitee joining also uses up the share code', async () => {
    await seedSolo({ invites: ['bob@example.com'] });
    const db = bob();
    const b = writeBatch(db);
    b.update(doc(db, 'rooms', ROOM), { members: arrayUnion('bob'), inviteCode: deleteField() });
    await assertSucceeds(b.commit());
  });

  it('members keep the chat-list summary up to date, as themselves', async () => {
    await seedRoom();
    const db = alice();
    const b = writeBatch(db);
    b.set(doc(msgs(db), 'm1'), { uid: 'alice', kind: 'text', text: 'hi', createdAt: serverTimestamp() });
    b.update(doc(db, 'rooms', ROOM), { lastMessage: { id: 'm1', uid: 'alice', tabId: 'general', text: 'hi', at: serverTimestamp() } });
    await assertSucceeds(b.commit());
    await assertFails(updateDoc(doc(bob(), 'rooms', ROOM), { lastMessage: { id: 'm2', uid: 'alice', tabId: 'general', text: 'forged', at: serverTimestamp() } }));
    await assertFails(updateDoc(doc(alice(), 'rooms', ROOM), { lastMessage: { id: 'm2', uid: 'alice', tabId: 'general', text: 'old', at: new Date(2020, 1, 1) } }));
    await assertFails(updateDoc(doc(eve(), 'rooms', ROOM), { lastMessage: { id: 'm3', uid: 'eve', tabId: 'general', text: 'x', at: serverTimestamp() } }));
  });
});

describe('message actions (Phase 2)', () => {
  const ref = (db: Firestore, id = 'm1') => doc(msgs(db), id);
  async function seedMsg(extra: Record<string, unknown> = {}, id = 'm1') {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'rooms', ROOM, 'tabs', 'general', 'messages', id), {
      uid: 'alice', kind: 'text', text: 'Hello there friend', createdAt: new Date(), ...extra,
    }));
  }

  it('a new message can quote another', async () => {
    await seedRoom();
    await assertSucceeds(setDoc(ref(bob(), 'r1'), { uid: 'bob', kind: 'text', text: 'yes!', replyTo: { msgId: 'm1', snippet: 'Hello', senderId: 'alice' }, createdAt: serverTimestamp() }));
    await assertFails(setDoc(ref(bob(), 'r2'), { uid: 'bob', kind: 'text', text: 'yes!', replyTo: { msgId: 'm1', snippet: 'Hello', senderId: 'alice', extra: 1 }, createdAt: serverTimestamp() }));
  });

  it('the sender can edit text within 15 minutes', async () => {
    await seedRoom();
    await seedMsg();
    await assertSucceeds(updateDoc(ref(alice()), { text: 'Hello there, friend', editedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref(alice()), { text: 'x', editedAt: new Date(2020, 1, 1) }));
    await assertFails(updateDoc(ref(alice()), { text: 'x', editedAt: serverTimestamp(), uid: 'bob' }));
    await assertFails(updateDoc(ref(bob()), { text: 'Bob was here', editedAt: serverTimestamp() }));
  });

  it('no edits after 15 minutes', async () => {
    await seedRoom();
    await seedMsg({ createdAt: new Date(Date.now() - 16 * 60_000) });
    await assertFails(updateDoc(ref(alice()), { text: 'too late', editedAt: serverTimestamp() }));
  });

  it('delete for me only adds or removes your own uid', async () => {
    await seedRoom();
    await seedMsg();
    await assertSucceeds(updateDoc(ref(bob()), { hiddenFor: arrayUnion('bob') }));
    await assertSucceeds(updateDoc(ref(bob()), { hiddenFor: arrayRemove('bob') }));
    await assertFails(updateDoc(ref(bob()), { hiddenFor: arrayUnion('alice') }));
    await assertFails(updateDoc(ref(bob()), { hiddenFor: arrayUnion('bob'), text: 'x' }));
    await assertFails(updateDoc(ref(eve()), { hiddenFor: arrayUnion('eve') }));
  });

  it('delete for everyone: sender only, content cleared', async () => {
    await seedRoom();
    await seedMsg({ reactions: { heart: ['bob'] }, replyTo: { msgId: 'x', snippet: 's', senderId: 'bob' } });
    const clear = { deleted: true, text: '', link: deleteField(), photo: deleteField(), dropId: deleteField(), replyTo: deleteField(), reactions: deleteField(), phraseReactions: deleteField(), editedAt: deleteField() };
    await assertFails(updateDoc(ref(bob()), clear));
    await assertFails(updateDoc(ref(alice()), { deleted: true }));
    await assertFails(updateDoc(ref(alice()), { ...clear, text: 'still here' }));
    await assertSucceeds(updateDoc(ref(alice()), clear));
    // A deleted message can't be edited or reacted to.
    await assertFails(updateDoc(ref(alice()), { text: 'back', editedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref(bob()), { [`reactions.heart`]: arrayUnion('bob') }));
  });

  it('photo messages can be deleted for everyone', async () => {
    await seedRoom();
    await seedMsg({ kind: 'photo', text: 'cap', photo: { path: `rooms/${ROOM}/photos/alice/p.jpg`, width: 1, height: 1 } }, 'p1');
    await assertSucceeds(updateDoc(ref(alice(), 'p1'), { deleted: true, text: '', photo: deleteField() }));
  });

  it('reactions: only your own uid, only the six codes', async () => {
    await seedRoom();
    await seedMsg();
    await assertSucceeds(updateDoc(ref(bob()), new FieldPath('reactions', 'heart'), arrayUnion('bob')));
    await assertSucceeds(updateDoc(ref(alice()), new FieldPath('reactions', 'heart'), arrayUnion('alice')));
    await assertSucceeds(updateDoc(ref(bob()), new FieldPath('reactions', 'heart'), arrayRemove('bob')));
    await assertFails(updateDoc(ref(bob()), new FieldPath('reactions', 'heart'), arrayRemove('alice')));
    await assertFails(updateDoc(ref(bob()), new FieldPath('reactions', 'fire'), arrayUnion('alice')));
    await assertFails(updateDoc(ref(bob()), new FieldPath('reactions', 'poop'), arrayUnion('bob')));
    await assertFails(updateDoc(ref(eve()), new FieldPath('reactions', 'fire'), arrayUnion('eve')));
  });

  it('phrase reactions: append or remove your own', async () => {
    await seedRoom();
    await seedMsg();
    const mine = { uid: 'bob', start: 0, end: 5, reaction: 'laugh' };
    await assertSucceeds(updateDoc(ref(bob()), { phraseReactions: arrayUnion(mine) }));
    const hers = { uid: 'alice', start: 6, end: 11, reaction: 'heart' };
    await assertSucceeds(updateDoc(ref(alice()), { phraseReactions: arrayUnion(hers) }));
    await assertFails(updateDoc(ref(alice()), { phraseReactions: arrayRemove(mine) }));
    await assertFails(updateDoc(ref(bob()), { phraseReactions: arrayUnion({ uid: 'alice', start: 0, end: 2, reaction: 'fire' }) }));
    await assertFails(updateDoc(ref(bob()), { phraseReactions: arrayUnion({ uid: 'bob', start: 5, end: 2, reaction: 'fire' }) }));
    await assertFails(updateDoc(ref(bob()), { phraseReactions: arrayUnion({ uid: 'bob', start: 0, end: 2, reaction: 'nope' }) }));
    await assertSucceeds(updateDoc(ref(bob()), { phraseReactions: arrayRemove(mine) }));
  });

  it('voice notes: own file in this room, short waveform, sensible length', async () => {
    await seedRoom();
    const voice = (extra: Record<string, unknown> = {}) => ({
      path: `rooms/${ROOM}/voice/bob/v1.webm`, durationMs: 2300, peaks: [0.1, 0.5, 1], mime: 'audio/webm', ...extra,
    });
    const msg = (v: Record<string, unknown>, more: Record<string, unknown> = {}) => ({ uid: 'bob', kind: 'voice', text: '', voice: v, createdAt: serverTimestamp(), ...more });
    await assertSucceeds(setDoc(ref(bob(), 'v1'), msg(voice())));
    await assertSucceeds(setDoc(ref(bob(), 'v2'), msg(voice({ path: `rooms/${ROOM}/voice/bob/v2.m4a`, mime: 'audio/mp4' }))));
    await assertFails(setDoc(ref(bob(), 'v3'), msg(voice({ path: `rooms/${ROOM}/voice/alice/v3.webm` }))));
    await assertFails(setDoc(ref(bob(), 'v4'), msg(voice({ path: `rooms/other/voice/bob/v4.webm` }))));
    await assertFails(setDoc(ref(bob(), 'v5'), msg(voice({ durationMs: 0 }))));
    await assertFails(setDoc(ref(bob(), 'v6'), msg(voice({ durationMs: 200000 }))));
    await assertFails(setDoc(ref(bob(), 'v7'), msg(voice({ peaks: new Array(65).fill(0.5) }))));
    await assertFails(setDoc(ref(bob(), 'v8'), msg(voice({ mime: 'text/html' }))));
    await assertFails(setDoc(ref(bob(), 'v9'), msg(voice({ extra: 1 }))));
    await assertFails(setDoc(ref(bob(), 'v10'), msg(voice(), { text: 'hidden words' })));
    await assertFails(setDoc(ref(eve(), 'v11'), { ...msg(voice()), uid: 'eve' }));
  });

  it('voice notes: played marks and timed reactions are your own only', async () => {
    await seedRoom();
    await seedMsg({ kind: 'voice', text: '', voice: { path: `rooms/${ROOM}/voice/alice/v.webm`, durationMs: 4000, peaks: [0.2], mime: 'audio/webm' } }, 'vn');
    await assertSucceeds(updateDoc(ref(bob(), 'vn'), { playedBy: arrayUnion('bob') }));
    await assertFails(updateDoc(ref(bob(), 'vn'), { playedBy: arrayUnion('alice') }));
    await assertFails(updateDoc(ref(eve(), 'vn'), { playedBy: arrayUnion('eve') }));
    const mine = { uid: 'bob', atMs: 1500, reaction: 'laugh' };
    await assertSucceeds(updateDoc(ref(bob(), 'vn'), { voiceReactions: arrayUnion(mine) }));
    const hers = { uid: 'alice', atMs: 3000, reaction: 'heart' };
    await assertSucceeds(updateDoc(ref(alice(), 'vn'), { voiceReactions: arrayUnion(hers) }));
    await assertFails(updateDoc(ref(alice(), 'vn'), { voiceReactions: arrayRemove(mine) }));
    await assertFails(updateDoc(ref(bob(), 'vn'), { voiceReactions: arrayUnion({ uid: 'alice', atMs: 1, reaction: 'fire' }) }));
    await assertFails(updateDoc(ref(bob(), 'vn'), { voiceReactions: arrayUnion({ uid: 'bob', atMs: -1, reaction: 'fire' }) }));
    await assertFails(updateDoc(ref(bob(), 'vn'), { voiceReactions: arrayUnion({ uid: 'bob', atMs: 1, reaction: 'nope' }) }));
    await assertSucceeds(updateDoc(ref(bob(), 'vn'), { voiceReactions: arrayRemove(mine) }));
    // Not on text messages.
    await seedMsg();
    await assertFails(updateDoc(ref(bob()), { playedBy: arrayUnion('bob') }));
    await assertFails(updateDoc(ref(bob()), { voiceReactions: arrayUnion(mine) }));
    // Delete for everyone clears the voice note and its reactions.
    await assertFails(updateDoc(ref(alice(), 'vn'), { deleted: true, text: '' }));
    await assertSucceeds(updateDoc(ref(alice(), 'vn'), { deleted: true, text: '', voice: deleteField(), voiceReactions: deleteField(), playedBy: deleteField() }));
    await assertFails(updateDoc(ref(bob(), 'vn'), { playedBy: arrayUnion('bob') }));
  });

  it('other changes stay forbidden', async () => {
    await seedRoom();
    await seedMsg();
    await assertFails(updateDoc(ref(alice()), { kind: 'photo' }));
    await assertFails(updateDoc(ref(bob()), { text: 'rewritten' }));
    await assertFails(deleteDoc(ref(alice())));
  });

  it('plain messages can be pinned', async () => {
    await seedRoom();
    await assertSucceeds(setDoc(doc(bob(), 'rooms', ROOM, 'pins', 'pm'), { by: 'bob', title: 'alice', detail: 'Hello there', dropId: null, messageId: 'm1', tabId: 'general', createdAt: serverTimestamp() }));
  });
});

describe('push tokens', () => {
  it('are private to their owner', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'users', 'alice', 'tokens', 'tok123'), { token: 'tok123', ua: 'test', updatedAt: serverTimestamp() }));
    await assertFails(getDoc(doc(bob(), 'users', 'alice', 'tokens', 'tok123')));
    await assertFails(setDoc(doc(bob(), 'users', 'alice', 'tokens', 'tok9'), { token: 'tok9', ua: '', updatedAt: serverTimestamp() }));
  });
});

describe('profiles, notes, nicknames', () => {
  const profile = (extra: Record<string, unknown> = {}) => ({ name: 'Alice', photo: null, about: 'Tea first', note: null, updatedAt: serverTimestamp(), ...extra });

  it('lets me write only my own profile, with sane fields', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'profiles', 'alice'), profile()));
    await assertFails(setDoc(doc(eve(), 'profiles', 'alice'), profile({ name: 'Not Alice' })));
    await assertFails(setDoc(doc(alice(), 'profiles', 'alice'), profile({ name: '' })));
    await assertFails(setDoc(doc(alice(), 'profiles', 'alice'), profile({ about: 'x'.repeat(81) })));
    await assertFails(setDoc(doc(alice(), 'profiles', 'alice'), profile({ email: 'alice@example.com' })));
    await assertFails(setDoc(doc(alice(), 'profiles', 'alice'), profile({ photo: 'javascript:alert(1)' })));
    await assertSucceeds(setDoc(doc(alice(), 'profiles', 'alice'), profile({ photo: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' })));
    await assertSucceeds(setDoc(doc(alice(), 'profiles', 'alice'), profile({ photo: 'https://lh3.googleusercontent.com/a/x' })));
    // Anyone signed in can read it (they need the uid); signed-out visitors can't.
    await assertSucceeds(getDoc(doc(bob(), 'profiles', 'alice')));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore() as unknown as Firestore, 'profiles', 'alice')));
  });

  it('stamps a new note with the server time and keeps it short', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'profiles', 'alice'), profile()));
    const ref = doc(alice(), 'profiles', 'alice');
    await assertSucceeds(updateDoc(ref, { note: { text: 'exam tomorrow, send snacks', emoji: '📚', at: serverTimestamp() }, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { note: { text: 'backdated', emoji: '', at: new Date(2020, 1, 1) }, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { note: { text: 'x'.repeat(61), emoji: '', at: serverTimestamp() }, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { note: { text: '', emoji: '', at: serverTimestamp() }, updatedAt: serverTimestamp() }));
    // Editing my about line keeps the existing note as it is.
    await assertSucceeds(updateDoc(ref, { about: 'Coffee now', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { note: null, updatedAt: serverTimestamp() }));
  });

  it('keeps nicknames, mutes and blocks private', async () => {
    const nick = doc(alice(), 'users', 'alice', 'contacts', 'bob');
    await assertSucceeds(setDoc(nick, { nickname: 'Bobby 🐻', muted: false, updatedAt: serverTimestamp() }));
    await assertFails(getDoc(doc(bob(), 'users', 'alice', 'contacts', 'bob')));
    await assertFails(setDoc(doc(bob(), 'users', 'alice', 'contacts', 'bob'), { nickname: 'x', updatedAt: serverTimestamp() }));
    await assertFails(setDoc(nick, { nickname: 'x'.repeat(41), updatedAt: serverTimestamp() }));
    await assertSucceeds(setDoc(doc(alice(), 'users', 'alice', 'blocked', 'eve'), { name: 'Eve', at: serverTimestamp() }));
    await assertFails(getDoc(doc(eve(), 'users', 'alice', 'blocked', 'eve')));
    await assertFails(setDoc(doc(alice(), 'users', 'alice', 'blocked', 'alice'), { name: 'Me', at: serverTimestamp() }));
  });

  it('accepts a reply to a note as a quoted text message', async () => {
    await seedRoom();
    await assertSucceeds(setDoc(doc(msgs(bob())), { uid: 'bob', kind: 'text', text: 'Good luck!', replyToNote: { text: 'exam tomorrow', emoji: '📚' }, createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(msgs(bob())), { uid: 'bob', kind: 'text', text: 'x', replyToNote: { text: 'y'.repeat(61), emoji: '' }, createdAt: serverTimestamp() }));
  });
});

describe('leaving, blocking', () => {
  it('lets a member leave; the chat then goes read-only and can never be re-joined', async () => {
    await seedRoom();
    await assertFails(updateDoc(doc(eve(), 'rooms', ROOM), { members: ['alice'], left: 'eve', invites: [] }));
    // Bob can only remove himself, and the old e-mail invite must go with him.
    await assertFails(updateDoc(doc(bob(), 'rooms', ROOM), { members: ['bob'], left: 'bob', invites: [] }));
    await assertFails(updateDoc(doc(bob(), 'rooms', ROOM), { members: ['alice'], left: 'alice', invites: [] }));
    await assertFails(updateDoc(doc(bob(), 'rooms', ROOM), { members: ['alice'], left: 'bob' }));
    await assertSucceeds(updateDoc(doc(bob(), 'rooms', ROOM), { members: ['alice'], left: 'bob', invites: [] }));
    // Bob can't read it any more; Alice can, but can't write in it.
    await assertFails(getDoc(doc(bob(), 'rooms', ROOM)));
    await assertSucceeds(getDoc(doc(alice(), 'rooms', ROOM)));
    await assertFails(setDoc(doc(msgs(alice())), { uid: 'alice', kind: 'text', text: 'hello?', createdAt: serverTimestamp() }));
    // Nobody can come back in: not Bob by e-mail, not with a new code.
    await assertFails(updateDoc(doc(bob(), 'rooms', ROOM), { members: ['alice', 'bob'] }));
    await assertFails(updateDoc(doc(alice(), 'rooms', ROOM), { inviteCode: 'abcdefghijklmnop1234' }));
    // Alice, the last one in, can delete the chat.
    await assertFails(deleteDoc(doc(eve(), 'rooms', ROOM)));
    await assertSucceeds(deleteDoc(doc(alice(), 'rooms', ROOM)));
  });

  it("refuses a join from someone the owner blocked", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'rooms', 'r9'), { owner: 'alice', ownerName: 'Alice', members: ['alice'], invites: ['eve@example.com'], inviteCode: 'abcdefghijklmnop1234', createdAt: new Date() });
      await setDoc(doc(db, 'users', 'alice', 'blocked', 'eve'), { name: 'Eve', at: new Date() });
    });
    await assertFails(updateDoc(doc(eve(), 'rooms', 'r9'), { members: ['alice', 'eve'] }));
    await assertFails(updateDoc(doc(eve(), 'rooms', 'r9'), { members: ['alice', 'eve'], invites: [], inviteCode: deleteField(), joinCode: 'abcdefghijklmnop1234' }));
    // Someone else with the code still can.
    await assertSucceeds(updateDoc(doc(bob(), 'rooms', 'r9'), { members: ['alice', 'bob'], invites: [], inviteCode: deleteField(), joinCode: 'abcdefghijklmnop1234' }));
  });
});

describe('delivery: read receipts, scheduled, urgent, mute', () => {
  const SID = 'abcdefghij0123456789';
  const sched = (db: Firestore, id = SID) => doc(db, 'rooms', ROOM, 'scheduled', id);
  const soon = () => new Date(Date.now() + 3_600_000);
  const schedDoc = (extra: Record<string, unknown> = {}) => ({ senderId: 'alice', tabId: 'general', text: 'Happy birthday!', sendAt: soon(), createdAt: serverTimestamp(), ...extra });
  async function deliver(db: Firestore, uid: string, id = SID, extra: Record<string, unknown> = {}) {
    const b = writeBatch(db);
    b.delete(sched(db, id));
    b.set(doc(msgs(db), id), { uid, kind: 'text', text: 'Happy birthday!', scheduled: true, createdAt: serverTimestamp(), ...extra });
    return b.commit();
  }

  it('my own "read up to" copy is private', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'users', 'alice', 'reads', ROOM), { lastRead: { general: serverTimestamp() } }));
    await assertFails(getDoc(doc(bob(), 'users', 'alice', 'reads', ROOM)));
    await assertFails(setDoc(doc(bob(), 'users', 'alice', 'reads', ROOM), { lastRead: {} }));
    await assertFails(setDoc(doc(alice(), 'users', 'alice', 'reads', ROOM), { lastRead: {}, extra: 1 }));
  });

  it('read receipts off: I can clear the shared "read up to" times', async () => {
    await seedRoom();
    await assertSucceeds(setDoc(doc(alice(), 'rooms', ROOM, 'members', 'alice'), { uid: 'alice', lastRead: { general: serverTimestamp() } }, { merge: true }));
    await assertSucceeds(updateDoc(doc(alice(), 'rooms', ROOM, 'members', 'alice'), { lastRead: {} }));
    await assertSucceeds(setDoc(doc(alice(), 'users', 'alice'), { readReceipts: false, quiet: { on: true, start: '21:00', end: '07:00', tz: 'UTC' } }, { merge: true }));
  });

  it('the urgent count belongs to the server', async () => {
    await assertFails(setDoc(doc(alice(), 'users', 'alice'), { urgent: { day: '2026-11-24', count: 0 } }));
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'users', 'alice'), { urgent: { day: '2026-11-24', count: 3 } }));
    await assertFails(updateDoc(doc(alice(), 'users', 'alice'), { urgent: { day: '2026-11-24', count: 0 } }));
    await assertSucceeds(updateDoc(doc(alice(), 'users', 'alice'), { theme: { palette: 'hi', mode: 'dark' } }));
  });

  it('scheduled messages: only the sender sees or changes them', async () => {
    await seedRoom();
    await assertSucceeds(setDoc(sched(alice()), schedDoc()));
    await assertSucceeds(getDoc(sched(alice())));
    await assertFails(getDoc(sched(bob())));
    await assertSucceeds(getDocs(query(collection(alice(), 'rooms', ROOM, 'scheduled'), where('senderId', '==', 'alice'))));
    await assertFails(getDocs(collection(bob(), 'rooms', ROOM, 'scheduled')));
    await assertFails(getDocs(collection(eve(), 'rooms', ROOM, 'scheduled')));
    await assertSucceeds(updateDoc(sched(alice()), { text: 'Happy birthday!!', sendAt: soon() }));
    await assertFails(updateDoc(sched(alice()), { senderId: 'bob' }));
    await assertFails(updateDoc(sched(bob()), { text: 'mine now' }));
    await assertFails(deleteDoc(sched(bob())));
    await assertSucceeds(deleteDoc(sched(alice())));
  });

  it('scheduled messages need a future time, a real tab, and the sender as themselves', async () => {
    await seedRoom();
    await assertFails(setDoc(sched(alice()), schedDoc({ sendAt: new Date(Date.now() - 60_000) })));
    await assertFails(setDoc(sched(alice()), schedDoc({ sendAt: new Date(Date.now() + 400 * 86_400_000) })));
    await assertFails(setDoc(sched(alice()), schedDoc({ tabId: 'nope' })));
    await assertFails(setDoc(sched(alice()), schedDoc({ senderId: 'bob' })));
    await assertFails(setDoc(sched(eve()), schedDoc({ senderId: 'eve' })));
    await assertFails(setDoc(sched(alice(), 'short'), schedDoc()));
    await assertFails(setDoc(sched(alice()), schedDoc({ text: '' })));
  });

  it('delivery: once, as the sender, removing the scheduled message in the same write', async () => {
    await seedRoom();
    await setDoc(sched(alice()), schedDoc());
    // Bob can't deliver Alice's message, nor fake a "scheduled" one.
    await assertFails(deliver(bob(), 'bob'));
    await assertFails(setDoc(doc(msgs(bob()), 'x1234567890123456789'), { uid: 'bob', kind: 'text', text: 'hi', scheduled: true, createdAt: serverTimestamp() }));
    // Without removing the scheduled doc it isn't allowed.
    await assertFails(setDoc(doc(msgs(alice()), SID), { uid: 'alice', kind: 'text', text: 'hi', scheduled: true, createdAt: serverTimestamp() }));
    await assertSucceeds(deliver(alice(), 'alice'));
    // A second delivery finds nothing to deliver.
    await assertFails(deliver(alice(), 'alice'));
  });

  it('urgent is a true-only flag on new messages', async () => {
    await seedRoom();
    await assertSucceeds(setDoc(doc(msgs(alice())), { uid: 'alice', kind: 'text', text: 'call me', urgent: true, createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(msgs(alice())), { uid: 'alice', kind: 'text', text: 'call me', urgent: 'yes', createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(msgs(alice())), { uid: 'alice', kind: 'text', text: 'call me', urgent: false, createdAt: serverTimestamp() }));
  });

  it('mute for a while is stored privately', async () => {
    const ref = doc(alice(), 'users', 'alice', 'contacts', 'bob');
    await assertSucceeds(setDoc(ref, { muted: false, mutedUntil: new Date(Date.now() + 8 * 3_600_000), updatedAt: serverTimestamp() }));
    await assertSucceeds(setDoc(ref, { muted: false, mutedUntil: null, updatedAt: serverTimestamp() }, { merge: true }));
    await assertFails(setDoc(ref, { mutedUntil: 'tomorrow', updatedAt: serverTimestamp() }, { merge: true }));
    await assertFails(getDoc(doc(bob(), 'users', 'alice', 'contacts', 'bob')));
  });
});

describe('disappearing tabs (Phase 4)', () => {
  const H = 3_600_000;
  const tabRef = (db: Firestore, tab = 'general') => doc(db, 'rooms', ROOM, 'tabs', tab);
  const sys = (db: Firestore, hours: number, text = 'Disappearing messages: 7 days') => {
    const b = writeBatch(db);
    b.update(tabRef(db), hours > 0 ? { disappearing: true, ttlHours: hours } : { disappearing: false });
    const exp = hours > 0 ? { expiresAt: new Date(Date.now() + hours * H) } : {};
    b.set(doc(msgs(db)), { uid: 'alice', kind: 'system', system: 'disappearing', ttlHours: hours, text, ...exp, createdAt: serverTimestamp() });
    return b.commit();
  };
  async function turnOn(hours = 168) {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'rooms', ROOM, 'tabs', 'general'), { disappearing: true, ttlHours: hours });
    });
  }

  it('a member switches it on with an announcement; only real choices', async () => {
    await seedRoom();
    await assertSucceeds(sys(alice(), 168));
    await assertSucceeds(sys(alice(), 24, 'Disappearing messages: 24 hours'));
    await assertSucceeds(sys(alice(), 0, 'Disappearing messages off'));
    await assertFails(updateDoc(tabRef(alice()), { disappearing: true, ttlHours: 5 }));
    await assertFails(updateDoc(tabRef(eve()), { disappearing: true, ttlHours: 24 }));
  });

  it('an announcement needs a real change, with hours matching the new setting', async () => {
    await seedRoom();
    // No change to the tab: no announcement.
    await assertFails(setDoc(doc(msgs(alice())), { uid: 'alice', kind: 'system', system: 'disappearing', ttlHours: 0, text: 'x', createdAt: serverTimestamp() }));
    // Hours that don't match the new setting.
    const db = alice();
    const b = writeBatch(db);
    b.update(tabRef(db), { disappearing: true, ttlHours: 168 });
    b.set(doc(msgs(db)), { uid: 'alice', kind: 'system', system: 'disappearing', ttlHours: 24, text: 'x', expiresAt: new Date(Date.now() + 168 * H), createdAt: serverTimestamp() });
    await assertFails(b.commit());
  });

  it('new messages in a disappearing tab must carry the right expiry', async () => {
    await seedRoom();
    await turnOn(168);
    const base = { uid: 'alice', kind: 'text', text: 'poof', createdAt: serverTimestamp() };
    await assertSucceeds(setDoc(doc(msgs(alice())), { ...base, expiresAt: new Date(Date.now() + 168 * H) }));
    await assertFails(setDoc(doc(msgs(alice())), base));
    await assertFails(setDoc(doc(msgs(alice())), { ...base, expiresAt: new Date(Date.now() + 24 * H) }));
    await assertFails(setDoc(doc(msgs(alice())), { ...base, expiresAt: new Date(Date.now() + 400 * H) }));
    await assertFails(setDoc(doc(msgs(alice())), { ...base, expiresAt: 'later' }));
  });

  it('messages in a normal tab cannot carry an expiry', async () => {
    await seedRoom();
    await assertFails(setDoc(doc(msgs(alice())), { uid: 'alice', kind: 'text', text: 'hi', expiresAt: new Date(Date.now() + 24 * H), createdAt: serverTimestamp() }));
  });

  it('expiry can never be changed afterwards', async () => {
    await seedRoom();
    await turnOn(24);
    const ref = doc(msgs(alice()), 'e1');
    await setDoc(ref, { uid: 'alice', kind: 'text', text: 'hi', expiresAt: new Date(Date.now() + 24 * H), createdAt: serverTimestamp() });
    await assertFails(updateDoc(ref, { expiresAt: new Date(Date.now() + 1000 * H) }));
    await assertFails(updateDoc(ref, { expiresAt: deleteField() }));
  });

  it('a scheduled message delivered into a disappearing tab expires too', async () => {
    await seedRoom();
    await turnOn(24);
    const SID2 = 's2345678901234567890';
    await setDoc(doc(alice(), 'rooms', ROOM, 'scheduled', SID2), { senderId: 'alice', tabId: 'general', text: 'later', sendAt: new Date(Date.now() + 60_000), createdAt: serverTimestamp() });
    const db = alice();
    const b = writeBatch(db);
    b.delete(doc(db, 'rooms', ROOM, 'scheduled', SID2));
    b.set(doc(msgs(db), SID2), { uid: 'alice', kind: 'text', text: 'later', scheduled: true, expiresAt: new Date(Date.now() + 24 * H), createdAt: serverTimestamp() });
    await assertSucceeds(b.commit());
  });
});

describe('effects (Phase 5)', () => {
  it('a text or link message may carry one effect from the list', async () => {
    await seedRoom();
    for (const effect of ['confetti', 'balloons', 'fireworks', 'glow', 'shout', 'whisper', 'slow', 'spotlight', 'sealed', 'echo']) {
      await assertSucceeds(setDoc(doc(msgs(alice())), { uid: 'alice', kind: 'text', text: 'yay', effect, createdAt: serverTimestamp() }));
    }
    await assertSucceeds(setDoc(doc(msgs(bob())), {
      uid: 'bob', kind: 'link', text: '', effect: 'confetti', createdAt: serverTimestamp(),
      link: { url: 'https://example.com', domain: 'example.com', isVideo: false, title: null, description: null, image: null, siteName: null, status: 'pending' },
    }));
  });

  it('unknown effects, odd types and effects on other kinds are refused', async () => {
    await seedRoom();
    await assertFails(setDoc(doc(msgs(alice())), { uid: 'alice', kind: 'text', text: 'yay', effect: 'explode', createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(msgs(alice())), { uid: 'alice', kind: 'text', text: 'yay', effect: ['confetti'], createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(msgs(alice())), {
      uid: 'alice', kind: 'photo', text: '', effect: 'confetti', createdAt: serverTimestamp(),
      photo: { path: `rooms/${ROOM}/photos/alice/x.jpg`, width: 1, height: 1 },
    }));
  });

  it('the effect cannot be changed later, and goes with delete for everyone', async () => {
    await seedRoom();
    const ref = doc(msgs(alice()), 'fx1');
    await assertSucceeds(setDoc(ref, { uid: 'alice', kind: 'text', text: 'sealed note', effect: 'sealed', createdAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { effect: 'confetti' }));
    await assertFails(updateDoc(doc(msgs(bob()), 'fx1'), { effect: deleteField() }));
    await assertFails(updateDoc(ref, { deleted: true, text: '' }));
    await assertSucceeds(updateDoc(ref, { deleted: true, text: '', effect: deleteField() }));
  });
});

describe('more Drops, daily question, threads (Phase 7)', () => {
  const root = (db: Firestore) => doc(msgs(db), 'm1');
  const reply = (db: Firestore, id: string) => doc(db, 'rooms', ROOM, 'tabs', 'general', 'messages', 'm1', 'replies', id);
  async function seedRoot(extra: Record<string, unknown> = {}) {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'rooms', ROOM, 'tabs', 'general', 'messages', 'm1'), {
      uid: 'alice', kind: 'text', text: 'Plans for Saturday?', createdAt: new Date(), ...extra,
    }));
  }
  function replyBatch(db: Firestore, uid: string, id: string, count: number, text = 'Brunch?') {
    const b = writeBatch(db);
    b.set(reply(db, id), { uid, text, createdAt: serverTimestamp() });
    b.update(root(db), { thread: { count, lastAt: serverTimestamp(), lastBy: uid, lastId: id } });
    return b;
  }

  it('a thread reply is written together with the root’s count', async () => {
    await seedRoom();
    await seedRoot();
    await assertSucceeds(replyBatch(bob(), 'bob', 'r1', 1).commit());
    await assertSucceeds(replyBatch(alice(), 'alice', 'r2', 2).commit());
    // Wrong count, a reply on its own, or a bump on its own are refused.
    await assertFails(replyBatch(bob(), 'bob', 'r3', 5).commit());
    await assertFails(setDoc(reply(bob(), 'r4'), { uid: 'bob', text: 'solo', createdAt: serverTimestamp() }));
    await assertFails(updateDoc(root(bob()), { thread: { count: 3, lastAt: serverTimestamp(), lastBy: 'bob', lastId: 'r2' } }));
    // Not as someone else, not by outsiders.
    await assertFails(replyBatch(bob(), 'alice', 'r5', 3).commit());
    await assertFails(replyBatch(eve(), 'eve', 'r6', 3).commit());
    await assertFails(getDoc(reply(eve(), 'r1')));
    await assertSucceeds(getDoc(reply(alice(), 'r1')));
  });

  it('thread replies: own reactions, delete for everyone by the sender only, none on a deleted message', async () => {
    await seedRoom();
    await seedRoot();
    await assertSucceeds(replyBatch(bob(), 'bob', 'r1', 1).commit());
    await assertSucceeds(updateDoc(reply(alice(), 'r1'), new FieldPath('reactions', 'heart'), arrayUnion('alice')));
    await assertFails(updateDoc(reply(alice(), 'r1'), new FieldPath('reactions', 'heart'), arrayUnion('bob')));
    await assertFails(updateDoc(reply(alice(), 'r1'), { deleted: true, text: '' }));
    await assertFails(updateDoc(reply(bob(), 'r1'), { text: 'edited' }));
    await assertSucceeds(updateDoc(reply(bob(), 'r1'), { deleted: true, text: '', reactions: deleteField() }));
    await seedRoot({ deleted: true, text: '' });
    await assertFails(replyBatch(bob(), 'bob', 'r2', 1).commit());
  });

  it('the daily question opt-out is a private contact setting', async () => {
    const ref = doc(alice(), 'users', 'alice', 'contacts', 'bob');
    await assertSucceeds(setDoc(ref, { dailyQuestion: false, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(ref, { dailyQuestion: 'no', updatedAt: serverTimestamp() }));
  });

  it('today’s question is created once, with a fixed id, by either member', async () => {
    await seedRoom();
    const make = (db: Firestore, uid: string) => {
      const b = writeBatch(db);
      b.set(doc(db, 'rooms', ROOM, 'drops', 'daily-20261125'), { type: 'daily-question', createdBy: uid, createdAt: serverTimestamp(), content: { question: 'Q?', day: '20261125' } });
      b.set(doc(msgs(db), 'daily-20261125'), { uid, kind: 'drop', text: '', dropId: 'daily-20261125', createdAt: serverTimestamp() });
      return b.commit();
    };
    await assertSucceeds(make(bob(), 'bob'));
    // The second phone's attempt fails harmlessly: nobody can overwrite it.
    await assertFails(make(alice(), 'alice'));
    await assertFails(make(eve(), 'eve'));
  });

  it('a time capsule can’t be opened before its date', async () => {
    await seedRoom();
    const capsule = async (openAtMs: number) => env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'rooms', ROOM, 'drops', 'd1'), {
      type: 'time-capsule', createdBy: 'alice', createdAt: new Date(), content: { openOn: '2099-01-01', openAtMs },
    }));
    await capsule(Date.now() + 86400000);
    // The author seals the message any time; the other person can't answer yet.
    await assertSucceeds(lockIn(alice(), 'alice', 'Happy birthday!', 'msg'));
    await assertFails(lockIn(bob(), 'bob', 'opened', 'msg'));
    await assertFails(setDoc(sealedRef(bob(), 'bob', 'msg'), { uid: 'bob', key: 'msg', value: 'x', locked: false, updatedAt: serverTimestamp() }));
    await assertFails(getDoc(sealedRef(bob(), 'alice', 'msg')));
    // On the day: open, then read it.
    await capsule(Date.now() - 1000);
    await assertSucceeds(lockIn(bob(), 'bob', 'opened', 'msg'));
    await assertSucceeds(getDoc(sealedRef(bob(), 'alice', 'msg')));
  });

  it('a new time capsule needs its open time as a number', async () => {
    await seedRoom();
    await assertFails(setDoc(doc(alice(), 'rooms', ROOM, 'drops', 'tc'), { type: 'time-capsule', createdBy: 'alice', createdAt: serverTimestamp(), content: { openOn: '2099-01-01' } }));
    await assertSucceeds(setDoc(doc(alice(), 'rooms', ROOM, 'drops', 'tc'), { type: 'time-capsule', createdBy: 'alice', createdAt: serverTimestamp(), content: { openOn: '2099-01-01', openAtMs: 4070908800000 } }));
  });
});

describe('streaks & activity days', () => {
  const utcDay = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
  const day = (db: Firestore, key = utcDay()) => doc(db, 'rooms', ROOM, 'days', key);
  const roomRef = (db: Firestore) => doc(db, 'rooms', ROOM);

  it('members add only themselves to about-today’s activity day', async () => {
    await seedRoom();
    await assertSucceeds(setDoc(day(alice()), { uids: arrayUnion('alice') }, { merge: true }));
    await assertSucceeds(setDoc(day(bob()), { uids: arrayUnion('bob') }, { merge: true }));
    // Writing yourself again is a harmless no-op.
    await assertSucceeds(setDoc(day(bob()), { uids: arrayUnion('bob') }, { merge: true }));
    // Not someone else, not removing anyone, not an old or far-off day, not outsiders.
    await assertFails(setDoc(day(alice(), utcDay(1)), { uids: ['bob'] }));
    await assertFails(updateDoc(day(alice()), { uids: arrayRemove('bob') }));
    await assertFails(setDoc(day(alice(), utcDay(-5)), { uids: ['alice'] }));
    await assertFails(setDoc(day(alice(), '2026-13-40'), { uids: ['alice'] }));
    await assertFails(setDoc(day(eve(), utcDay(1)), { uids: ['eve'] }));
    await assertFails(getDoc(day(eve())));
    await assertSucceeds(getDoc(day(bob())));
    // A zone ahead of UTC is already on tomorrow.
    await assertSucceeds(setDoc(day(alice(), utcDay(1)), { uids: ['alice'] }));
    await assertFails(deleteDoc(day(alice())));
  });

  it('a message and its activity day commit together', async () => {
    await seedRoom();
    const db = alice();
    const b = writeBatch(db);
    b.set(doc(msgs(db), 'm1'), { uid: 'alice', kind: 'text', text: 'hi', createdAt: serverTimestamp() });
    b.update(doc(db, 'rooms', ROOM, 'tabs', 'general'), { lastMessageAt: serverTimestamp() });
    b.set(day(db), { uids: arrayUnion('alice') }, { merge: true });
    await assertSucceeds(b.commit());
  });

  it('one proposes a streak, only the other accepts, either stops it', async () => {
    await seedRoom();
    // Can't start it already "on", or in someone else's name.
    await assertFails(updateDoc(roomRef(alice()), { streak: { state: 'on', by: 'alice', at: serverTimestamp(), since: serverTimestamp() } }));
    await assertFails(updateDoc(roomRef(alice()), { streak: { state: 'proposed', by: 'bob', at: serverTimestamp() } }));
    await assertSucceeds(updateDoc(roomRef(alice()), { streak: { state: 'proposed', by: 'alice', at: serverTimestamp() } }));
    const proposed = (await getDoc(roomRef(alice()))).data()!.streak;
    // The proposer can't accept their own proposal; outsiders can't touch it.
    await assertFails(updateDoc(roomRef(alice()), { streak: { state: 'on', by: 'alice', at: proposed.at, since: serverTimestamp() } }));
    await assertFails(updateDoc(roomRef(eve()), { streak: deleteField() }));
    await assertSucceeds(updateDoc(roomRef(bob()), { streak: { state: 'on', by: 'alice', at: proposed.at, since: serverTimestamp() } }));
    const on = (await getDoc(roomRef(alice()))).data()!.streak;
    // The cached count for the chat list: sane numbers only, same start.
    await assertSucceeds(updateDoc(roomRef(alice()), { streak: { ...on, count: 3, best: 5, day: '2026-01-02' } }));
    await assertFails(updateDoc(roomRef(alice()), { streak: { ...on, count: 6, best: 5, day: '2026-01-02' } }));
    await assertFails(updateDoc(roomRef(alice()), { streak: { ...on, count: 1, best: 1, day: 'today' } }));
    await assertFails(updateDoc(roomRef(alice()), { streak: { ...on, since: serverTimestamp(), count: 1, best: 1, day: '2026-01-02' } }));
    // Streak changes go alone, never with other room fields.
    await assertFails(updateDoc(roomRef(bob()), { streak: deleteField(), invites: [] }));
    await assertSucceeds(updateDoc(roomRef(bob()), { streak: deleteField() }));
  });

  it('no streak in a chat with one person', async () => {
    await seedRoom(['alice']);
    await assertFails(updateDoc(roomRef(alice()), { streak: { state: 'proposed', by: 'alice', at: serverTimestamp() } }));
  });

  it('the Memories switch is a private contact setting', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'users', 'alice', 'contacts', 'bob'), { memories: false, updatedAt: serverTimestamp() }, { merge: true }));
    await assertFails(setDoc(doc(alice(), 'users', 'alice', 'contacts', 'bob'), { memories: 'no', updatedAt: serverTimestamp() }, { merge: true }));
  });
});

describe('sessions (Phase 9)', () => {
  const S = 's1';
  const priv = (db: Firestore, uid: string) => doc(db, 'rooms', ROOM, 'sessions', S, 'private', uid);
  const prog = (db: Firestore, uid: string) => doc(db, 'rooms', ROOM, 'sessions', S, 'users', uid);
  const answers = (db: Firestore, uid: string, done: boolean, a: Record<string, unknown> = { q1: 'a' }) =>
    setDoc(priv(db, uid), { uid, answers: a, done, updatedAt: serverTimestamp() });
  const progress = (_uid: string, done: boolean, extra: Record<string, unknown> = {}) =>
    ({ answered: done ? 4 : 1, total: 4, done, seenAt: serverTimestamp(), ...extra });
  async function finish(db: Firestore, uid: string) {
    const b = writeBatch(db);
    b.set(priv(db, uid), { uid, answers: { q1: 'a', q2: 'b' }, done: true, updatedAt: serverTimestamp() });
    b.set(prog(db, uid), progress(uid, true));
    await b.commit();
  }
  async function seedSession() {
    await seedRoom();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'rooms', ROOM, 'drops', S), { type: 'session', createdBy: 'alice', createdAt: new Date(), content: { testId: 'type-test', sessionId: S } });
      await setDoc(doc(db, 'rooms', ROOM, 'sessions', S), { testId: 'type-test', version: 1, tabId: 'general', createdBy: 'alice', createdAt: new Date() });
    });
  }

  it('is started together with its Drop card, by the person starting it', async () => {
    await seedRoom();
    const db = bob();
    const b = writeBatch(db);
    b.set(doc(db, 'rooms', ROOM, 'drops', 's2'), { type: 'session', createdBy: 'bob', createdAt: serverTimestamp(), content: { testId: 'type-test', sessionId: 's2' } });
    b.set(doc(db, 'rooms', ROOM, 'sessions', 's2'), { testId: 'type-test', version: 1, tabId: 'general', createdBy: 'bob', createdAt: serverTimestamp() });
    b.set(doc(msgs(db), 'ms'), { uid: 'bob', kind: 'drop', text: '', dropId: 's2', createdAt: serverTimestamp() });
    await assertSucceeds(b.commit());
    // No matching Drop (d1 is alice's), wrong creator, bad test id, outsider.
    await assertFails(setDoc(doc(bob(), 'rooms', ROOM, 'sessions', 'd1'), { testId: 'type-test', version: 1, tabId: 'general', createdBy: 'bob', createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(bob(), 'rooms', ROOM, 'sessions', 's3'), { testId: 'type-test', version: 1, tabId: 'general', createdBy: 'alice', createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(bob(), 'rooms', ROOM, 'sessions', 's2'), { testId: 'Type Test!', version: 1, tabId: 'general', createdBy: 'bob', createdAt: serverTimestamp() }));
    await assertFails(getDoc(doc(eve(), 'rooms', ROOM, 'sessions', 's2')));
    await assertFails(updateDoc(doc(bob(), 'rooms', ROOM, 'sessions', 's2'), { tabId: 'x' }));
  });

  it('answers stay private until BOTH have finished', async () => {
    await seedSession();
    await assertSucceeds(answers(alice(), 'alice', false));
    await assertSucceeds(getDoc(priv(alice(), 'alice')));
    await assertFails(getDoc(priv(bob(), 'alice')));
    await assertFails(answers(bob(), 'alice', false, { q1: 'b' }));               // can't write someone else's
    await assertSucceeds(finish(alice(), 'alice'));
    await assertFails(getDoc(priv(bob(), 'alice')));                              // bob hasn't finished
    await assertSucceeds(answers(bob(), 'bob', false));
    await assertFails(getDoc(priv(bob(), 'alice')));                              // still answering
    await assertSucceeds(finish(bob(), 'bob'));
    await assertSucceeds(getDoc(priv(bob(), 'alice')));
    await assertSucceeds(getDoc(priv(alice(), 'bob')));
    await assertFails(getDoc(priv(eve(), 'alice')));
    await assertFails(getDocs(collection(bob(), 'rooms', ROOM, 'sessions', S, 'private')));
  });

  it('finished answers are frozen, and nobody can un-finish', async () => {
    await seedSession();
    await assertSucceeds(answers(alice(), 'alice', false));
    await assertSucceeds(answers(alice(), 'alice', false, { q1: 'b' }));          // still editable
    await assertSucceeds(finish(alice(), 'alice'));
    await assertFails(answers(alice(), 'alice', true, { q1: 'a' }));
    await assertFails(answers(alice(), 'alice', false));
    await assertFails(setDoc(prog(alice(), 'alice'), progress('alice', false)));
    await assertFails(deleteDoc(priv(alice(), 'alice')));
  });

  it('progress: my own, and "done" only once my answers are frozen', async () => {
    await seedSession();
    await assertSucceeds(setDoc(prog(bob(), 'bob'), progress('bob', false)));
    await assertSucceeds(getDoc(prog(alice(), 'bob')));
    await assertFails(setDoc(prog(bob(), 'alice'), progress('alice', false)));
    await assertFails(setDoc(prog(bob(), 'bob'), progress('bob', true)));        // answers not finished
    await assertFails(setDoc(prog(bob(), 'bob'), progress('bob', false, { code: 'ENFP' }))); // code only when done
    await assertFails(setDoc(prog(bob(), 'bob'), progress('bob', false, { extra: 1 })));
    await finish(bob(), 'bob');
    await assertSucceeds(setDoc(prog(bob(), 'bob'), progress('bob', true, { code: 'ENFP' })));
    await assertFails(setDoc(prog(eve(), 'eve'), progress('eve', false)));
  });
});

describe('scrapbook: notes, board order and pinned messages', () => {
  const pin = (db: Firestore, id: string) => doc(db, 'rooms', ROOM, 'pins', id);
  const note = (by: string, extra: Record<string, unknown> = {}) => ({
    by, title: 'Note', detail: 'Bring the camera', dropId: null, messageId: null, tabId: null,
    kind: 'note', order: 100, colour: '#FFE9A8', createdAt: serverTimestamp(), ...extra,
  });

  it('either member writes, edits and removes notes; others are refused', async () => {
    await seedRoom();
    await assertSucceeds(setDoc(pin(alice(), 'n1'), note('alice')));
    await assertFails(setDoc(pin(eve(), 'n2'), note('eve')));
    await assertFails(setDoc(pin(alice(), 'n3'), note('alice', { detail: '' })));
    await assertFails(setDoc(pin(alice(), 'n4'), note('alice', { detail: 'x'.repeat(1001) })));
    await assertFails(setDoc(pin(alice(), 'n5'), note('alice', { messageId: 'm1' })));
    await assertFails(setDoc(pin(alice(), 'n6'), note('alice', { kind: 'sticker' })));
    // Bob edits Alice's note.
    await assertSucceeds(updateDoc(pin(bob(), 'n1'), { detail: 'Bring two cameras', colour: '#CFE6FF', editedBy: 'bob', editedAt: serverTimestamp() }));
    await assertFails(updateDoc(pin(bob(), 'n1'), { detail: 'x', editedBy: 'alice', editedAt: serverTimestamp() }));
    await assertFails(updateDoc(pin(bob(), 'n1'), { by: 'bob' }));
    await assertFails(updateDoc(pin(eve(), 'n1'), { detail: 'mine now', editedBy: 'eve', editedAt: serverTimestamp() }));
    await assertFails(deleteDoc(pin(eve(), 'n1')));
    await assertSucceeds(deleteDoc(pin(bob(), 'n1')));
  });

  it('members can only move other scraps (order), not rewrite them', async () => {
    await seedRoom();
    await assertSucceeds(setDoc(pin(alice(), 'p1'), { by: 'alice', title: 'T', detail: 'D', dropId: 'd1', messageId: null, kind: 'drop', order: 5, createdAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(pin(bob(), 'p1'), { order: 7.5 }));
    await assertFails(updateDoc(pin(bob(), 'p1'), { order: 'top' }));
    await assertFails(updateDoc(pin(bob(), 'p1'), { detail: 'rewritten' }));
    await assertFails(updateDoc(pin(eve(), 'p1'), { order: 1 }));
    // Only the pinner removes a pinned Drop or message.
    await assertFails(deleteDoc(pin(bob(), 'p1')));
    await assertSucceeds(deleteDoc(pin(alice(), 'p1')));
  });

  it('photo scraps must point at this room’s photos', async () => {
    await seedRoom();
    const base = { by: 'bob', title: 'Photo from alice', detail: '', dropId: null, messageId: 'm9', tabId: 'general', kind: 'photo', order: 1, senderId: 'alice', createdAt: serverTimestamp() };
    await assertSucceeds(setDoc(pin(bob(), 'ph1'), { ...base, photoPath: `rooms/${ROOM}/photos/alice/abc123.jpg` }));
    await assertFails(setDoc(pin(bob(), 'ph2'), { ...base, photoPath: 'rooms/other/photos/alice/abc.jpg' }));
  });

  it('up to 3 messages pinned to the top, by members only', async () => {
    await seedRoom();
    const top = (i: number) => ({ msgId: `m${i}`, tabId: 'general', uid: 'alice', by: 'bob', text: `hello ${i}`, at: new Date() });
    await assertSucceeds(updateDoc(doc(bob(), 'rooms', ROOM), { pinned: [top(1), top(2), top(3)] }));
    await assertFails(updateDoc(doc(bob(), 'rooms', ROOM), { pinned: [top(1), top(2), top(3), top(4)] }));
    await assertFails(updateDoc(doc(bob(), 'rooms', ROOM), { pinned: [{ ...top(1), extra: true }] }));
    await assertFails(updateDoc(doc(bob(), 'rooms', ROOM), { pinned: [top(1)], invites: [] }));
    await assertFails(updateDoc(doc(eve(), 'rooms', ROOM), { pinned: [top(1)] }));
    await assertSucceeds(updateDoc(doc(alice(), 'rooms', ROOM), { pinned: [] }));
  });
});

describe('Notes to self', () => {
  const selfRoom = (owner: string, extra: Record<string, unknown> = {}) => ({
    owner, ownerName: owner, members: [owner], invites: [], self: true, timezone: 'Indian/Maldives', createdAt: serverTimestamp(), ...extra,
  });

  it('only I can create rooms/self_{my uid}, and it carries no invite', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'rooms', 'self_alice'), selfRoom('alice')));
    // Someone else's id, a random id, or an invite or share code: refused.
    await assertFails(setDoc(doc(alice(), 'rooms', 'self_bob'), selfRoom('alice')));
    await assertFails(setDoc(doc(alice(), 'rooms', 'notes'), selfRoom('alice')));
    await assertFails(setDoc(doc(bob(), 'rooms', 'self_bob'), selfRoom('bob', { invites: ['eve@example.com'] })));
    await assertFails(setDoc(doc(bob(), 'rooms', 'self_bob'), selfRoom('bob', { inviteCode: 'abcdefghijklmnopqrstu' })));
    // No ordinary room may squat a self_ id.
    await assertFails(setDoc(doc(eve(), 'rooms', 'self_bob'), {
      owner: 'eve', ownerName: 'Eve', members: ['eve'], invites: [], timezone: 'Indian/Maldives', createdAt: serverTimestamp(),
    }));
  });

  it('the room, its tab, my profile and the pointer are created in one write', async () => {
    const db = alice();
    const b = writeBatch(db);
    b.set(doc(db, 'rooms', 'self_alice'), selfRoom('alice'));
    b.set(doc(db, 'rooms', 'self_alice', 'members', 'alice'), { uid: 'alice', name: 'Alice', photoURL: null, lastSeen: serverTimestamp() });
    b.set(doc(db, 'rooms', 'self_alice', 'tabs', 'general'), { ...tabDoc('alice', 'General'), createdAt: serverTimestamp() });
    b.set(doc(db, 'users', 'alice'), { selfRoom: 'self_alice' }, { merge: true });
    await assertSucceeds(b.commit());
  });

  it('nobody can join a self room, by e-mail or by code, and no invite can be added', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'rooms', 'self_alice'), { ...selfRoom('alice'), createdAt: new Date() });
    });
    await assertFails(updateDoc(doc(bob(), 'rooms', 'self_alice'), { members: ['alice', 'bob'] }));
    await assertFails(updateDoc(doc(bob(), 'rooms', 'self_alice'), { members: ['alice', 'bob'], invites: [], joinCode: 'abcdefghijklmnopqrstu' }));
    await assertFails(updateDoc(doc(alice(), 'rooms', 'self_alice'), { invites: ['bob@example.com'] }));
    await assertFails(updateDoc(doc(alice(), 'rooms', 'self_alice'), { inviteCode: 'abcdefghijklmnopqrstu' }));
    // Even a crafted inviteCode slipped in with rules off can't be used.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'rooms', 'self_alice'), { inviteCode: 'abcdefghijklmnopqrstu' });
    });
    await assertFails(updateDoc(doc(bob(), 'rooms', 'self_alice'), {
      members: ['alice', 'bob'], invites: [], inviteCode: deleteField(), joinCode: 'abcdefghijklmnopqrstu',
    }));
  });

  it('a chat nobody joined becomes Notes to self, only by its owner, only while alone', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'rooms', 'wait'), { owner: 'alice', ownerName: 'Alice', members: ['alice'], invites: ['bob@example.com'], inviteCode: 'abcdefghijklmnopqrstu', createdAt: new Date() });
      await setDoc(doc(db, 'rooms', 'full'), { owner: 'alice', ownerName: 'Alice', members: ['alice', 'bob'], invites: [], createdAt: new Date() });
    });
    await assertFails(updateDoc(doc(bob(), 'rooms', 'full'), { self: true, invites: [] }));
    await assertFails(updateDoc(doc(alice(), 'rooms', 'full'), { self: true, invites: [] }));
    // The invite and the code must go in the same write.
    await assertFails(updateDoc(doc(alice(), 'rooms', 'wait'), { self: true }));
    const db = alice();
    const b = writeBatch(db);
    b.update(doc(db, 'rooms', 'wait'), { self: true, invites: [], inviteCode: deleteField() });
    b.set(doc(db, 'users', 'alice'), { selfRoom: 'wait' }, { merge: true });
    await assertSucceeds(b.commit());
    // Afterwards the old share code is gone, and nobody can join.
    await assertFails(updateDoc(doc(bob(), 'rooms', 'wait'), { members: ['alice', 'bob'], invites: [], joinCode: 'abcdefghijklmnopqrstu' }));
  });

  it('users/{uid}.selfRoom must point at my own self room', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'rooms', 'self_alice'), { ...selfRoom('alice'), createdAt: new Date() });
      await setDoc(doc(db, 'rooms', 'self_bob'), { ...selfRoom('bob'), createdAt: new Date() });
      await setDoc(doc(db, 'rooms', 'plain'), { owner: 'alice', ownerName: 'Alice', members: ['alice'], invites: [], createdAt: new Date() });
    });
    await assertSucceeds(setDoc(doc(alice(), 'users', 'alice'), { selfRoom: 'self_alice' }, { merge: true }));
    await assertFails(setDoc(doc(alice(), 'users', 'alice'), { selfRoom: 'self_bob' }, { merge: true }));
    await assertFails(setDoc(doc(alice(), 'users', 'alice'), { selfRoom: 'plain' }, { merge: true }));
    await assertFails(setDoc(doc(alice(), 'users', 'alice'), { selfRoom: 'nope' }, { merge: true }));
    // Other settings still save without touching it.
    await assertSucceeds(setDoc(doc(alice(), 'users', 'alice'), { readReceipts: false }, { merge: true }));
  });
});

describe('your move & thread dot (room fields)', () => {
  const room = (db: Firestore) => doc(db, 'rooms', ROOM);

  it('members keep room.moves for members only, with nothing else', async () => {
    await seedRoom();
    await assertSucceeds(updateDoc(room(alice()), new FieldPath('moves', 'bob', 'd1'), true));
    await assertSucceeds(updateDoc(room(bob()), new FieldPath('moves', 'bob', 'd1'), deleteField(), new FieldPath('moves', 'alice', 'd1'), true));
    // Not for someone outside the chat, not alongside another field, not by outsiders.
    await assertFails(updateDoc(room(alice()), new FieldPath('moves', 'eve', 'd1'), true));
    await assertFails(updateDoc(room(alice()), new FieldPath('moves', 'bob', 'd2'), true, 'invites', []));
    await assertFails(updateDoc(room(eve()), new FieldPath('moves', 'bob', 'd3'), true));
    await assertFails(updateDoc(room(alice()), { moves: 'nope' }));
  });

  it('a thread reply notes itself on the room, as me and now', async () => {
    await seedRoom();
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'rooms', ROOM, 'tabs', 'general', 'messages', 'm1'), {
      uid: 'alice', kind: 'text', text: 'Plans?', createdAt: new Date(),
    }));
    const bdb = bob();
    const b = writeBatch(bdb);
    b.set(doc(bdb, 'rooms', ROOM, 'tabs', 'general', 'messages', 'm1', 'replies', 'r1'), { uid: 'bob', text: 'Brunch', createdAt: serverTimestamp() });
    b.update(doc(bdb, 'rooms', ROOM, 'tabs', 'general', 'messages', 'm1'), new FieldPath('thread', 'count'), 1, new FieldPath('thread', 'lastAt'), serverTimestamp(), new FieldPath('thread', 'lastBy'), 'bob', new FieldPath('thread', 'lastId'), 'r1');
    b.update(room(bdb), { lastThreadReplyAt: serverTimestamp(), lastThreadReplyBy: 'bob' });
    await assertSucceeds(b.commit());
    await assertFails(updateDoc(room(bob()), { lastThreadReplyAt: serverTimestamp(), lastThreadReplyBy: 'alice' }));
    await assertFails(updateDoc(room(bob()), { lastThreadReplyAt: new Date(0), lastThreadReplyBy: 'bob' }));
    await assertFails(updateDoc(room(eve()), { lastThreadReplyAt: serverTimestamp(), lastThreadReplyBy: 'eve' }));
  });

  it('nobody reads or writes the server-only invite push markers', async () => {
    await assertFails(setDoc(doc(alice(), 'invitePushes', 'x'), { at: serverTimestamp() }));
    await assertFails(getDoc(doc(alice(), 'invitePushes', 'x')));
  });
});

describe('devices & signing out other devices', () => {
  const NOW = Math.floor(Date.now() / 1000);
  const aliceAt = (t: number) => env.authenticatedContext('alice', { email: 'alice@example.com', email_verified: true, auth_time: t }).firestore() as unknown as Firestore;
  const device = (extra: Record<string, unknown> = {}) => ({
    label: 'Chrome on Mac', kind: 'computer', status: 'active', createdAt: serverTimestamp(), lastActiveAt: serverTimestamp(), signedInAt: NOW, ...extra,
  });

  it('only I can see and change my devices', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'users', 'alice', 'devices', 'devAAAAAAAAA'), device()));
    await assertFails(getDoc(doc(bob(), 'users', 'alice', 'devices', 'devAAAAAAAAA')));
    await assertFails(setDoc(doc(bob(), 'users', 'alice', 'devices', 'devBBBBBBBBB'), device()));
    await assertSucceeds(updateDoc(doc(alice(), 'users', 'alice', 'devices', 'devAAAAAAAAA'), { customName: 'Work laptop' }));
    await assertSucceeds(updateDoc(doc(alice(), 'users', 'alice', 'devices', 'devAAAAAAAAA'), { status: 'signedOut' }));
    await assertFails(updateDoc(doc(alice(), 'users', 'alice', 'devices', 'devAAAAAAAAA'), { status: 'admin' }));
    await assertFails(updateDoc(doc(alice(), 'users', 'alice', 'devices', 'devAAAAAAAAA'), { secret: 1 }));
  });

  it('with protection on, a new device must start as pending', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'alice'), { deviceProtection: true, primaryDevice: 'primaryDev01' });
    });
    await assertFails(setDoc(doc(alice(), 'users', 'alice', 'devices', 'newDevice001'), device()));
    await assertSucceeds(setDoc(doc(alice(), 'users', 'alice', 'devices', 'newDevice001'), device({ status: 'pending' })));
    // The primary itself is never held back.
    await assertSucceeds(setDoc(doc(alice(), 'users', 'alice', 'devices', 'primaryDev01'), device()));
  });

  it('primary device and protection are mine to set; the cut-off is server-only', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'users', 'alice'), { primaryDevice: 'devAAAAAAAAA', deviceProtection: true }, { merge: true }));
    await assertFails(setDoc(doc(bob(), 'users', 'alice'), { primaryDevice: 'devBBBBBBBBB' }, { merge: true }));
    await assertFails(setDoc(doc(alice(), 'users', 'alice'), { deviceProtection: 'yes' }, { merge: true }));
    await assertFails(setDoc(doc(alice(), 'users', 'alice'), { sessionsValidAfter: 0 }, { merge: true }));
  });

  it('after "sign out all other devices", older sign-ins are refused; a fresh one is not', async () => {
    await seedRoom();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'alice'), { sessionsValidAfter: NOW });
    });
    const old = aliceAt(NOW - 3600);
    const fresh = aliceAt(NOW + 5);
    await assertFails(getDoc(doc(old, 'rooms', ROOM)));
    await assertFails(getDocs(msgs(old)));
    await assertFails(setDoc(doc(msgs(old)), { uid: 'alice', kind: 'text', text: 'hi', createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(old, 'users', 'alice', 'devices', 'devAAAAAAAAA'), device()));
    // It can't lift the cut-off either.
    await assertFails(deleteDoc(doc(old, 'users', 'alice')));
    await assertSucceeds(getDoc(doc(fresh, 'rooms', ROOM)));
    await assertSucceeds(getDocs(msgs(fresh)));
    // Bob is unaffected.
    await assertSucceeds(getDoc(doc(bob(), 'rooms', ROOM)));
  });
});
