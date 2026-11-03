"""Submit authenticated users' training jobs to Cloud Build."""

import logging
import os

from fastapi import HTTPException
from google.api_core.exceptions import DeadlineExceeded, GoogleAPICallError
from google.cloud.devtools import cloudbuild_v1

from app.server.store_feedback import count_feedback

logger = logging.getLogger(__name__)


def submit_training(user_id: str) -> dict:
    trigger_id = os.environ.get("TRAINING_TRIGGER_ID")
    if not trigger_id:
        raise HTTPException(
            status_code=503, detail="Training is not configured."
        )

    if count_feedback(user_id) < 1:
        raise HTTPException(
            status_code=400,
            detail="Save at least 1 feedback post before training.",
        )

    region = os.environ.get("TRAINING_REGION", "europe-west1")
    branch = os.environ.get("TRAINING_BRANCH", "main")
    project_id = os.environ["GOOGLE_CLOUD_PROJECT"]
    model_bucket = os.environ["MODEL_BUCKET"]
    request = cloudbuild_v1.RunBuildTriggerRequest(
        project_id=project_id,
        trigger_id=trigger_id,
        name=(
            f"projects/{project_id}/locations/{region}"
            f"/triggers/{trigger_id}"
        ),
        source=cloudbuild_v1.RepoSource(
            branch_name=branch,
            substitutions={"_USER_ID": user_id, "_MODEL_BUCKET": model_bucket},
        ),
    )

    try:
        client = cloudbuild_v1.CloudBuildClient()
        operation = client.run_build_trigger(
            request=request, retry=None, timeout=30
        )
    except DeadlineExceeded:
        logger.exception("Cloud Build submission timed out")
        raise HTTPException(
            status_code=504,
            detail=(
                "Training submission timed out and may have started. "
                "Check Cloud Build before retrying."
            ),
        ) from None
    except GoogleAPICallError:
        logger.exception("Cloud Build submission failed")
        raise HTTPException(
            status_code=502,
            detail=(
                "Could not confirm training submission. "
                "Check Cloud Build before retrying."
            ),
        ) from None

    # Do not call operation.result(): training continues after this response.
    # Preserve the operation reference if build metadata is not available yet.
    metadata = operation.metadata
    build = metadata.build if metadata is not None else None
    return {
        "status": "submitted",
        "build_id": (build.id or None) if build is not None else None,
        "log_url": (build.log_url or None) if build is not None else None,
        "operation_name": operation.operation.name,
    }
