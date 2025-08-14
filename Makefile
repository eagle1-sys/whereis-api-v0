# This Makefile manages the build and deployment processes for whereis-api
# Use 'make help' to view available commands and their descriptions.
#
# Configuration variables
IMAGE=local/whereis-api-v0:dev

.PHONY: help local fly start

# Show available targets
help:
	@echo "Targets:"
	@echo "  start  - Setup all initial config files"
	@echo "  local  - Build and run service locally via docker compose"
	@echo "  fly    - Deploy service to fly.io"

# Creates initial configuration files from config/*.sample and .env.sample
start: config/*.sample
	@for f in config/*.sample; do \
		target_file=$$(basename "$$f" .sample); \
		if [ -e "$$target_file" ]; then \
			echo "Backing up '$$target_file.bak'"; \
			cp "$$target_file" "$$target_file.bak"; \
		fi; \
		echo "=> Creating '$$target_file' \n"; \
		cp "$$f" "$$target_file"; \
	done
	@if [ -e .env ]; then \
		echo "Backing up '.env.bak'"; \
		cp .env .env.bak; \
	fi; \
	echo "=> Creating '.env' \n"; \
	mv env .env

# Build a local Docker image and run it
local: Dockerfile docker-compose.yaml
	@docker build -t $(IMAGE) .
	@docker compose up -d
	@echo "\n => Running whereis containers\n"
	@docker ps -a --format "table {{.Image}}\t{{.Status}}\t{{.Ports}}\t{{.Names}}" --filter "name=whereis"


# Build and deploy into fly.io
fly: fly.toml Dockerfile
	fly deploy

# - EOF -
