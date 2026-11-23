/**
 * Firebase web config — FILL THIS IN.
 *
 * Firebase console → Project settings → General → Your apps → Web app → "SDK setup and configuration".
 * These values are not secrets (they identify the project; security comes from the rules),
 * so it is fine to commit them.
 *
 * While apiKey is still 'REPLACE_ME' the app talks to the local Emulator Suite (project "demo-drops").
 */
export const firebaseConfig = {
  apiKey: 'REPLACE_ME',
  // Tip: use your Hosting domain (e.g. your-project.web.app) so Google sign-in works
  // inside an installed iPhone app. See README → "Sign-in on iPhone".
  authDomain: 'REPLACE_ME.firebaseapp.com',
  projectId: 'REPLACE_ME',
  storageBucket: 'REPLACE_ME.firebasestorage.app',
  messagingSenderId: 'REPLACE_ME',
  appId: 'REPLACE_ME',
};

/**
 * Web Push certificate (VAPID public key).
 * Firebase console → Project settings → Cloud Messaging → Web configuration → Generate key pair.
 */
export const vapidKey = 'REPLACE_ME';

/** Region your Cloud Functions are deployed to (only needed if you change it in functions/src). */
export const functionsRegion = 'us-central1';
