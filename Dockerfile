#
# This Dockerfile configures a Deno runtime environment for the application.
#
FROM denoland/deno AS base

LABEL Maintainer="Eagle1 Systems"
LABEL Description="EG1: Whereis API served by deno runtime"

# Default DB_TYPE
ARG DB_TYPE=sqlite
ENV DB_TYPE=$DB_TYPE

# Only run this when DB_TYPE=sqlite
RUN if [ "$DB_TYPE" = "sqlite" ]; then \
        mkdir -p /data && chown -R deno:deno /data; \
    fi

WORKDIR /app
COPY . .

# Check and prepare for the app
RUN <<CMD
set -e  # Exit on any error
set -u  # Exit on undefined variables
set -x  # Print commands as they execute
deno cache src/main/main.ts
deno check .
CMD

# Create temp warmup file to trigger the download/cache
RUN <<EOF
set -e  # Exit on any error

cat > warmup_sqlite.ts <<'EOT'
import { Database } from "sqlite";

console.log("=== Warming up @db/sqlite prebuilt library ===");
const db = new Database(":memory:");
console.log("SQLite version:", db.version);
db.close();
console.log("✅ SQLite prebuilt library cached successfully");
EOT

# Run warmup with necessary permission
deno run --allow-ffi --allow-env --allow-read --allow-write --allow-net warmup_sqlite.ts
rm warmup_sqlite.ts
echo "✅ Warmup file cleaned up"
EOF

ENV PORT=8037

# Accept build argument
ARG APP_VERSION=unknown
ARG APP_BUILD=unknown
ARG APP_BUILD_DATE=unknown

# Set as environment variable
ENV APP_VERSION=${APP_VERSION}
ENV APP_BUILD=${APP_BUILD}
ENV APP_BUILD_DATE=${APP_BUILD_DATE}

# Fix ownership and drop to non-root
RUN chown -R deno:deno /app /deno-dir
USER deno

# Run the app with specified permissions
CMD ["run", "--allow-run", "--allow-net", "--allow-env", "--allow-read", "src/main/main.ts"]

# Set up health check to monitor the service process
HEALTHCHECK --start-period=20s --start-interval=2s --interval=5s --timeout=1s --retries=3 \
    CMD pidof deno || exit 1

# EOF
