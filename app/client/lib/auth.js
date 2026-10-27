import { initializeApp } from 'firebase/app';
import { initializeAuth, indexedDBLocalPersistence } from 'firebase/auth/web-extension';
import { firebaseConfig } from './firebase_config.js';

// IndexedDB is shared by the popup and the extension service worker, so the
// worker can read and refresh the same signed-in user's ID token.
export const auth = initializeAuth(initializeApp(firebaseConfig), {
    persistence: indexedDBLocalPersistence
});
