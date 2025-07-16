# 
# Configures a Deno runtime environment for the application.
#
# Base image
FROM denoland/deno

# Set the working directory inside the container
WORKDIR /app

# Copy all files from the current directory to the container
COPY . .

# Updates  dependencies to their latest semver compatible versions
RUN deno update

# Pre-cache the main application dependencies
RUN deno cache main/main.ts

# Switch to non-root user for security
USER deno

# Run the application with the following permissions:
# --allow-net: Allow network access
# --allow-env: Allow environment variable access
# --allow-read: Allow file system read access
CMD ["run", "--allow-net", "--allow-env", "--allow-read", "main/main.ts"]
