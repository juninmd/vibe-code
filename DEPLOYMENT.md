# Vibe-Code v2 — Docker Deployment Guide

## Overview

This guide covers deploying Vibe-Code v2 as a self-hosted application using Docker Compose. The stack includes:

- **Vibe-Code App** (backend Hono + frontend React)
- **PostgreSQL 16** (persistent data)
- **LiteLLM** (LLM provider abstraction)

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- At least 4GB RAM available
- Port 3000 (API), 5173 (Web UI), 4000 (LiteLLM) available

## Quick Start

### 1. Clone Repository

```bash
git clone <repository-url> vibe-code
cd vibe-code
```

### 2. Configure Environment

Create `.env` file (optional, defaults work for local testing):

```bash
cat > .env << 'EOF'
# Database
POSTGRES_PASSWORD=your_secure_password

# LiteLLM Configuration
LITELLM_MASTER_KEY=sk-your-master-key
LITELLM_API_KEY=sk-your-master-key

# LLM Provider Keys (add as needed)
ANTHROPIC_API_KEY=your_anthropic_key
OPENAI_API_KEY=your_openai_key
GEMINI_API_KEY=your_gemini_key

# Vibe-Code Settings
NODE_ENV=production
VIBE_CODE_MAX_AGENTS=4
EOF
```

### 3. Start Services

```bash
# Build and start all services (may take 5-10 minutes on first run)
docker-compose up -d

# View logs
docker-compose logs -f

# Check service health
docker-compose ps
```

### 4. Access Application

Once all services are healthy:

- **Web UI**: http://localhost:5173
- **API**: http://localhost:3000
- **LiteLLM Admin**: http://localhost:4000
- **API Docs** (if enabled): http://localhost:3000/api-docs

## Production Deployment

### Security Hardening

1. **Use Strong Passwords**:
   ```bash
   POSTGRES_PASSWORD=$(openssl rand -base64 32)
   LITELLM_MASTER_KEY=$(openssl rand -hex 32)
   ```

2. **Enable TLS** (with Traefik or Nginx reverse proxy)

3. **Network Configuration**:
   ```yaml
   # docker-compose.yml
   services:
     # Only expose app container to reverse proxy network
     vibe-app:
       networks:
         - traefik
     postgres:
       networks:
         - vibe-internal
   ```

4. **Resource Limits**:
   ```yaml
   services:
     vibe-app:
       deploy:
         resources:
           limits:
             cpus: '2'
             memory: 2G
   ```

### Database Backups

Create backup script `scripts/backup-db.sh`:

```bash
#!/bin/bash
BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "$BACKUP_DIR"

docker-compose exec -T postgres pg_dump \
  -U vibeuser \
  -d vibedb \
  | gzip > "$BACKUP_DIR/vibedb-${TIMESTAMP}.sql.gz"

echo "Backup saved to: $BACKUP_DIR/vibedb-${TIMESTAMP}.sql.gz"

# Keep only last 30 days
find "$BACKUP_DIR" -name "vibedb-*.sql.gz" -mtime +30 -delete
```

Schedule with cron:
```bash
0 2 * * * cd /path/to/vibe-code && bash scripts/backup-db.sh
```

## Troubleshooting

### Services Won't Start

```bash
# Check logs for all services
docker-compose logs

# Check specific service
docker-compose logs vibe-app
docker-compose logs postgres
docker-compose logs litellm

# View resource usage
docker stats
```

### Database Connection Issues

```bash
# Test database connection
docker-compose exec postgres psql -U vibeuser -d vibedb -c "SELECT 1"

# Check PostgreSQL logs
docker-compose logs postgres | tail -20
```

### LiteLLM Not Responding

```bash
# Check LiteLLM health
docker-compose exec litellm wget -qO- http://localhost:4000/health/liveliness

# View LiteLLM config
cat litellm.config.yaml
```

## Maintenance

### Update Application

```bash
# Stop services
docker-compose down

# Pull latest code
git pull origin main

# Rebuild image with fresh dependencies
docker-compose build --no-cache

# Restart services
docker-compose up -d
```

### View Application Logs

```bash
# Real-time logs
docker-compose logs -f vibe-app

# Last 50 lines
docker-compose logs --tail=50 vibe-app

# Specific time range
docker-compose logs --since 2024-01-15 --until 2024-01-16
```

### Database Maintenance

```bash
# Connect to PostgreSQL
docker-compose exec postgres psql -U vibeuser -d vibedb

# Inside psql:
\dt                          -- List tables
\d table_name                -- Describe table
SELECT COUNT(*) FROM table;  -- Check row counts
VACUUM;                      -- Optimize tables
```

## Networking

The services communicate over an internal Docker bridge network:

```
┌─────────────────────────────────────────────┐
│        Internet (Reverse Proxy)             │
└───────────────┬─────────────────────────────┘
                │
    ┌───────────▼─────────────┐
    │   vibe-app (port 3000)  │ ◄─── Only exposed port
    │   + React UI (5173)     │
    └───────┬─────────────────┘
            │
    ┌───────▼──────────────┐
    │ Shared Docker Network│
    ├────────┬─────────────┤
    │        │             │
  ┌─▼──┐  ┌─▼────┐  ┌──────▼──┐
  │ PG │  │ LL4M │  │ Redis   │
  └────┘  └──────┘  └─────────┘
```

## Environment Variables Reference

| Variable | Default | Purpose |
|----------|---------|---------|
| `NODE_ENV` | `production` | Runtime environment |
| `PORT` | `3000` | API server port |
| `DATABASE_URL` | Auto-configured | PostgreSQL connection string |
| `VIBE_CODE_DATA_DIR` | `/app/data` | Application data directory |
| `VIBE_CODE_MAX_AGENTS` | `4` | Concurrent agent limit |
| `LITELLM_BASE_URL` | `http://litellm:4000` | LiteLLM API endpoint |
| `LITELLM_API_KEY` | — | LiteLLM authentication |
| `POSTGRES_PASSWORD` | `vibepassword` | PostgreSQL password |
| `LITELLM_MASTER_KEY` | — | LiteLLM admin key |

## Performance Tuning

### PostgreSQL

```bash
# Connect to container
docker-compose exec postgres bash

# Modify PostgreSQL config
echo "shared_buffers = 256MB" >> /var/lib/postgresql/data/postgresql.conf
echo "effective_cache_size = 1GB" >> /var/lib/postgresql/data/postgresql.conf
```

### Memory Usage

Monitor with:
```bash
docker stats vibe-app postgres litellm --no-stream
```

Adjust in docker-compose.yml:
```yaml
services:
  vibe-app:
    deploy:
      resources:
        limits:
          memory: 2G
```

## Support

- **Documentation**: https://github.com/vibe-code/docs
- **Issues**: https://github.com/vibe-code/vibe-code/issues
- **Community**: https://discord.gg/vibe-code

---

**Version**: v2.0.0  
**Updated**: 2024-01-15  
**Maintainers**: Vibe-Code Team
