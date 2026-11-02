# TikUser API — Master Task Tracker & Verification Checklist

- **Document Version**: 1.0.0
- **Status**: Active Living Tracker
- **Owner**: Agent 0 (Project Manager / Tech Lead)
- **Scope**: Complete requirements R1 - R7 & Acceptance Test Scenarios 1 - 15

---

## 1. Milestone Status Overview

| Milestone | Name | Lead Agent | Target Scope | Status |
|---|---|---|---|---|
| **M1** | Architecture Scaffold, Docs & Database Core | Agent 0 / Agent 3 | Project config, docs, Prisma schema, seed, repositories | IN_PROGRESS |
| **M2** | TikTok & Mock Connector Subsystem | Agent 2 | Adapter interface, MockConnector, Live adapter, user normalization | PLANNED |
| **M3** | Realtime WebSocket Server | Agent 4 | Ticket handshake, WebSocket `/ws`, subscription, deduplication | PLANNED |
| **M4** | Backend REST API & Session Management | Agent 1 | Fastify routes, auth middleware, OpenAPI schemas, error handling | PLANNED |
| **M5** | DevOps, Containerization & Health Probes | Agent 6 | Dockerfile, docker-compose, logging, DEPLOYMENT.md | PLANNED |
| **M6** | Final Verification & 15 Scenarios E2E | Agent 5 | Full automated test suite across all 15 scenarios | PLANNED |

---

## 2. Detailed Work Breakdown Structure (R1 - R7)

| Task ID | Req | Milestone | Task Description | Agent | Dependencies | Status | Verification Command |
|---|---|---|---|---|---|---|---|
| **T-101** | R1 | M1 | Git repo initialization, branch config, and `.gitignore` | Agent 0 | None | DONE | `git status` |
| **T-102** | R1 | M1 | Create `package.json` with scripts & dependencies, run `pnpm install` | Agent 0 | T-101 | DONE | `pnpm -v && pnpm ls` |
| **T-103** | R1 | M1 | TypeScript configuration (`tsconfig.json`) targeting Node 24 | Agent 0 | T-102 | DONE | `pnpm typecheck` |
| **T-104** | R1 | M1 | Vitest configuration (`vitest.config.ts`) and smoke test | Agent 0 | T-102 | DONE | `pnpm test` |
| **T-105** | R1 | M1 | Author project docs: `PROJECT_PLAN.md`, `TASK_TRACKER.md`, `TECH_DECISIONS.md` | Agent 0 | T-101 | DONE | `ls docs/` |
| **T-106** | R4 | M1 | Prisma schema with 6 entities, composite unique keys & composite FKs | Agent 3 | T-102 | IN_PROGRESS | `pnpm prisma validate` |
| **T-107** | R4 | M1 | Initial migration and seed script (`prisma/seed.ts`) with Acme & Beta | Agent 3 | T-106 | PLANNED | `pnpm prisma db seed` |
| **T-108** | R4 | M1 | Database repositories with strict `tenantId` isolation parameterization | Agent 3 | T-107 | PLANNED | `pnpm test:integration` |
| **T-201** | R3 | M2 | Define `ITikTokLiveConnector` interface & lifecycle events | Agent 2 | T-103 | PLANNED | `pnpm typecheck` |
| **T-202** | R3 | M2 | Implement deterministic `MockConnector` for 7 event types | Agent 2 | T-201 | PLANNED | `vitest run tests/unit/mock-connector.test.ts` |
| **T-203** | R3 | M2 | Implement `LiveTikTokConnector` adapter with backoff retry | Agent 2 | T-201 | PLANNED | `pnpm typecheck` |
| **T-204** | R3 | M2 | User normalization service (3-tier identity quality grading) | Agent 2 | T-201 | PLANNED | `vitest run tests/unit/user-normalization.test.ts` |
| **T-301** | R5 | M3 | Ticket authentication service (`POST /api/v1/realtime/tickets`) | Agent 4 | T-108 | PLANNED | `vitest run tests/unit/ticket.test.ts` |
| **T-302** | R5 | M3 | Realtime WebSocket server on `/ws` using `@fastify/websocket` | Agent 4 | T-301 | PLANNED | `pnpm typecheck` |
| **T-303** | R5 | M3 | Channel subscription routing and `eventId` broadcast deduplication | Agent 4 | T-302 | PLANNED | `vitest run tests/websocket/broadcast.test.ts` |
| **T-304** | R5 | M3 | 30s heartbeat ping/pong mechanism and idle socket termination | Agent 4 | T-302 | PLANNED | `vitest run tests/websocket/heartbeat.test.ts` |
| **T-401** | R2 | M4 | Fastify server bootstrap (`app.ts`, `server.ts`) and unified error handler | Agent 1 | T-103 | PLANNED | `pnpm dev` |
| **T-402** | R2 | M4 | API Key authentication preHandler hook (Bearer & X-API-Key with SHA-256) | Agent 1 | T-108 | PLANNED | `vitest run tests/api/auth.test.ts` |
| **T-403** | R2 | M4 | LIVE session management endpoints (`POST`, `GET`, `DELETE /live/sessions`) | Agent 1 | T-402, T-201 | PLANNED | `vitest run tests/api/sessions.test.ts` |
| **T-404** | R2 | M4 | User and event query endpoints with cursor pagination | Agent 1 | T-402, T-108 | PLANNED | `vitest run tests/api/query.test.ts` |
| **T-405** | R2 | M4 | API Key management & health endpoints (`/health/live`, `/health/ready`) | Agent 1 | T-402 | PLANNED | `vitest run tests/api/health.test.ts` |
| **T-501** | R6 | M5 | Production multi-stage `Dockerfile` with non-root `tikuser` | Agent 6 | T-102 | PLANNED | `docker build -t tikuser-api .` |
| **T-502** | R6 | M5 | Docker Compose orchestration (`docker-compose.yml`) for API & PostgreSQL | Agent 6 | T-501 | PLANNED | `docker compose config` |
| **T-503** | R6 | M5 | `.env.example`, Pino structured logging, and `docs/DEPLOYMENT.md` | Agent 6 | T-502 | PLANNED | `cat docs/DEPLOYMENT.md` |
| **T-601** | R7 | M6 | Automated E2E verification suite covering all 15 scenarios | Agent 5 | All above | PLANNED | `pnpm test:e2e` |

---

## 3. The 15 Required Test Scenarios Verification Checklist

| Scenario # | Title | Target Component | Status | Verification Command | Assertion Criteria |
|---|---|---|---|---|---|
| **SC-01** | LIVE session creation succeeds | `POST /api/v1/live/sessions` | PLANNED | `vitest run tests/e2e/sc01-session-creation.test.ts` | Status 202 Accepted, session created in DB with status `connecting` |
| **SC-02** | TikTok LIVE connection succeeds | `SessionService` & Live Adapter | PLANNED | `vitest run tests/e2e/sc02-connector-connect.test.ts` | Session status transitions to `connected`, `started_at` populated |
| **SC-03** | Connection succeeds via Mock Connector | `MockTikTokConnector` | PLANNED | `vitest run tests/e2e/sc03-mock-connect.test.ts` | Connects in <50ms with zero network requests |
| **SC-04** | member event received | `EventService` & `UserRepository` | PLANNED | `vitest run tests/e2e/sc04-member-event.test.ts` | User upserted (`platform_id`), member event persisted in `events` |
| **SC-05** | chat event received | `EventService` & `WebSocketServer` | PLANNED | `vitest run tests/e2e/sc05-chat-event.test.ts` | Chat text saved to DB, broadcast to subscribed WS client |
| **SC-06** | gift event received | `EventService` | PLANNED | `vitest run tests/e2e/sc06-gift-event.test.ts` | Gift metadata saved; unsupplied optional fields remain null |
| **SC-07** | User information is saved | `UserService` | PLANNED | `vitest run tests/e2e/sc07-user-upsert.test.ts` | Subsequent events update profile without creating duplicate rows |
| **SC-08** | Event history is saved | `EventRepository` | PLANNED | `vitest run tests/e2e/sc08-event-history.test.ts` | Append-only batch persistence, distinct UUID `eventId` values |
| **SC-09** | Retrieve user list | `GET /api/v1/users` | PLANNED | `vitest run tests/e2e/sc09-user-list.test.ts` | Returns 200 with tenant-scoped paginated users |
| **SC-10** | Retrieve event history | `GET /api/v1/events` | PLANNED | `vitest run tests/e2e/sc10-event-history-query.test.ts` | Filterable by session/type, ordered descending, P95 < 300ms |
| **SC-11** | Real-time data over WebSocket | WebSocket `/ws` | PLANNED | `vitest run tests/e2e/sc11-ws-realtime.test.ts` | Authenticates via ticket, receives subscribed event in real time |
| **SC-12** | Invalid API Key is rejected | Auth PreHandler | PLANNED | `vitest run tests/e2e/sc12-auth-rejection.test.ts` | Missing/invalid/revoked keys return 401/403 error envelope |
| **SC-13** | Tenant isolation prevents cross-access | DB & REST & WS | PLANNED | `vitest run tests/e2e/sc13-tenant-isolation.test.ts` | Cross-tenant REST returns 404; ticket rejected with 403; DB FK blocks |
| **SC-14** | Connector disconnection handling | `SessionService` & Connector | PLANNED | `vitest run tests/e2e/sc14-disconnect-handling.test.ts` | Network drop triggers reconnecting state, bounded retries mark failed |
| **SC-15** | WebSocket client auto-reconnection | WS Client Test Harness | PLANNED | `vitest run tests/e2e/sc15-ws-reconnect.test.ts` | Socket drop re-authenticates with new ticket and deduplicates events |
