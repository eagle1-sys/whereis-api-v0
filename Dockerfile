#
# This Dockerfile configures a Deno runtime environment for the application.
#
FROM denoland/deno

WORKDIR /app

# Copy all files from the current directory to the container
COPY . .

# Check and prepare for the app
RUN <<CMD
deno update
deno cache main/main.ts
deno lint
deno check
chown deno:deno /app/.env /app/deno.lock
CMD

# Switch to non-root user for security
USER deno

# Run the application with the following permissions:
#   --allow-net: Allow network access
#   --allow-env: Allow environment variable access
#   --allow-read: Allow file system read access
CMD ["run", "--allow-net", "--allow-env", "--allow-read", "main/main.ts"]

# Set up health check to monitor the deno process
HEALTHCHECK --start-period=1s --start-interval=2s --interval=5s --timeout=1s --retries=3 \
    CMD pidof deno || exit 1

# EOF
