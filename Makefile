COMPOSE   = podman-compose
PROJECT   = standalone-services-suite

# ── Colour codes ───────────────────────────────────────────────────────────────
BOLD  = \033[1m
RESET = \033[0m
GRN   = \033[0;32m
CYN   = \033[0;36m
YLW   = \033[0;33m
RED   = \033[0;31m
DIM   = \033[2m

.PHONY: up down restart build rebuild logs ps status urls open clean help

# ── Default target ─────────────────────────────────────────────────────────────
.DEFAULT_GOAL := help

# ── Start ──────────────────────────────────────────────────────────────────────
up: .env
	@echo "$(BOLD)$(GRN)▶  Starting $(PROJECT)…$(RESET)"
	@$(COMPOSE) up -d
	@$(MAKE) --no-print-directory _wait
	@$(MAKE) --no-print-directory urls

# ── Build + start (first time or after code changes) ───────────────────────────
build: .env
	@echo "$(BOLD)$(GRN)▶  Building and starting $(PROJECT)…$(RESET)"
	@$(COMPOSE) up --build -d
	@$(MAKE) --no-print-directory _wait
	@$(MAKE) --no-print-directory urls

# ── Force-rebuild images from scratch (clears all layer cache) ────────────────
rebuild: .env
	@echo "$(BOLD)$(YLW)▶  Force-rebuilding $(PROJECT) (no cache)…$(RESET)"
	@$(COMPOSE) build --no-cache
	@$(COMPOSE) up -d
	@$(MAKE) --no-print-directory _wait
	@$(MAKE) --no-print-directory urls

# ── Stop containers (keep volumes) ────────────────────────────────────────────
down:
	@echo "$(BOLD)$(YLW)▶  Stopping $(PROJECT)…$(RESET)"
	@$(COMPOSE) down
	@echo "$(DIM)  Volumes preserved (pgdata, kcdata). Run 'make clean' to wipe them.$(RESET)"

# ── Restart all containers ────────────────────────────────────────────────────
restart:
	@echo "$(BOLD)$(YLW)▶  Restarting $(PROJECT)…$(RESET)"
	@$(COMPOSE) restart
	@$(MAKE) --no-print-directory _wait
	@$(MAKE) --no-print-directory urls

# ── Tail logs ─────────────────────────────────────────────────────────────────
logs:
	@$(COMPOSE) logs -f

logs-backend:
	@$(COMPOSE) logs -f backend

logs-frontend:
	@$(COMPOSE) logs -f frontend

logs-keycloak:
	@$(COMPOSE) logs -f keycloak

# ── Container status ──────────────────────────────────────────────────────────
ps:
	@echo "$(BOLD)$(CYN)  Container status$(RESET)"
	@$(COMPOSE) ps

status: ps

# ── Print URLs ────────────────────────────────────────────────────────────────
urls:
	@echo ""
	@echo "$(BOLD)$(CYN)╔══════════════════════════════════════════════════════╗$(RESET)"
	@echo "$(BOLD)$(CYN)║        Standalone Services Suite — URLs              ║$(RESET)"
	@echo "$(BOLD)$(CYN)╚══════════════════════════════════════════════════════╝$(RESET)"
	@echo ""
	@echo "  $(BOLD)Frontend$(RESET)  (Dashboard)"
	@echo "    $(GRN)http://localhost:5174$(RESET)"
	@echo ""
	@echo "  $(BOLD)Backend$(RESET)   (FastAPI + Swagger docs)"
	@echo "    $(GRN)http://localhost:8000$(RESET)"
	@echo "    $(GRN)http://localhost:8000/docs$(RESET)"
	@echo ""
	@echo "  $(BOLD)Keycloak$(RESET)  (Admin console · admin / admin)"
	@echo "    $(GRN)http://localhost:8180$(RESET)"
	@echo "    $(GRN)http://localhost:8180/admin$(RESET)"
	@echo "    $(DIM)realm: standalone   client: sss-frontend$(RESET)"
	@echo ""
	@echo "  $(BOLD)Sign in to the portal$(RESET)"
	@echo "    $(GRN)http://localhost:5174/login$(RESET)"
	@echo "    $(DIM)credentials: admin / admin$(RESET)"
	@echo ""
	@echo "$(DIM)  Tip: run 'make open' to open all URLs in your browser$(RESET)"
	@echo ""

# ── Open URLs in the default browser ──────────────────────────────────────────
open:
	@echo "$(BOLD)$(GRN)▶  Opening URLs in browser…$(RESET)"
	@xdg-open http://localhost:5174 2>/dev/null || open http://localhost:5174 2>/dev/null || \
	  echo "  $(YLW)Could not open browser automatically. Visit: http://localhost:5174$(RESET)"
	@sleep 1
	@xdg-open http://localhost:8000/docs 2>/dev/null || open http://localhost:8000/docs 2>/dev/null || true
	@sleep 1
	@xdg-open http://localhost:8180/admin 2>/dev/null || open http://localhost:8180/admin 2>/dev/null || true

# ── Stop + remove volumes (full reset) ────────────────────────────────────────
clean:
	@echo "$(BOLD)$(RED)▶  Removing containers AND volumes (full reset)…$(RESET)"
	@$(COMPOSE) down -v 2>/dev/null || true
	@echo "$(DIM)  pgdata and kcdata volumes removed.$(RESET)"

# ── Create .env from example if missing ───────────────────────────────────────
.env:
	@echo "$(YLW)  .env not found — copying from .env.example$(RESET)"
	@cp .env.example .env
	@echo "$(DIM)  Edit .env to add Cloudflare credentials if needed.$(RESET)"

# ── Internal: wait for all services to be healthy before printing URLs ─────────
_wait:
	@echo "$(DIM)  Waiting for services…$(RESET)"
	@for i in $$(seq 1 30); do \
	    FE=$$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5174 2>/dev/null); \
	    BE=$$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/health 2>/dev/null); \
	    KC=$$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8180/realms/master 2>/dev/null); \
	    if [ "$$FE" = "200" ] && [ "$$BE" = "200" ] && [ "$$KC" = "200" ]; then \
	        echo "  $(GRN)All services ready.$(RESET)"; \
	        break; \
	    fi; \
	    printf "$(DIM)  [$${i}/30] frontend:$$FE  backend:$$BE  keycloak:$$KC\r$(RESET)"; \
	    sleep 3; \
	done

# ── Help ──────────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "$(BOLD)$(CYN)  Standalone Services Suite — Makefile$(RESET)"
	@echo ""
	@echo "  $(BOLD)make up$(RESET)         Start all containers (no rebuild)"
	@echo "  $(BOLD)make build$(RESET)      Build images then start (after code changes)"
	@echo "  $(BOLD)make rebuild$(RESET)    Force-rebuild from scratch (clears layer cache)"
	@echo "  $(BOLD)make down$(RESET)       Stop containers (volumes kept)"
	@echo "  $(BOLD)make restart$(RESET)    Restart all containers"
	@echo "  $(BOLD)make clean$(RESET)      Stop + remove ALL volumes (full reset)"
	@echo ""
	@echo "  $(BOLD)make logs$(RESET)          Tail all logs"
	@echo "  $(BOLD)make logs-backend$(RESET)  Tail backend logs"
	@echo "  $(BOLD)make logs-keycloak$(RESET) Tail Keycloak logs"
	@echo "  $(BOLD)make logs-frontend$(RESET) Tail frontend logs"
	@echo ""
	@echo "  $(BOLD)make ps$(RESET)         Show container status"
	@echo "  $(BOLD)make urls$(RESET)       Print all service URLs"
	@echo "  $(BOLD)make open$(RESET)       Open URLs in default browser"
	@echo ""
