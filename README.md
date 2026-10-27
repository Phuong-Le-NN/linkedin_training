# Low-Value Guard

Chrome extension that blurs or hides low-value LinkedIn posts using a local classifier.

## Build and load the extension

Run `npm install` and `npm run build:extension`, then load `app/client/` as an unpacked extension in Chrome. Rebuild and reload the extension after changes to the popup, authentication module, or service worker. Enable **Email/Password** in the Firebase project's Authentication sign-in methods before signing in.

The popup signs in with Firebase. While signed in, the service worker obtains a fresh Firebase ID token for each `/classify` and `/feedback` request and sends it as an `Authorization: Bearer` header. The local API currently accepts requests without checking this token; server-side token verification is a separate change if authenticated access is required.

Based on [Cringe Guard](https://github.com/Pankajtanwarbanna/cringe-guard) by Pankaj Tanwar.
