# TikUser API — Master Task Tracker & Verification Checklist

- **Document Version**: 2.0.0
- **Status**: Completed & Verified
- **Owner**: Agent 0 (Project Manager / Tech Lead)
- **Scope**: Complete requirements R1 - R7 & Acceptance Test Scenarios 1 - 15

---

## 1. Milestone Status Overview

| Milestone | Name | Lead Agent | Target Scope | Status |
|---|---|---|---|---|
| **M1** | Architecture Scaffold, Docs & Database Core | Agent 0 / Agent 3 | Project config, docs, Prisma schema, seed, repositories | DONE |
| **M2** | TikTok & Mock Connector Subsystem | Agent 2 | Adapter interface, MockConnector, Live adapter, user normalization | DONE |
| **M3** | Realtime WebSocket Server | Agent 4 | Ticket handshake, WebSocket `/ws`, subscription, deduplication | DONE |
| **M4** | Backend REST API & Session Management | Agent 1 | Fastify routes, auth middleware, OpenAPI schemas, error handling | DONE |
| **M5** | DevOps, Containerization & Health Probes | Agent 6 | Dockerfile, docker-compose, logging, DEPLOYMENT.md | DONE |
| **M6** | Final Verification & 15 Scenarios E2E | Agent 5 | Full automated test suite across all 15 scenarios | DONE |

---

## 2. Detailed Work Breakdown Structure (R1 - R7)

| Task ID | Req | Milestone | Task Description | Agent | Dependencies | Status | Verification Command |
|---|---|---|---|---|---|---|---|
| **T-101** | R1 | M1 | Git repo initialization, branch config, and `.gitignore` | Agent 0 | None | DONE | `git status` |
| **T-102** | R1 | M1 | Create `package.json` with scripts & dependencies, run `pnpm install` | Agent 0 | T-101 | DONE | `pnpm -v && pnpm ls` |
| **T-103** | R1 | M1 | TypeScript configuration (`tsconfig.json`) targeting Node 24 | Agent 0 | T-102 | DONE | `pnpm typecheck` |
| **T-104** | R1 | M1 | Vitest configuration (`vitest.config.ts`) and smoke test | Agent 0 | T-102 | DONE | `pnpm test` |
| **T-105** | R1 | M1 | Author project docs: `PROJECT_PLAN.md`, `TASK_TRACKER.md`, `TECH_DECISIONS.md` | Agent 0 | T-101 | DONE | `ls docs/` |
| **T-106** | R4 | M1 | Prisma schema with 6 entities, composite unique keys & composite FKs | Agent 3 | T-102 | DONE | `pnpm prisma validate` |
| **T-107** | R4 | M1 | Initial migration and seed script (`prisma/seed.ts`) with Acme & Beta | Agent 3 | T-106 | DONE | `pnpm prisma db seed` |
| **T-108** | R4 | M1 | Database repositories with strict `tenantId` isolation parameterization | Agent 3 | T-107 | DONE | `pnpm test:integration` |
| **T-201** | R3 | M2 | Define `ITikTokLiveConnector` interface & lifecycle events | Agent 2 | T-103 | DONE | `pnpm typecheck` |
| **T-202** | R3 | M2 | Implement deterministic `MockConnector` for 7 event types | Agent 2 | T-201 | DONE | `vitest run tests/unit/mock-connector.test.ts` |
| **T-203** | R3 | M2 | Implement `LiveTikTokConnector` adapter with backoff retry | Agent 2 | T-201 | DONE | `pnpm typecheck` |
| **T-204** | R3 | M2 | User normalization service (3-tier identity quality grading) | Agent 2 | T-201 | DONE | `vitest run tests/unit/user-normalization.test.ts` |
| **T-301** | R5 | M3 | Ticket authentication service (`POST /api/v1/realtime/tickets`) | Agent 4 | T-108 | DONE | `vitest run tests/unit/ticket.test.ts` |
| **T-302** | R5 | M3 | Realtime WebSocket server on `/ws` using `@fastify/websocket` | Agent 4 | T-301 | DONE | `vitest run tests/websocket/websocket-protocol.test.ts` |
| **T-303** | R5 | M3 | Channel subscription routing and `eventId` broadcast deduplication | Agent 4 | T-302 | DONE | `vitest run tests/websocket/websocket-protocol.test.ts` |
| **T-304** | R5 | M3 | 30s heartbeat ping/pong mechanism and idle socket termination | Agent 4 | T-302 | DONE | `vitest run tests/websocket/websocket-protocol.test.ts` |
| **T-401** | R2 | M4 | Fastify server bootstrap (`app.ts`, `server.ts`) and unified error handler | Agent 1 | T-103 | DONE | `pnpm typecheck` |
| **T-402** | R2 | M4 | API Key authentication preHandler hook (Bearer & X-API-Key with SHA-256) | Agent 1 | T-108 | DONE | `vitest run tests/api/auth.test.ts` |
| **T-403** | R2 | M4 | LIVE session management endpoints (`POST`, `GET`, `DELETE /live/sessions`) | Agent 1 | T-402, T-201 | DONE | `vitest run tests/api/sessions.test.ts` |
| **T-404** | R2 | M4 | User and event query endpoints with cursor pagination | Agent 1 | T-402, T-108 | DONE | `vitest run tests/api/query.test.ts` |
| **T-405** | R2 | M4 | API Key management & health endpoints (`/health/live`, `/health/ready`) | Agent 1 | T-402 | DONE | `vitest run tests/api/health.test.ts` |
| **T-501** | R6 | M5 | Production multi-stage `Dockerfile` with non-root `tikuser` | Agent 6 | T-102 | DONE | `docker build -t tikuser-api .` |
| **T-502** | R6 | M5 | Docker Compose orchestration (`docker-compose.yml`) for API & PostgreSQL | Agent 6 | T-501 | DONE | `docker compose config` |
| **T-503** | R6 | M5 | `.env.example`, Pino structured logging, and `docs/DEPLOYMENT.md` | Agent 6 | T-502 | DONE | `cat docs/DEPLOYMENT.md` |
| **T-601** | R7 | M6 | Automated E2E verification suite covering all 15 scenarios | Agent 5 | All above | DONE | `vitest run tests/e2e/fifteen-scenarios.test.ts` |

---

## 3. The 15 Required Test Scenarios Verification Checklist

| Scenario # | Title | Target Component | Status | Verification Command | Assertion Criteria |
|---|---|---|---|---|---|
| **SC-01** | LIVE session creation succeeds | `POST /api/v1/live/sessions` | DONE | `vitest run tests/e2e/fifteen-scenarios.test.ts` | Status 202 Accepted, session created in DB with status `queued` |
| **SC-02** | TikTok LIVE connection succeeds | `SessionService` & Live Adapter | DONE | `vitest run tests/e2e/fifteen-scenarios.test.ts` | Session status transitions to `connected`, `started_at` populated |
| **SC-03** | Connection succeeds via Mock Connector | `MockTikTokConnector` | DONE | `vitest run tests/e2e/fifteen-scenarios.test.ts` | Connects in <50ms with zero network requests |
| **SC-04** | member event received | `EventService` & `UserRepository` | DONE | `vitest run tests/e2e/fifteen-scenarios.test.ts` | User upserted (`platform_id`), member event persisted in `events` |
| **SC-05** | chat event received | `EventService` & `WebSocketServer` | DONE | `vitest run tests/e2e/fifteen-scenarios.test.ts` | Chat text saved to DB, broadcast to subscribed WS client |
| **SC-06** | gift event received | `EventService` | DONE | `vitest run tests/e2e/fifteen-scenarios.test.ts` | Gift metadata saved; unsupplied optional fields remain null |
| **SC-07** | User information is saved | `UserService` | DONE | `vitest run tests/e2e/fifteen-scenarios.test.ts` | Subsequent events update profile without creating duplicate rows |
| **SC-08** | Event history is saved | `EventRepository` | DONE | `vitest run tests/e2e/fifteen-scenarios.test.ts` | Append-only batch persistence, distinct UUID `eventId` values |
| **SC-09** | Retrieve user list | `GET /api/v1/users` | DONE | `vitest run tests/e2e/fifteen-scenarios.test.ts` | Returns 200 with tenant-scoped paginated users |
| **SC-10** | Retrieve event history | `GET /api/v1/events` | DONE | `vitest run tests/e2e/fifteen-scenarios.test.ts` | Filterable by session/type, ordered descending, P95 < 300ms |
| **SC-11** | Real-time data over WebSocket | WebSocket `/ws` | DONE | `vitest run tests/e2e/fifteen-scenarios.test.ts` | Authenticates via ticket, receives subscribed event in real time |
| **SC-12** | Invalid API Key is rejected | Auth PreHandler | DONE | `vitest run tests/e2e/fifteen-scenarios.test.ts` | Missing/invalid/revoked keys return 401/403 error envelope |
| **SC-13** | Tenant isolation prevents cross-access | DB & REST & WS | DONE | `vitest run tests/e2e/fifteen-scenarios.test.ts` | Cross-tenant REST returns 404; ticket rejected with 403; DB FK blocks |
| **SC-14** | Connector disconnection handling | `SessionService` & Connector | DONE | `vitest run tests/e2e/fifteen-scenarios.test.ts` | Network drop triggers reconnecting state, bounded retries mark failed |
| **SC-15** | WebSocket client auto-reconnection | WS Client Test Harness | DONE | `vitest run tests/e2e/fifteen-scenarios.test.ts` | Socket drop re-authenticates with new ticket and deduplicates events |
