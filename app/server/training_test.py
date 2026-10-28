from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from google.api_core.exceptions import DeadlineExceeded, PermissionDenied

from app.server import training


@pytest.fixture
def submission(monkeypatch):
    monkeypatch.setenv("TRAINING_TRIGGER_ID", "training-trigger")
    monkeypatch.delenv("TRAINING_REGION", raising=False)
    monkeypatch.delenv("TRAINING_BRANCH", raising=False)
    feedback_count = MagicMock(return_value=1)
    monkeypatch.setattr(training, "count_feedback", feedback_count)

    operation = MagicMock()
    operation.metadata = training.cloudbuild_v1.BuildOperationMetadata(
        build=training.cloudbuild_v1.Build(
            id="build-123",
            log_url="https://console.cloud.google.com/cloud-build/builds/build-123",
        )
    )
    operation.operation.name = "projects/project/locations/europe-west1/operations/op-123"
    client = MagicMock()
    client.run_build_trigger.return_value = operation
    factory = MagicMock(return_value=client)
    monkeypatch.setattr(training.cloudbuild_v1, "CloudBuildClient", factory)
    return client, operation, factory, feedback_count


def test_submits_user_uid_and_returns_without_waiting(submission):
    client, operation, factory, feedback_count = submission

    result = training.submit_training("verified-user")

    feedback_count.assert_called_once_with("verified-user")
    factory.assert_called_once_with()
    client.run_build_trigger.assert_called_once()
    arguments = client.run_build_trigger.call_args.kwargs
    request = arguments["request"]
    assert request.project_id == "linkedin-training-512914"
    assert request.trigger_id == "training-trigger"
    assert request.name == (
        "projects/linkedin-training-512914/locations/europe-west1"
        "/triggers/training-trigger"
    )
    assert request.source.branch_name == "main"
    assert dict(request.source.substitutions) == {"_USER_ID": "verified-user"}
    assert arguments["retry"] is None
    assert arguments["timeout"] == 30
    assert result == {
        "status": "submitted",
        "build_id": "build-123",
        "log_url": operation.metadata.build.log_url,
        "operation_name": operation.operation.name,
    }
    operation.result.assert_not_called()


def test_uses_configured_region_and_branch(submission, monkeypatch):
    client, _, _, _ = submission
    monkeypatch.setenv("TRAINING_REGION", "global")
    monkeypatch.setenv("TRAINING_BRANCH", "training")

    training.submit_training("verified-user")

    request = client.run_build_trigger.call_args.kwargs["request"]
    assert "/locations/global/" in request.name
    assert request.source.branch_name == "training"


@pytest.mark.parametrize("count", [0])
def test_rejects_insufficient_feedback_without_submitting(submission, count):
    _, _, factory, feedback_count = submission
    feedback_count.return_value = count

    with pytest.raises(HTTPException) as error:
        training.submit_training("verified-user")

    assert error.value.status_code == 400
    factory.assert_not_called()


def test_missing_trigger_does_not_access_cloud_services(submission, monkeypatch):
    _, _, factory, feedback_count = submission
    monkeypatch.delenv("TRAINING_TRIGGER_ID")

    with pytest.raises(HTTPException) as error:
        training.submit_training("verified-user")

    assert error.value.status_code == 503
    feedback_count.assert_not_called()
    factory.assert_not_called()


@pytest.mark.parametrize(
    "failure, status_code",
    [
        (PermissionDenied("private provider details"), 502),
        (DeadlineExceeded("private provider details"), 504),
    ],
)
def test_submission_errors_are_reported_without_retrying(
    submission, failure, status_code
):
    client, _, _, _ = submission
    client.run_build_trigger.side_effect = failure

    with pytest.raises(HTTPException) as error:
        training.submit_training("verified-user")

    assert error.value.status_code == status_code
    assert "private provider details" not in error.value.detail
    assert "before retrying" in error.value.detail
    client.run_build_trigger.assert_called_once()


def test_missing_metadata_keeps_operation_reference(submission):
    _, operation, _, _ = submission
    operation.metadata = None

    result = training.submit_training("verified-user")

    assert result["status"] == "submitted"
    assert result["build_id"] is None
    assert result["log_url"] is None
    assert result["operation_name"] == operation.operation.name
    operation.result.assert_not_called()
