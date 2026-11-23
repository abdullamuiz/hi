/**
 * Firebase web config for the "hi-dropchat" project.
 *
 * These values are not secrets: they identify the project, and access is
 * controlled by firestore.rules / storage.rules. (Optionally restrict the API
 * key to your domains in Google Cloud console → APIs & Services → Credentials.)
 *
 * Local development and the test suites use the Emulator Suite instead
 * (set VITE_USE_EMULATORS=true, or run `npm run dev:all`).
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyA_u8H3Zh97KzrmC89ROoE68bsOd5F-uF8',
  // The Hosting domain (not hi-dropchat.firebaseapp.com) so Google sign-in stays
  // on the same site — required for Safari / installed iPhone apps.
  // Works once the app is deployed to Firebase Hosting.
  authDomain: 'hi-dropchat.web.app',
  projectId: 'hi-dropchat',
  storageBucket: 'hi-dropchat.firebasestorage.app',
  messagingSenderId: '760909245589',
  appId: '1:760909245589:web:53848c234838ef03d9bf9c',
  measurementId: 'G-0ZNNMKNBJN',
};

/**
 * Web Push certificate (VAPID public key) — STILL NEEDED for notifications.
 * Firebase console → Project settings → Cloud Messaging → Web configuration →
 * Web Push certificates → Generate key pair, then paste the key here.
 */
export const vapidKey = 'REPLACE_ME';

/** Region your Cloud Functions are deployed to (only needed if you change it in functions/src). */
export const functionsRegion = 'us-central1';
