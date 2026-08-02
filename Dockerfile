# FlowForge — Docker image for local deployment & verification.
#
# Builds the whole flowforge project (core Harness platform) into a runnable
# image that exposes the Forgekin Council Chat web app.
#
#   docker build -t flowforge-council:0.1.0 .
#   docker run --rm -p 8765:8765 flowforge-council:0.1.0
#   docker compose up
#
FROM python:3.14-slim

# Runtime configuration.
ENV PYTHONUNBUFFERED=1 \
    FLOWFORGE_LOG_DIR=/app/logs \
    PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/ \
    PIP_TRUSTED_HOST=mirrors.aliyun.com

WORKDIR /app

# System dependencies.
#   git → required by self_dev_review for `git log` scanning.
#   使用阿里云 Debian 镜像源加速国内构建（原 deb.debian.org 在国内极慢）.
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null \
    || sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list 2>/dev/null \
    || true \
    && apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# ── Dependency layer (cached on pyproject.toml / README change) ──────────────
# Copy project metadata first so dependency installation is cached independently
# of later source changes. A throwaway package stub lets setuptools resolve the
# project during `pip install .` before the real source tree is copied in; it is
# removed right after install so it never pollutes the real source.
COPY pyproject.toml README.md ./
RUN mkdir -p flowforge && touch flowforge/__init__.py flowforge/py.typed \
    && pip install --no-cache-dir .[dev] \
    && rm -rf flowforge

# ── Application source ───────────────────────────────────────────────────────
COPY . .

# Logs directory (bind-mounted as a volume in docker-compose for persistence).
RUN mkdir -p /app/logs

EXPOSE 8765

# Liveness probe — the web app exposes GET /api/agents (lists the 5 forgekins).
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8765/api/agents')" || exit 1

# Run the web app directly (NOT `python -m flowforge.web.app`) to avoid conflicts
# with any other flowforge package that may exist in site-packages.
CMD ["python", "flowforge/web/app.py", "--host", "0.0.0.0", "--port", "8765"]
