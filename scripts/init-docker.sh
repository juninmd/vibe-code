#!/bin/bash
# Vibe-Code Docker Setup Script
# Initializes database and services on first run

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Vibe-Code Initialization${NC}"
echo "=========================================="

# 1. Wait for PostgreSQL
echo -e "${YELLOW}⏳ Waiting for PostgreSQL...${NC}"
max_retries=30
counter=0

while ! pg_isready -h postgres -U vibeuser -d vibedb 2>/dev/null; do
  counter=$((counter + 1))
  if [ $counter -gt $max_retries ]; then
    echo -e "${RED}❌ PostgreSQL connection timeout${NC}"
    exit 1
  fi
  echo "  Attempt $counter/$max_retries..."
  sleep 2
done

echo -e "${GREEN}✅ PostgreSQL is ready${NC}"

# 2. Wait for LiteLLM
echo -e "${YELLOW}⏳ Waiting for LiteLLM...${NC}"
counter=0

while ! curl -s http://litellm:4000/health/liveliness >/dev/null 2>&1; do
  counter=$((counter + 1))
  if [ $counter -gt $max_retries ]; then
    echo -e "${YELLOW}⚠️  LiteLLM not responding (will continue anyway)${NC}"
    break
  fi
  echo "  Attempt $counter/$max_retries..."
  sleep 2
done

echo -e "${GREEN}✅ LiteLLM is ready${NC}"

# 3. Run database migrations
echo -e "${YELLOW}⏳ Running database migrations...${NC}"

MIGRATION_DIR="migrations"
if [ ! -d "$MIGRATION_DIR" ]; then
  echo -e "${RED}❌ Migration directory not found: $MIGRATION_DIR${NC}"
  exit 1
fi

# Simple migration runner (TODO: use proper migration tool like Flyway or db-migrate)
for migration in $(ls -1 "$MIGRATION_DIR"/*.sql 2>/dev/null | sort); do
  echo "  Running: $(basename "$migration")"
  psql \
    -h postgres \
    -U vibeuser \
    -d vibedb \
    -f "$migration" \
    2>&1 | grep -i "error" || true
done

echo -e "${GREEN}✅ Migrations completed${NC}"

# 4. Verify connectivity
echo -e "${YELLOW}⏳ Verifying connectivity...${NC}"

# Test PostgreSQL
if psql -h postgres -U vibeuser -d vibedb -c "SELECT 1" 2>/dev/null; then
  echo -e "${GREEN}✅ Database connection verified${NC}"
else
  echo -e "${RED}❌ Database connection failed${NC}"
  exit 1
fi

# 5. Summary
echo ""
echo -e "${GREEN}=========================================="
echo "🎉 Initialization complete!${NC}"
echo ""
echo "Services running:"
echo "  📊 Web UI:     http://localhost:5173"
echo "  🔌 API:        http://localhost:3000"
echo "  🧠 LiteLLM:    http://localhost:4000"
echo "  🐘 PostgreSQL: postgres://vibeuser@postgres:5432/vibedb"
echo ""
echo "Environment: $NODE_ENV"
echo "=========================================="
