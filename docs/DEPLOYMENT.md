# TikUser API — Production Deployment & Operations Guide

## 1. Overview & System Requirements

TikUser API is a high-throughput, multi-tenant platform for TikTok LIVE stream event ingestion, user profiling, and real-time WebSocket distribution.

### System Prerequisites
- **Runtime**: Node.js 20.x or 22.x LTS (Alpine or Debian-based)
- **Package Manager**: `pnpm` v9+ (or `npm` / `yarn`)
- **Database**: PostgreSQL 16+ with UUID extension
- **Containers**: Docker Engine 24+ & Docker Compose v2+
- **Reverse Proxy**: Nginx, Caddy, Cloudflare, or AWS ALB with WebSocket upgrade support

---

## 2. Local Development Setup

### Step 1: Clone & Install Dependencies
```bash
git clone <repository-url>
cd TikUser-API
pnpm install
```

### Step 2: Environment Configuration
Copy `.env.example` to `.env` and configure your PostgreSQL database credentials:
```bash
cp .env.example .env
```

Key environment variables:
| Variable | Default Value | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://tikuser:tikuser_secret@localhost:5432/tikuser_db?schema=public` | PostgreSQL connection string |
| `PORT` | `3000` | HTTP and WebSocket port |
| `HOST` | `0.0.0.0` | Binding interface host |
| `NODE_ENV` | `development` | Runtime environment (`development`, `test`, `production`) |
| `TIKTOK_CONNECTOR_MODE` | `mock` | Connector mode: `mock` for deterministic testing or `live` for TikTok LIVE |
| `WS_TICKET_TTL_SECONDS` | `60` | Single-use realtime WebSocket ticket lifetime |
| `WS_HEARTBEAT_INTERVAL_MS` | `30000` | WebSocket idle ping/pong interval |

### Step 3: Run Database Migrations & Seed Data
```bash
# Apply Prisma schema migrations
pnpm prisma:deploy

# Seed initial tenants (Acme Corp & Beta Streamers) and sample API keys
pnpm prisma:seed
```

### Step 4: Run Application
```bash
# Start development server with hot-reload
pnpm dev

# Or build and start production bundle
pnpm build
pnpm start
```

### Step 5: Execute Automated Test Suite
```bash
# Run complete test suite (200+ unit, integration, and E2E tests)
pnpm test

# Run 15 required E2E acceptance scenarios
pnpm vitest run tests/e2e/fifteen-scenarios.test.ts
```

---

## 3. Docker & Containerized Deployment

TikUser API includes an optimized multi-stage `Dockerfile` and `docker-compose.yml` orchestrating PostgreSQL and the API service.

### Launching the Complete Stack
```bash
docker compose up -d --build
```

### Verification & Health Probes
```bash
# Check Docker container status
docker compose ps

# Liveness probe
curl -i http://localhost:3000/health/live

# Readiness probe (verifies database connectivity)
curl -i http://localhost:3000/health/ready
```

---

## 4. Production Reverse Proxy Configuration (Nginx)

When exposing TikUser API behind Nginx, configure HTTP/1.1 and upgrade headers for the `/ws` endpoint:

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

    # REST API Endpoints
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Realtime WebSocket Endpoint
    location /ws {
        proxy_pass http://127.0.0.1:3000/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
```

---

## 5. Security & Operational Checklist

- [x] **Zero Credential Query Parameters**: WebSocket authentication enforces ephemeral single-use tickets (`POST /api/v1/realtime/tickets`), eliminating API key leakage in URLs and logs.
- [x] **Multi-Tenant Composite Keys**: Database constraints physically isolate tenant data (`tenant_id, id`).
- [x] **Non-Root Container**: Container runs under the `tikuser` unprivileged user.
- [x] **Structured Logging**: All access and error events use Pino JSON format with correlation `requestId`.
