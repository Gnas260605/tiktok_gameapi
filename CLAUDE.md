# CLAUDE.md — TikUser API Developer & AI Assistant Guide

This document provides essential architectural context, codebase structure, development commands, and design rules for Claude when working on the **TikUser API** project.

---

## 1. Project Overview

**TikUser API** is an enterprise-grade, multi-tenant platform for:
1. Connecting to TikTok LIVE broadcasts (via `TikTok-Live-Connector` or a deterministic `MockConnector`).
2. Capturing and normalizing viewer events (`member`, `chat`, `gift`, `like`, `follow`, `share`, `roomUser`).
3. Managing audience profiles with 3-tier identity quality grading (`platform_id`, `handle_fallback`, `event_only`).
4. Persisting canonical events with strict database-level multi-tenant isolation.
5. Broadcasting live events over WebSockets (`/ws`) using an ephemeral single-use ticket authentication handshake.

---

## 2. Technology Stack

- **Runtime**: Node.js >= 20 LTS
- **Language**: TypeScript (strict mode, Node 20 target)
- **Web Framework**: Fastify v4 (`@fastify/cors`, `@fastify/websocket`, `@fastify/swagger`, `@fastify/swagger-ui`)
- **Database**: PostgreSQL 16+
- **ORM & Migrations**: Prisma ORM v5
- **Testing Engine**: Vitest v2 (`@vitest/coverage-v8`)
- **Logging**: Pino (structured JSON logging)
- **Containerization**: Docker (multi-stage Alpine) & Docker Compose

---

## 3. Essential Commands

### Development & Build
```bash
pnpm install          # Install dependencies
pnpm dev              # Start development server with tsx watch
pnpm build            # Clean dist and compile TypeScript (tsc -p tsconfig.json)
pnpm start            # Run compiled production server (node dist/src/server.js)
pnpm typecheck        # Run TypeScript compiler check without emitting files
```

### Database & Prisma
```bash
pnpm prisma:generate  # Regenerate @prisma/client
pnpm prisma:migrate   # Run migrations in dev (prisma migrate dev)
pnpm prisma:deploy    # Apply migrations in production/CI (prisma migrate deploy)
pnpm prisma:seed      # Seed initial tenants (Acme Corp & Beta Streamers) and keys
```

### Testing (Vitest)
```bash
pnpm test             # Run entire test suite (200+ unit, integration & E2E tests)
pnpm test:watch       # Run Vitest in interactive watch mode
pnpm test:coverage    # Generate test coverage report
pnpm test:unit        # Run unit tests only (tests/unit)
pnpm test:integration # Run integration tests (tests/integration)
pnpm test:e2e         # Run end-to-end acceptance tests (tests/e2e)
```

### Docker
```bash
docker compose up -d --build   # Build and start PostgreSQL + API stack
docker compose down            # Stop and remove containers
```

---

## 4. Codebase Architecture & Directory Map

```text
TikUser-API/
├── docs/                             # Authoritative technical documentation
│   ├── PRD.md                        # Product requirements
│   ├── ERD.md                        # Entity-relationship specification
│   ├── API_OPENAPI.yaml              # OpenAPI 3.1 contract
│   ├── WEBSOCKET_PROTOCOL.md         # WebSocket specification
│   ├── PROJECT_PLAN.md               # Multi-agent architectural roadmap
│   ├── TASK_TRACKER.md               # Tasks & 15 scenarios verification checklist
│   ├── TECH_DECISIONS.md             # Architecture Decision Records (ADRs)
│   └── DEPLOYMENT.md                 # Production deployment & operations
├── src/
│   ├── adapters/
│   │   └── tiktok/                   # ITikTokLiveConnector, MockConnector, LiveTikTokConnector
│   ├── controllers/                  # REST route handlers
│   │   ├── api-key.controller.ts     # Key generation, listing, revocation
│   │   ├── event.controller.ts       # Query events (filtering by session, user, type)
│   │   ├── formatters.ts             # OpenAPI JSON response transformers
│   │   ├── health.controller.ts      # /health/live and /health/ready probes
│   │   ├── realtime.controller.ts    # POST /api/v1/realtime/tickets
│   │   ├── session.controller.ts     # LIVE session lifecycle (create, list, get, disconnect)
│   │   └── user.controller.ts        # Observed user profiles and user event history
│   ├── middleware/
│   │   ├── auth.middleware.ts        # API Key authentication preHandler hook
│   │   └── error-handler.ts          # Unified OpenAPI-compliant error response handler
│   ├── repositories/                 # Data access layer with tenant isolation
│   │   ├── api-key.repository.ts
│   │   ├── event.repository.ts
│   │   ├── session.repository.ts
│   │   ├── tenant.repository.ts
│   │   ├── tenant-settings.repository.ts
│   │   └── user.repository.ts
│   ├── services/
│   │   ├── auth/                     # API key validation, hashing (SHA-256)
│   │   ├── event/                    # Ingestion pipeline, batching, dedup cache
│   │   ├── realtime/                 # Ephemeral single-use WebSocket tickets
│   │   ├── session/                  # Connector lifecycle orchestration
│   │   └── user/                     # 3-tier user identity normalization
│   ├── websocket/
│   │   ├── types.ts                  # Protocol frame types
│   │   └── websocket-manager.ts      # Connection manager, heartbeat sweep, broadcast
│   ├── app.ts                        # Fastify application factory & plugin configuration
│   └── server.ts                     # Application entry point
├── prisma/
│   ├── schema.prisma                 # PostgreSQL schema with composite FKs
│   ├── migrations/                   # SQL migration history
│   └── seed.ts                       # Multi-tenant seed script
├── tests/
│   ├── api/                          # REST API integration tests
│   ├── e2e/                          # 15 mandatory scenarios E2E test suite
│   ├── integration/                  # Database repository and stress tests
│   ├── unit/                         # Unit tests (MockConnector, TicketService, Normalization)
│   └── websocket/                    # WebSocket protocol & isolation tests
├── Dockerfile                        # Multi-stage production container
├── docker-compose.yml                # Production orchestration
└── .env.example                      # Environment variables reference
```

---

## 5. Architectural & Design Rules (Never Violate)

### 1. Multi-Tenant Isolation
- **Rule**: Every repository query MUST be scoped by `tenantId: string`.
- **Composite Keys**: Tables (`live_sessions`, `users`, `events`) enforce composite foreign keys `[tenant_id, id]`. Cross-tenant record references are physically blocked by PostgreSQL.
- **Privacy via 404**: When a tenant requests a session, user, or event belonging to another tenant, always return `404 Not Found` (never 403) so existence of other tenants' data is concealed.

### 2. API Key Authentication & Hashing
- API Keys are transmitted via `Authorization: Bearer <key>` or `X-API-Key: <key>`.
- Plaintext keys are never stored; only their SHA-256 hash (`keyHash`) is stored.
- When generating a key (`POST /api/v1/api-keys`), the plaintext key is returned once in the response and never again.

### 3. Ephemeral WebSocket Ticket Handshake
- Never pass API keys in WebSocket query parameters (e.g. `wss://.../ws?apiKey=...` is strictly prohibited).
- Client workflow:
  1. REST call: `POST /api/v1/realtime/tickets` with `{ "sessionIds": ["<UUID>"] }` (requires API key).
  2. Server returns a short-lived ticket (`tkt_...`, TTL: 60s).
  3. Client opens `ws://<host>/ws`.
  4. Client sends: `{ "action": "authenticate", "ticket": "..." }`.
  5. Ticket is atomically redeemed and purged immediately (single-use).
  6. Client sends: `{ "action": "subscribe", "sessionId": "..." }`.

### 4. TikTok Connector Decoupling
- Business logic interacts exclusively with the `ITikTokLiveConnector` interface.
- For testing and CI/CD, always use `MockConnector` (zero external network dependency, deterministic simulation of all 7 event types).
- Use `LiveTikTokConnector` for production TikTok streams.
- Environment toggle: `TIKTOK_CONNECTOR_MODE=mock` or `live`.

### 5. Response Envelopes & Error Handling
All HTTP responses conform to OpenAPI 3.1:
- **Success**: `{ "success": true, "data": ... }` (plus `"meta": { "nextCursor", "hasMore" }` for paginated lists).
- **Error**:
  ```json
  {
    "success": false,
    "error": {
      "code": "BAD_REQUEST | UNAUTHORIZED | FORBIDDEN | NOT_FOUND | CONFLICT | RATE_LIMITED | INTERNAL_ERROR",
      "message": "Human-readable description",
      "details": {},
      "requestId": "req-xxx"
    }
  }
  ```

### 6. Concurrency & Deadlock Handling
- During high-concurrency burst event ingestion, concurrent user upserts handle PostgreSQL `40P01` (deadlock detected) and `P2002` (unique violation) with jittered backoff and recovery.

---

## 6. The 15 Mandatory E2E Acceptance Scenarios

Implemented and verified in `tests/e2e/fifteen-scenarios.test.ts`:

1. **SC-01**: `POST /api/v1/live/sessions` creates session (202 Accepted, status: `queued`).
2. **SC-02**: Live connector connects, populates `startedAt`, status becomes `connected`.
3. **SC-03**: Mock connector connects in <50ms without external network requests.
4. **SC-04**: `member` event received, user observed, event persisted in `events` table.
5. **SC-05**: `chat` event received with comment text and broadcast to subscribers.
6. **SC-06**: `gift` event received with diamond count and streak repeat count.
7. **SC-07**: User profiles updated across subsequent events without creating duplicate rows.
8. **SC-08**: Events saved with unique UUIDs in an append-only log.
9. **SC-09**: `GET /api/v1/users` returns paginated, tenant-isolated user list.
10. **SC-10**: `GET /api/v1/events` returns filtered event history.
11. **SC-11**: Real-time event streaming received over active WebSocket connection.
12. **SC-12**: Missing, invalid, expired, or revoked API keys rejected (401/403).
13. **SC-13**: Cross-tenant data access blocked (returns 404/403).
14. **SC-14**: Session disconnect (`DELETE /api/v1/live/sessions/:id`) transitions status to `ended`.
15. **SC-15**: Dropped WebSocket clients re-authenticate with fresh tickets and resume streaming.

---

## 7. Useful Test Commands for Claude

```bash
# Run all tests
pnpm test

# Run only the 15 E2E scenarios
pnpm vitest run tests/e2e/fifteen-scenarios.test.ts

# Run adversarial multi-tenant stress tests
pnpm vitest run tests/integration/adversarial_isolation.test.ts
pnpm vitest run tests/integration/adversarial-connector-stress.test.ts

# Check TypeScript types
pnpm typecheck
```
