# TikUser API — Project Plan & Multi-Agent Coordination Framework

- **Document Version**: 1.0.0
- **Status**: Authoritative Master Plan
- **Owner**: Agent 0 (Project Manager / Tech Lead)
- **Target Runtime**: Node.js v24.15.0, TypeScript 5.7+, pnpm 11.9.0, PostgreSQL 16, Fastify 4.28+

---

## 1. Project Vision & Architecture Baseline

TikUser API is a high-throughput, multi-tenant backend platform engineered to interface with TikTok LIVE broadcasts, ingest and canonicalize real-time stream events (join, chat, gift, like, share, follow, room stats), persist user observations and event records into a partitioned/indexed PostgreSQL database, and broadcast events to authenticated clients via WebSocket and REST APIs.

### Core Architectural Pillars:
1. **Clean Layered Modular Architecture**: Strict separation of concerns across Presentation (Fastify routes, WebSocket), Application (Domain Services), Persistence (Tenant-scoped Repositories), and Adapters (`ITikTokLiveConnector`).
2. **Strict Multi-Tenant Isolation**: Enforced by composite database constraints (`@@unique([tenant_id, id])`), composite foreign keys, and compulsory `tenantId` parameterization in every repository query.
3. **Decoupled Connector Interface**: All event ingestion and session control logic interacts exclusively with the abstract `ITikTokLiveConnector` interface, enabling 100% deterministic testing via `MockConnector` without external network dependencies.
4. **Zero-Trust WebSocket Ticket Handshake**: Eliminates credential exposure in query strings by using short-lived (60s), single-use HMAC tickets generated via authenticated REST requests (`POST /api/v1/realtime/tickets`).

---

## 2. Multi-Agent Team Structure & Ownership Matrix

| Agent Role | Title | Core Responsibilities | Key Deliverables |
|---|---|---|---|
| **Agent 0** | **Project Manager / Tech Lead** | Overall architectural governance, inter-agent coordination, gate approvals, task tracker updates, code review. | `docs/PROJECT_PLAN.md`, `docs/TASK_TRACKER.md`, `docs/TECH_DECISIONS.md` |
| **Agent 1** | **Backend Architect** | Fastify application foundation, middleware pipeline, REST controllers, validation schemas (Ajv/OpenAPI), error envelope handling. | `src/app.ts`, `src/server.ts`, `src/controllers/*`, `src/core/errors.ts` |
| **Agent 2** | **TikTok Connector Engineer** | `ITikTokLiveConnector` interface, deterministic `MockConnector`, `LiveTikTokConnector` adapter, user profile normalization, retry backoff state machine. | `src/adapters/tiktok-live/*`, `src/adapters/mock/*`, `src/services/user/*` |
| **Agent 3** | **Database Engineer** | PostgreSQL schema design, composite tenant constraints, Prisma migrations, seed data, tenant-scoped database repositories. | `prisma/schema.prisma`, `prisma/migrations/*`, `prisma/seed.ts`, `src/repositories/*` |
| **Agent 4** | **Realtime / WebSocket Engineer** | WebSocket server on `/ws`, ticket authentication, tenant subscription routing, real-time event broadcasting, deduplication, heartbeat ping/pong. | `src/websocket/*`, `src/services/realtime/*` |
| **Agent 5** | **QA / Test Engineer** | Vitest test harness setup, integration tests, API endpoint verification, WebSocket protocol tests, full 15-scenario verification suite. | `tests/unit/*`, `tests/integration/*`, `tests/api/*`, `tests/websocket/*`, `tests/e2e/*` |
| **Agent 6** | **DevOps / Deployment Engineer** | Containerization, multi-stage production Dockerfile, Docker Compose orchestration, health probes, Pino logging, deployment guide. | `Dockerfile`, `docker-compose.yml`, `.env.example`, `docs/DEPLOYMENT.md` |

---

## 3. Milestone Delivery Roadmap

```
  ┌────────────────────────────────────────────────────────┐
  │ M1: Architecture Scaffold, Docs & Database Core        │
  │     (Agents 0, 1, 3)                                   │
  └───────────────────────────┬────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
  ┌───────────────────────┐       ┌───────────────────────┐
  │ M2: TikTok Connector  │       │ M3: Realtime          │
  │     & Ingestion       │       │     WebSocket Server  │
  │     (Agent 2)         │       │     (Agent 4)         │
  └───────────┬───────────┘       └───────────┬───────────┘
              │                               │
              └───────────────┬───────────────┘
                              ▼
  ┌────────────────────────────────────────────────────────┐
  │ M4: REST API & LIVE Session Lifecycle Management       │
  │     (Agents 1, 3, 4)                                   │
  └───────────────────────────┬────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
  ┌───────────────────────┐       ┌───────────────────────┐
  │ M5: DevOps, Probes &  │       │ M6: Full Verification │
  │     Containerization  │       │     15 Scenarios E2E  │
  │     (Agent 6)         │       │     (Agent 5)         │
  └───────────────────────┘       └───────────────────────┘
```

### Detailed Milestone Breakdown:

#### Milestone 1: Architecture Scaffold, Docs & Database Core
- **Scope**: Repository initialization, pnpm scripts, TypeScript, Vitest, Fastify app baseline, documentation docs (`PROJECT_PLAN.md`, `TASK_TRACKER.md`, `TECH_DECISIONS.md`), Prisma schema with 6 entities and composite keys, initial migration, seed script, tenant-scoped repositories (`TenantRepository`, `ApiKeyRepository`, `SessionRepository`, `UserRepository`, `EventRepository`).
- **Dependencies**: None.
- **Exit Gate**: `pnpm typecheck` passes; `pnpm test` passes smoke and repository tenant isolation integration tests.

#### Milestone 2: TikTok & Mock Connector Subsystem
- **Scope**: `ITikTokLiveConnector` adapter interface, deterministic `MockConnector` simulating all 7 event types (member, chat, gift, like, follow, share, roomUser), `LiveTikTokConnector` wrapper, 3-tier user profile normalization service, event ingestion pipeline.
- **Dependencies**: M1.
- **Exit Gate**: Mock connector emits all events deterministically; unit tests pass without network access.

#### Milestone 3: Realtime WebSocket Server
- **Scope**: Single-use ticket issuance service (`POST /api/v1/realtime/tickets`), Fastify WebSocket server mounted on `/ws`, connection lifecycle, ticket validation, channel subscription routing `(tenantId, sessionId)`, event broadcast with `eventId` deduplication, 30s ping/pong heartbeat.
- **Dependencies**: M1.
- **Exit Gate**: WebSocket integration test verifies ticket handshake, subscription, event delivery, and unauthenticated disconnection.

#### Milestone 4: Backend REST API & Session Management
- **Scope**: REST endpoints per `API_OPENAPI.yaml` (`/api/v1/live/sessions`, `/api/v1/users`, `/api/v1/events`, `/api/v1/api-keys`, `/api/v1/health/live`, `/api/v1/health/ready`), Bearer and X-API-Key authentication middleware, SHA-256 key hashing, unified error envelope, session lifecycle state machine.
- **Dependencies**: M1, M2, M3.
- **Exit Gate**: All OpenAPI endpoints respond with correct status codes, schemas, and tenant isolation guarantees.

#### Milestone 5: DevOps, Containerization & Health Probes
- **Scope**: Multi-stage production `Dockerfile` (unprivileged `tikuser` user), `docker-compose.yml` orchestrating API and PostgreSQL with health checks, `.env.example`, structured Pino logging, and `docs/DEPLOYMENT.md`.
- **Dependencies**: M1, M4.
- **Exit Gate**: `docker compose up -d` boots healthy containers; `/api/v1/health/live` and `/ready` return 200 OK.

#### Milestone 6: Final Verification & 15 Scenarios E2E
- **Scope**: Automated test suite executing all 15 required acceptance scenarios: session creation, connector connection, mock connection, member/chat/gift events, user upsert, event history, user/event query endpoints, WebSocket delivery, API key rejection (401/403), cross-tenant isolation, connector disconnect handling, WebSocket client auto-reconnection.
- **Dependencies**: M1 through M5.
- **Exit Gate**: 100% of all 15 test scenarios pass in automated Vitest run.

---

## 4. Definition of Done (DoD)

A milestone or feature is considered complete ONLY when:
1. **Type Safety**: `pnpm typecheck` passes with zero errors (`tsc --noEmit`).
2. **Automated Testing**: All relevant unit, integration, and E2E tests pass via `pnpm test`.
3. **Tenant Security**: Repository and API queries enforce tenant scoping; zero cross-tenant leakage.
4. **Schema Compliance**: REST responses conform to `API_OPENAPI.yaml`; WebSocket messages conform to `WEBSOCKET_PROTOCOL.md`.
5. **No Plaintext Secrets**: API keys are hashed with SHA-256 before storage; no secrets in logs or git.
6. **Self-Contained Handoff**: Handoff report provides exact verification commands and execution results.

---

## 5. Risk Matrix & Mitigations

| Risk ID | Risk Description | Severity | Mitigation Strategy |
|---|---|---|---|
| **RSK-01** | Upstream TikTok LIVE library changes or protocol breakage | High | Decoupled Connector Adapter isolates all upstream code; `MockConnector` allows 100% offline development and automated testing. |
| **RSK-02** | Cross-tenant data leakage between customers | Critical | Composite database foreign keys (`[tenant_id, id]`) physically block cross-tenant references at the database engine level; repositories require `tenantId` on every method. |
| **RSK-03** | API key leakage via WebSocket query strings | High | REST ticket handshake (`POST /api/v1/realtime/tickets`) issues single-use, 60s ephemeral tickets; long-lived keys are never placed in URLs. |
| **RSK-04** | High-volume event bursts overwhelming database | Medium | JSONB payload column for flexible event data; optimized B-tree indexes on `(tenant_id, created_at)` and partial unique index on active sessions. |
| **RSK-05** | Node.js ESM decorator compilation bugs in Node 24 | Medium | Selected Fastify + TypeScript with explicit dependency injection, avoiding fragile legacy decorator runtimes. |
