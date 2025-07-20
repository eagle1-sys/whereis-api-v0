#
# This Dockerfile configures a Deno runtime environment for the application.
#
FROM denoland/deno

# Install busybox and clean up in single layer
RUN apt-get update && \
    apt-get upgrade -qy && \
    apt-get install -y --no-install-recommends busybox && \
    busybox --install -s /usr/bin && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

WORKDIR /app

# Copy all files from the current directory to the container
COPY . .

# Check and prepare for the app
RUN <<CMD
set -e  # Exit on any error
set -u  # Exit on undefined variables
set -x  # Print commands as they execute
deno update
deno cache main/main.ts
deno check **/*.ts
deno lint
chown -f deno:deno /app/.env /app/deno.lock
CMD

# Switch to non-root user for security
USER deno

# Run the app with permissions
CMD ["run", "--allow-net", "--allow-env", "--allow-read", "main/main.ts"]

# Set up health check to monitor the service process
HEALTHCHECK --start-period=1s --start-interval=2s --interval=5s --timeout=1s --retries=3 \
    CMD pidof deno || exit 1

# EOF
