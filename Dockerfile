#
# This Dockerfile configures a Deno runtime environment for the application.
#
FROM denoland/deno

WORKDIR /app

# Copy all files from the current directory to the container
COPY . .

# A fix for fly.io deployment issue
RUN chown deno:deno /app/.env

# Switch to non-root user for security
USER deno

# Updates dependencies to their latest semver compatible versions
RUN deno update

# Pre-cache the main application dependencies
RUN deno cache main/main.ts

# Run the application with the following permissions:
#   --allow-net: Allow network access
#   --allow-env: Allow environment variable access
#   --allow-read: Allow file system read access
CMD ["run", "--allow-net", "--allow-env", "--allow-read", "main/main.ts"]

# EOF
