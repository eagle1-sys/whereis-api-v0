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
