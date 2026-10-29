# Build with the linkedin_training project directory as the build context.
# Small Debian base for the Python API and native inference runtime.
FROM python:3.11-slim-bookworm

# Send logs directly to stdout and avoid writing bytecode or pip caches.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HOME=/tmp \
    PORT=8080

# Set the working directory for dependency installation and API startup.
WORKDIR /app

# Native C++ runtime for LiteRT; no compiler toolchain is needed.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

# Cache this layer separately from application code; install prebuilt wheels only.
COPY requirements-server.txt ./requirements-server.txt
RUN python -m pip install --only-binary=:all: -r requirements-server.txt

# Preserve app.server imports and copy only production API modules.
# The classifier downloads model bytes from Cloud Storage at runtime.
COPY app/server/api.py app/server/auth.py app/server/classifier.py app/server/store_feedback.py app/server/training.py ./app/server/

# Run without root privileges. /tmp remains writable for downloaded models.
USER 10001:10001

EXPOSE 8080

# app/server/api.py exposes a FastAPI instance named app.
# exec forwards shutdown signals to Uvicorn; the shell expands PORT.
CMD ["sh", "-c", "exec python -m uvicorn app.server.api:app --host 0.0.0.0 --port \"${PORT:-8080}\""]
