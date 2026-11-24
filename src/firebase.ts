import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
} from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { firebaseConfig } from './firebase-config';

const placeholder = firebaseConfig.apiKey === 'REPLACE_ME';
export const usingEmulators = placeholder || import.meta.env.VITE_USE_EMULATORS === 'true';

// Against the emulators always use the demo project, so local runs and tests can
// never touch the real database.
const config = usingEmulators
  ? {
      apiKey: 'demo-key',
      authDomain: 'demo-drops.firebaseapp.com',
      projectId: 'demo-drops',
      storageBucket: 'demo-drops.appspot.com',
      messagingSenderId: '0',
      appId: 'demo',
    }
  : firebaseConfig;

export const app = initializeApp(config);
export const auth = getAuth(app);

function makeDb() {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    // Private mode / no IndexedDB: fall back to memory.
    return initializeFirestore(app, { localCache: memoryLocalCache() });
  }
}
export const db = makeDb();
export const storage = getStorage(app);
export const functions = getFunctions(app, 'us-central1');

if (usingEmulators) {
  const host = location.hostname || 'localhost';
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectStorageEmulator(storage, host, 9199);
  connectFunctionsEmulator(functions, host, 5001);
}
