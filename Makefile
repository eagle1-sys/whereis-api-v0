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
.PHONY: help start build update local stop stop-remove logs init_db check_docker fly prune test

# Set the default target to 'help' if no target is specified
.DEFAULT_GOAL := help


# --- Targets ---

help: ## Show this help message
	@echo "Usage: make <target>"
	@echo ""
	@(\
		grep -E '^whereis:.*?## .*$$' $(MAKEFILE_LIST); \
		grep -E '^update:.*?## .*$$' $(MAKEFILE_LIST); \
		grep -E '^start:.*?## .*$$' $(MAKEFILE_LIST); \
		grep -E '^stop:.*?## .*$$' $(MAKEFILE_LIST); \
		echo "---"; \
		grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | grep -vE '^(whereis|start|update|stop):' | sort; \
	) | awk 'BEGIN {FS = ":.*?## "}; {if ($$0 == "---") {print ""} else {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}}'

whereis: check_docker config/*.sample ## Initial setup: create configs, initialize the DB, and start services. Use 'update' for subsequent starts.
	@echo "=> Creating initial configuration files..."
	@for f in config/*.sample; do \
		target_file=$$(basename "$$f" .sample); \
		if [ ! -e "$$target_file" ]; then \
			echo "  -> Creating '$$target_file' from sample"; \
			cp "$$f" "$$target_file"; \
		elif cmp -s "$$f" "$$target_file"; then \
			echo "  -> '$$target_file' is up-to-date. Skipping."; \
		else \
			timestamp=$$(date +%Y%m%d%H%M%S); \
			backup_file="$${target_file}.bak.$${timestamp}"; \
			echo "  -> Backing up existing '$$target_file' to '$$backup_file'"; \
			cp "$$target_file" "$$backup_file"; \
			echo "  -> Updating '$$target_file' from sample"; \
			cp "$$f" "$$target_file"; \
		fi; \
	done
	$(MAKE) init_db
	$(MAKE) update

check_docker: # -- Check if Docker is installed and the daemon is running
	@echo "=> Checking for Docker..."
	@docker info > /dev/null 2>&1 || (echo "[ERROR] Docker is not installed or the Docker daemon is not running. Please fix and retry." && exit 1)
	@echo "=> Docker is running."

init_db: check_docker config/create-whereis-db.sql # -- Initialize the postgres container and load initial data
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

build: check_docker Dockerfile docker-compose.yaml ## Build whereis-api docker image
	@echo "=> Building Docker image with tag: $(IMAGE)"
	@docker build -t $(IMAGE) .

start: check_docker ## Start api and postgres services
	@echo "=> Starting all services in the background..."
	@docker compose up -d
	@echo "=> Checking active whereis containers ..."
	@$(MAKE) status

update: build ## Build whereis-api docker image and restart api and postgres services
	@echo "=> Restarting all services..."
	@docker compose up -d
	@echo "=> Checking active whereis containers ..."
	@$(MAKE) status

test: check_docker ## Run 'deno task test' in the api container
	@echo "=> Running 'deno task test' within api container ..."
	@docker exec -it whereis-api-v0 deno task test

status: check_docker ## Show the status of the api and postgres containers
	@docker ps -a --format "table {{.Image}}\t{{.Status}}\t{{.Ports}}\t{{.Names}}" --filter "name=whereis"

stop: check_docker ## Stop and remove api and postgres service containers
	@echo "=> Stopping and removing whereis containers..."
	@docker compose down
	@echo "=> Containers stopped and removed."
	@echo "=> Note: Volumes still exist. Use 'make stop-remove' to remove all data."

stop-remove: check_docker ## Caution: stop services and permanently delete all containers and associated data volumes
	@echo "=> [WARNING] This will permanently remove whereis containers and data volumes."
	@read -p "Are you sure you want to proceed? (Y/n) " -n 1 -r; \
	echo; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		docker compose down -v --remove-orphans; \
		echo "=> All 'whereis' containers and volumes removed."; \
	else \
		echo "=> Aborted."; \
	fi

prune: ## Remove all unused Docker data (dangling images, build cache)
	@echo "=> Pruning unused Docker resources..."
	@docker system prune -f

logs: check_docker ## Follow the logs from the api and postgres services
	@echo "=> Tailing logs (press Ctrl+C to stop)..."
	@docker compose logs -f

fly: fly.toml Dockerfile ## Build and deploy the service to fly.io
	@echo "=> Starting deployment to fly.io..."
	@echo "  -> Importing application secrets from 'source-api-keys.env'..."
	fly secrets import < source-api-keys.env
	@echo "  -> Building the image and deploying the application..."
	fly deploy
	@echo "=> Deployment to fly.io complete."

# - EOF -
