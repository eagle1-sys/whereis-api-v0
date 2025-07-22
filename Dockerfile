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
deno update
deno cache main/main.ts
deno check .
deno lint
chown -f deno:deno /app/.env /app/deno.lock
CMD

# Switch to non-root user for security
USER deno

# Run the app with specified permissions
CMD ["run", "--allow-net", "--allow-env", "--allow-read", "main/main.ts"]

# Set up health check to monitor the service process
HEALTHCHECK --start-period=1s --start-interval=2s --interval=5s --timeout=1s --retries=3 \
    CMD pidof deno || exit 1

# EOF
