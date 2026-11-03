# Low-Interest Guard

Chrome extension that hides or blurs unwanted LinkedIn posts without unfollowing people. Users label posts directly in their feed and can train a model to reflect their preferences.
- Uses MutationObserver to handle infinite scrolling and checks post text before applying predictions, so late responses don’t hide the wrong content.
- Trains a Word2Vec + TensorFlow CNN on each user’s saved labels, with a shared model available before they train their own.
- Runs training in Google Cloud Build and predictions through FastAPI and LiteRT on Cloud Run, keeping training dependencies out of the serving container.
- Caches up to 50 loaded model versions and checks Cloud Storage generations, avoiding repeated model downloads while picking up retrained models.
- Stores up to 3,000 labeled posts per user in Firestore. Transactions handle duplicate posts, label changes, and removal of the oldest examples; verified Firebase tokens determine whose feedback and model to use.


https://github.com/user-attachments/assets/faeb4fe2-10c1-4a9d-8483-50411c6bed35

## Journal
[A not very polished dev journal](https://github.com/Phuong-Le-NN/linkedin_training/blob/main/journal.md)
