#
# This Dockerfile configures a Deno runtime environment for the application.
#
FROM denoland/deno AS base

LABEL Maintainer="Eagle1 Systems"
LABEL Description="EG1: Whereis API served by deno runtime"

# Copy all files from the current directory into container - WORKDIR
WORKDIR /app
COPY . .

# Check and prepare for the app
RUN <<CMD
set -e  # Exit on any error
set -u  # Exit on undefined variables
set -x  # Print commands as they execute
# deno update
deno cache src/main/main.ts
deno check .
deno lint
CMD

# Create temp warmup file to trigger the download/cache
RUN <<EOF
cat > /tmp/warmup_sqlite.ts <<'EOT'
import { Database } from "jsr:@db/sqlite";

console.log("=== Warming up @db/sqlite prebuilt library ===");
const db = new Database(":memory:");
console.log("SQLite version:", db.version);
db.close();
console.log("✅ SQLite prebuilt library cached successfully");
EOT
EOF

# Run warmup with necessary permission
RUN deno run --allow-ffi --allow-env --allow-read --allow-write --allow-net /tmp/warmup_sqlite.ts

ENV PORT=8037

# Accept build argument
ARG APP_VERSION=unknown
ARG APP_BUILD=unknown
ARG APP_BUILD_DATE=unknown

# Set as environment variable
ENV APP_VERSION=${APP_VERSION}
ENV APP_BUILD=${APP_BUILD}
ENV APP_BUILD_DATE=${APP_BUILD_DATE}

# Run the app with specified permissions
CMD ["run", "--allow-run", "--allow-net", "--allow-env", "--allow-read", "src/main/main.ts"]

# Set up health check to monitor the service process
HEALTHCHECK --start-period=20s --start-interval=2s --interval=5s --timeout=1s --retries=3 \
    CMD pidof deno || exit 1

# EOF
