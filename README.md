# Low-Value Guard

Chrome extension that blurs or hides low-value LinkedIn posts using a per-user classifier.

## Build and load the extension

Run `npm install` and `npm run build:extension`, then load `app/client/` as an unpacked extension in Chrome. Rebuild and reload the extension after changes to the popup, authentication module, or service worker. Enable **Email/Password** in the Firebase project's Authentication sign-in methods before signing in.

The popup creates accounts and signs users in with Firebase. The service worker requires sign-in, obtains a Firebase ID token for each `/classify` and `/feedback` request and sends it as an `Authorization: Bearer` header. The API verifies the token on every route using Firebase Admin. Install the Python requirements and set up [Application Default Credentials](https://firebase.google.com/docs/admin/setup#initialize_the_sdk_in_non-google_environments) for the server before running it locally.

To test the live Firebase Authentication service, run `.venv/bin/python scripts/smoke_firebase_auth.py` and enter an unused email and password. The script creates the account, signs in with it, checks that Firebase returns an ID token for the same user, and keeps the account. This checks Firebase directly; it does not exercise the Chrome popup UI.

## Train a user's model

Feedback is saved in Firestore with the authenticated Firebase UID. Once the user has at least 1 feedback post, the extension's Train button calls `POST /train`. The API verifies the Firebase token and passes that user's UID to `app/server/training.py`, which submits a Cloud Build trigger and returns HTTP 202 with `build_id`, `log_url`, and `operation_name`. Training continues after the response; 202 does not mean training succeeded. If initial build metadata is unavailable, the build ID and log URL are null and the operation name remains available.

Configure the training trigger before enabling this endpoint:

1. Enable the Cloud Build API and connect the training source repository.
2. Create a manual trigger in `linkedin-training-512914` using `cloudbuild.yaml`, with a build service account that can read feedback, write model objects, and write logs. Commit and push the corrected training-script path so the trigger uses it.
3. Set `TRAINING_TRIGGER_ID` on the API service. `TRAINING_REGION` defaults to `europe-west1`; it must match the trigger's location. `TRAINING_BRANCH` defaults to `main`; use the branch containing the training code.
4. Grant the API service account `cloudbuild.builds.create` (for example through `roles/cloudbuild.builds.editor`) and `roles/iam.serviceAccountUser` on the trigger's build service account.
5. Install `requirements-server.txt`, rebuild the API image, and redeploy it. The extension uses the Cloud Run URL in `app/client/lib/api_config.js`; rebuild and reload it after updating that URL.

The API requires one feedback post. The training script requires at least one post containing words. A model trained from one post only checks that the pipeline works; it cannot be expected to classify reliably. Submission timeouts may occur after a build has started, so inspect Cloud Build before retrying. Requests currently have no persistent duplicate-job protection; repeated requests can create overlapping jobs. Add a per-user job record before enabling training for many users. The console build link requires Google Cloud IAM access; Firebase sign-in alone does not grant access to build logs.

For a manual command-line submission, run this from the repository root, replacing `FIREBASE_UID` with the UID:

```bash
gcloud builds submit . --config cloudbuild.yaml \
  --project linkedin-training-512914 \
  --substitutions=_USER_ID=FIREBASE_UID
```

Cloud Build trains from that user's feedback and uploads `models/FIREBASE_UID/model.bundle.zip` containing the model and tokenizer to the `linkedin-training-512914-models` bucket. The build service account needs Firestore read access (`roles/datastore.viewer`), Storage Object User on that bucket, and Cloud Logging write access. On each classification, the server checks that user's model generation in Cloud Storage and reloads only when it changes. Training starts when the user requests it through the API or when a build is submitted manually; reaching 1 post does not start it automatically. With fewer than 10 posts, training uses all posts and skips validation; the resulting model is only suitable for testing the pipeline. Older feedback documents without `user_id` are not included in these builds.

Use `requirements-server.txt` for a server deployment without TensorFlow. Keep `requirements.txt` for local development and model training.

Based on [Cringe Guard](https://github.com/Pankajtanwarbanna/cringe-guard) by Pankaj Tanwar.
