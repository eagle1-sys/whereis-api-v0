# This Makefile manages the build and deployment processes for whereis-api.
# Use 'make help' for a list of available commands.

# --- Configuration ---
# Use ?= to allow overriding from the command line (e.g., make build IMAGE_TAG=v1.0.0)
IMAGE_NAME ?= whereis-api-v0
IMAGE_TAG  ?= latest
IMAGE      := local/$(IMAGE_NAME):$(IMAGE_TAG)

# Name of the database service in docker-compose.yaml
COMPOSE_DB_SERVICE = pg-whereis

# --- Setup ---
# Use bash for more advanced shell features
SHELL := /bin/bash

# Define all targets that are not files as .PHONY
.PHONY: help start build up local stop clean logs init_db check_docker fly prune

# Set the default target to 'help' if no target is specified
.DEFAULT_GOAL := help


# --- Targets ---

help: ## Show this help message
	@echo "Usage: make <target>"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

start: check_docker config/*.sample ## Initial setup: create configs, initialize the DB, and start services. Use 'up' for subsequent starts.
	@echo "=> Creating initial configuration files..."
	@for f in config/*.sample; do \
		target_file=$$(basename "$$f" .sample); \
		if [ -e "$$target_file" ]; then \
			timestamp=$$(date +%Y%m%d%H%M%S); \
			backup_file="$${target_file}.bak.$${timestamp}"; \
			echo "  -> Backing up existing '$$target_file' to '$$backup_file'"; \
			cp "$$target_file" "$$backup_file"; \
		fi; \
		echo "  -> Creating '$$target_file' from sample"; \
		cp "$$f" "$$target_file"; \
	done
	$(MAKE) init_db
	$(MAKE) up

check_docker: # -- Check if Docker is installed and the daemon is running
	@echo "=> Checking for Docker..."
	@docker info > /dev/null 2>&1 || (echo "[ERROR] Docker is not installed or the Docker daemon is not running. Please fix and retry." && exit 1)
	@echo "=> Docker is running."

init_db: check_docker config/create-whereis-db.sql # -- Initialize the database container and load initial data
	@echo "=> Starting up database service '$(COMPOSE_DB_SERVICE)'..."
	@docker compose up $(COMPOSE_DB_SERVICE) -d
	@echo "=> Waiting for database to become healthy..."
	@until [ "$$(docker inspect -f '{{.State.Health.Status}}' $(COMPOSE_DB_SERVICE) 2>/dev/null)" = "healthy" ]; do \
		echo "  -> Still waiting..."; \
		sleep 2; \
	done
	@echo "=> Database is healthy. Creating database and preloading data..."
	@cat config/create-whereis-db.sql | docker compose exec -T $(COMPOSE_DB_SERVICE) psql -q -U postgres --dbname=whereis
	@echo "=> Database initialization complete."

build: check_docker Dockerfile docker-compose.yaml ## Build the service's Docker image
	@echo "=> Building Docker image with tag: $(IMAGE)"
	@docker build -t $(IMAGE) .

up: build ## Start all services in the background using Docker Compose
	@echo "=> Starting all services..."
	@docker compose up -d
	@echo "=> Showing active whereis containers:"
	@docker ps -a --format "table {{.Image}}\t{{.Status}}\t{{.Ports}}\t{{.Names}}" --filter "name=whereis"

stop: check_docker ## Stop and remove service containers
	@echo "=> Stopping and removing whereis containers..."
	@docker compose down
	@echo "=> Containers stopped and removed."
	@echo "=> Note: Volumes still exist. Use 'make clean' to remove all data."

clean: check_docker ## Stop services and remove all data (containers, volumes)
	@echo "=> WARNING: This will permanently remove all containers and volumes."
	@docker compose down -v --remove-orphans
	@echo "=> All 'whereis' containers and volumes removed."

logs: check_docker ## Follow the logs from all running services
	@echo "=> Tailing logs (press Ctrl+C to stop)..."
	@docker compose logs -f

fly: fly.toml Dockerfile ## Build and deploy the service to fly.io
	@echo "=> Deploying to fly.io..."
	fly deploy

prune: ## Remove all unused Docker data (dangling images, build cache)
	@echo "=> Pruning unused Docker resources..."
	@docker system prune -f

# - EOF -
