# Low-Value Guard

Chrome extension that blurs or hides low-value LinkedIn posts using a per-user classifier.

## Build and load the extension

Run `npm install` and `npm run build:extension`, then load `app/client/` as an unpacked extension in Chrome. Rebuild and reload the extension after changes to the popup, authentication module, or service worker. Enable **Email/Password** in the Firebase project's Authentication sign-in methods before signing in.

The popup creates accounts and signs users in with Firebase. The service worker requires sign-in, obtains a Firebase ID token for each `/classify` and `/feedback` request and sends it as an `Authorization: Bearer` header. The API verifies the token on every route using Firebase Admin. Install the Python requirements and set up [Application Default Credentials](https://firebase.google.com/docs/admin/setup#initialize_the_sdk_in_non-google_environments) for the server before running it locally.

To test the live Firebase Authentication service, run `.venv/bin/python scripts/smoke_firebase_auth.py` and enter an unused email and password. The script creates the account, signs in with it, checks that Firebase returns an ID token for the same user, and keeps the account. This checks Firebase directly; it does not exercise the Chrome popup UI.

## Train a user's model

Feedback is saved in Firestore with the authenticated Firebase UID. For now, once that user has at least 3 distinct feedback posts, including at least one useful and one not useful post, run this from the repository root, replacing `FIREBASE_UID` with the UID:

```bash
gcloud builds submit . --config cloudbuild.yaml \
  --project linkedin-training-512914 \
  --substitutions=_USER_ID=FIREBASE_UID
```

Cloud Build trains from that user's feedback and uploads `models/FIREBASE_UID/model.tflite` and `models/FIREBASE_UID/tokenizer.json` to the `linkedin-training-512914-models` bucket. The build service account needs Firestore read access (`roles/datastore.viewer`), Storage Object User on that bucket, and Cloud Logging write access. On each classification, the server checks that user's model generation in Cloud Storage and reloads only when it changes. Cloud Build must be submitted explicitly; reaching 3 posts does not start it automatically. With fewer than 10 posts, training uses all posts and skips validation; the resulting model is only suitable for testing the pipeline. Older feedback documents without `user_id` are not included in these builds.

Use `requirements-server.txt` for a server deployment without TensorFlow. Keep `requirements.txt` for local development and model training.

Based on [Cringe Guard](https://github.com/Pankajtanwarbanna/cringe-guard) by Pankaj Tanwar.
