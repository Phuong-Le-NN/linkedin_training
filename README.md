# Low-Value Guard

A Chrome extension that blurs or hides low-value posts in your LinkedIn feed. Start with a shared classifier, then label posts and train a personal model around what you find useful.

“Useful” is subjective. This is an experimental project for exploring personalized feed filtering; its predictions are not an objective measure of a post's quality.

## Try it out

You mainly need [`app/client/`](app/client/) to run the extension, but clone the repository and build its JavaScript first. The default configuration connects to the project's hosted API and Firebase project, so you do not need to run Python or deploy a backend just to try the client. This depends on those hosted services remaining available.

Prerequisites: Git, Node.js 22.12+ with npm, Chrome, and access to a LinkedIn account.

```bash
git clone https://github.com/Phuong-Le-NN/linkedin_training.git
cd linkedin_training
npm ci
npm run build:extension
```

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select the repository's **`app/client/`** folder, which contains `manifest.json`. Select this folder rather than the repository root or `app/client/build/`.
4. Open or refresh [your LinkedIn feed](https://www.linkedin.com/feed/). Refresh any feed tab that was open before installation.
5. Open the extension popup and turn on **Feed filtering**. Filtering is off by default.
6. Choose **Blur** or **Hide**. You can try the shared model without creating an account.

After pulling changes, run `npm ci` if dependencies changed, run `npm run build:extension`, click the extension's reload button in `chrome://extensions`, and refresh the LinkedIn feed. Popup, authentication, and service-worker code is bundled into `app/client/build/`; those generated files are not committed.

## User flows

### Filter your feed with the shared model

1. Enable **Feed filtering** in the popup.
2. As posts appear, the extension reads their available text and asks the API to classify them.
3. Posts classified as low value are blurred or hidden. Posts detected as promoted are also filtered, independently of the classifier.
4. In **Blur** mode, click **Show post** to reveal an individual post. In **Hide** mode, pause filtering to bring hidden posts back into view.

Changing the filtering settings updates the open feed without reloading it. The extension currently targets the LinkedIn feed, rather than profile pages or every LinkedIn surface.

### Save your preferences

1. Create an account or sign in with email and password in the popup. This is a separate Firebase account, not your LinkedIn login.
2. Use **Useful** or **Not useful** beneath a post to save its text and your label to your account. Reveal a blurred post first if needed.
3. Click **Count my saved feedback** to see how many posts you have labeled.

Saving feedback requires sign-in. Repeated submissions of the same normalized text for the same account update one stored record rather than increasing the count. Blank text and text without word characters are rejected. Each account keeps up to **3,000 distinct feedback posts**. Once that limit is reached, adding feedback for a new post automatically removes the oldest saved feedback to make room. Existing posts can still be relabeled at the limit. Feedback does not immediately retrain the model or change that post's prediction.

### Train and use a personal model

1. Save feedback across varied posts, including both useful and not-useful examples.
2. Click **Train my model**. The API submits a Cloud Build job for your Firebase user ID.
3. The popup reports that training was submitted. Training continues in the background; submission does not mean it succeeded. The optional **View build** link requires Google Cloud IAM access, which a normal Firebase account does not provide.
4. Until a personal model is available, classification uses the shared model. While retraining, an existing personal model continues to be used.
5. After a successful upload, subsequent classification requests automatically use your personal model. Refresh the feed to reclassify posts already processed on the page.

The API accepts training after **1 saved post**, which is enough to exercise the pipeline but not to establish useful model quality. We recommend at least **1,500 labeled posts**, with both useful and not-useful examples, before training a personal classifier. The trainer reads **all saved feedback for that user**, with no separate training cutoff. It uses validation only with at least 10 records and at least two examples in each class; otherwise it trains without validation.

Personal training builds a new tokenizer, Word2Vec embeddings, and CNN from your feedback only. It does not fine-tune the shared model. Small or one-sided datasets can produce a worse classifier than the shared default.

**There is currently no shared/personal model selector.** Once a personal model exists, the API prefers it whenever you are signed in. Signing out returns to the shared model, but you then cannot save feedback or request training. There is no user-facing model reset or rollback.

## How it works and where it runs

| Component | Responsibility | Location |
| --- | --- | --- |
| Chrome extension | Read feed posts, show filtering controls, collect labels | `app/client/`, installed locally in Chrome |
| Firebase Authentication | Email/password accounts and Firebase ID tokens | Configured Firebase project |
| FastAPI API | Verify tokens, classify text, save feedback, submit training | Container on Google Cloud Run |
| Firestore | Store feedback text, label, user ID, and timestamp | `feedback` collection |
| Cloud Build | Train an individual user's classifier | Job defined in `cloudbuild.yaml` |
| Cloud Storage | Store model and tokenizer bundles | `linkedin-training-512914-models` bucket |

The content script sends post text through the extension service worker to the API. For signed-in users, requests include a Firebase ID token in an `Authorization: Bearer` header; the API verifies the token and derives the user ID from it. Classification is available while signed out. Feedback, feedback counts, and training require authentication.

Inference happens on the server using LiteRT, not inside Chrome. The classifier lowercases and tokenizes text, uses up to the first 350 word tokens, and predicts useful/not useful at a fixed 0.5 threshold. Images, video, linked articles, and surrounding conversation are not analyzed.

Model selection checks these Cloud Storage objects in order:

1. `models/FIREBASE_UID/model.bundle.zip`, when signed in.
2. `models/global/v1/model.bundle.zip`, the shared fallback when no personal bundle exists.

Each ZIP contains `model.tflite` and `tokenizer.json`. The server caches bundles by object path and Storage generation, so a newly uploaded version is loaded on subsequent requests without redeploying the API. If neither bundle exists, classification returns an error.

## Deployment

The extension and API are deployed separately. `firebase.json` configures authentication and Firestore indexes; this repository does not use Firebase Hosting to serve the extension or API. The documented client installation is Chrome's **Load unpacked** flow.

Feedback eviction queries use the `user_id` / `created_at` index in `firestore.indexes.json`. Deploy this index and wait until it is ready before deploying the updated API:

```bash
firebase deploy --only firestore:indexes --project linkedin-training-512914
```

The repository is configured for Google Cloud project `linkedin-training-512914`. Its API URL is in [`app/client/lib/api_config.js`](app/client/lib/api_config.js), Firebase Web configuration is in [`app/client/lib/firebase_config.js`](app/client/lib/firebase_config.js), and allowed API hosts are in [`app/client/manifest.json`](app/client/manifest.json).

## Data and privacy

- Available post text is sent to the hosted API for classification when filtering is enabled, including while signed out. Detected promoted posts are filtered locally without a classification request. The classification route does not explicitly save those texts to Firestore.
- Clicking a feedback button stores the post text, your useful/not-useful label, Firebase user ID, and a server timestamp in Firestore. Personal training reads feedback associated with that ID and stores a model under the same ID in Cloud Storage.
- Firebase Authentication manages email/password accounts. Sign-in persists locally through Firebase's IndexedDB storage; filter settings use Chrome sync storage.
- There is no user-facing feedback export, feedback deletion, account deletion, retention setting, or model deletion flow yet. Signing out or uninstalling the extension does not delete backend data.

## Drawbacks and current limitations

- **Synthetic shared training data.** The shared dataset is AI-generated and has not been fully cleaned or manually reviewed. Labels reflect the generation prompt's requested category rather than independent human judgments of usefulness.
- **Repeated prompts and generator bias.** The included generator repeatedly uses the same prompt template and model (`llama3.2:1b` in its current calls). Varying seeds or sampling settings does not guarantee diverse data. A classifier may learn the generator's vocabulary, tone, or repeated structures instead of useful distinctions in real posts. Similar synthetic examples across train/test splits may also make evaluation look stronger than real-world performance.
- **Subjective labels and feedback loops.** People disagree on what is useful. A personal model can reinforce narrow preferences and hide perspectives the user might otherwise value. Labeling only posts that remain visible can further skew future training data.
- **Limited evidence of real-feed quality.** Dataset evaluation is not a published benchmark on independently labeled LinkedIn posts. Performance across topics, languages, and writing styles needs separate evaluation. False positives can hide valuable posts; false negatives can leave distracting posts visible.
- **Small personal datasets and limited history.** Training is allowed with one record, even with only one label class. Personal models are trained from scratch, and validation can be skipped. All saved feedback is considered, but more examples do not guarantee better predictions. Each account keeps up to 3,000 distinct feedback posts; new feedback replaces the oldest record once the limit is reached, so removed examples are no longer available for future training.
- **No model choice, comparison, or rollback.** Signed-in users cannot choose the shared model after a personal model exists. There is no quality gate before replacing the personal bundle or UI for restoring an earlier model. A missing personal bundle falls back to the shared model; a broken personal bundle is not automatically replaced by the shared one.
- **Limited context and controls.** Predictions use text only, truncate long posts, and have a fixed threshold. Promoted-post filtering is a separate rule and may hide an ad the user finds useful. There is no per-topic control or persistent allowlist.
- **LinkedIn UI changes.** Post extraction, feedback controls, and promoted-post detection rely on LinkedIn DOM selectors and some English labels. Layout changes or localization can break them.
- **Network, latency, and cost.** Inference requires the API and model storage to be available. The server limits concurrent inference per process and can return HTTP 429 when busy. Training uses billable cloud resources. There are no persistent per-user training quotas or duplicate-job protection.
- **Training visibility and data management.** The popup reports submission without polling for completion or failure. Most users cannot access Cloud Build logs. Data export/deletion and model management still need dedicated flows.

## Repository guide

| Path | Contents |
| --- | --- |
| `app/client/` | Manifest, popup, content scripts, settings, and service worker |
| `app/server/` | FastAPI routes, authentication, inference, feedback storage, and job submission |
| `app/model_training/` | Personal model training and its tests |
| `ml/scripts/post-generator.py` | Synthetic dataset generation through a local Ollama endpoint |
| `ml/data/` | Shared training datasets (`useful_posts.csv` and `useless_posts.csv`) |
| `ml/notebooks/post-classifier.ipynb` | Shared model training, evaluation, export, and upload |
| `ml/exports/` | Exported shared model artifacts |
| `scripts/build-extension.mjs` | Bundle extension JavaScript and Firebase dependencies |
| `Dockerfile` / `cloudbuild.yaml` | API container / personal model training job |

## Next improvements

The most useful next additions are a shared/personal model selector with rollback, a cleaned and independently labeled real-post evaluation set, dataset diversity checks, training status in the popup, training quotas, and data export/deletion controls. Screenshots or a short demo would also make this README easier to follow. Evaluation results should include dataset provenance, sample counts, per-class precision/recall, and examples of mistakes before making accuracy claims.

## License and credits

[MIT License](LICENSE). Based on [Cringe Guard](https://github.com/Pankajtanwarbanna/cringe-guard) by Pankaj Tanwar.
