# TikUser API — Architecture Decision Records (ADRs)

- **Document Version**: 1.0.0
- **Status**: Approved & Authoritative
- **Owner**: Agent 0 (Project Manager / Tech Lead)

---

## ADR-001: Backend Framework — Fastify vs. NestJS

### Context
TikUser API is a multi-tenant platform ingesting high-throughput real-time events from TikTok LIVE broadcasts. The system must process hundreds to thousands of event payloads per second during live stream bursts, manage concurrent WebSocket subscriptions, validate HTTP request schemas against OpenAPI 3.1, and run on Node.js 24 with minimal resource overhead.

### Options Considered
1. **NestJS (Express-based or Fastify-based)**: Feature-rich enterprise framework using decorators, dependency injection containers, and module decorators.
2. **Fastify**: High-performance, low-overhead Node.js web framework with built-in JSON schema compilation and first-class WebSocket plugin support.
3. **Express**: Traditional Node.js framework.

### Decision
We select **Fastify (v4.28+) with TypeScript** organized under a **Clean Layered Modular Architecture** with explicit constructor-based dependency injection.

### Rationale
1. **Throughput & Latency**: Fastify achieves up to 75,000+ requests/second with minimal overhead per request, compared to Express-based frameworks (~15,000 req/sec). In high-volume livestream scenarios (e.g. rapid chat or gift surges), Fastify minimizes Node.js event loop lag.
2. **Schema Compilation**: Fastify natively integrates `Ajv` and `fast-json-stringify`. Route schemas compiled from the OpenAPI YAML contract validate requests and serialize JSON responses up to 2-3x faster than reflection-based libraries (`class-validator` / `class-transformer`).
3. **Node 24 & Modern TypeScript Compatibility**: NestJS relies heavily on legacy experimental decorators (`experimentalDecorators: true`, `emitDecoratorMetadata: true`, `reflect-metadata`), which suffer from known incompatibilities with native ESM and modern TypeScript compilation in Node 24. Fastify uses standard TypeScript classes and functions.
4. **WebSocket Integration**: `@fastify/websocket` shares the underlying Fastify HTTP server and routing context cleanly, avoiding the heavy architectural abstractions of NestJS `@WebSocketGateway()`.
5. **Testing Ergonomics**: Fastify provides `fastify.inject()`, allowing fast, in-memory HTTP integration tests without binding actual TCP ports.

### Consequences
- Requires manual wiring of dependencies (controllers receive services, services receive repositories) instead of automated decorator reflection.
- Architecture must follow disciplined folder structuring to maintain enterprise modularity.

---

## ADR-002: Test Runner — Vitest vs. Jest

### Context
The platform requires automated test coverage across unit tests, repository integration tests, REST API endpoints, WebSocket protocol interactions, and 15 complete end-to-end acceptance scenarios. The test runner must execute reliably and quickly in Node.js 24.

### Options Considered
1. **Jest with `ts-jest` / `@swc/jest`**: Traditional testing standard for Node.js projects.
2. **Vitest**: Next-generation test runner powered by Vite.

### Decision
We select **Vitest (v2+)** as the primary test execution engine.

### Rationale
1. **Native ESM & TypeScript**: Vitest supports TypeScript and ESM out of the box without requiring fragile Babel or `ts-jest` pre-compilation transforms.
2. **Speed & Startup Time**: Vitest initializes tests in under 200ms and executes worker thread pools with shared caching, running test suites 3x to 5x faster than Jest.
3. **Compatibility**: Vitest provides a drop-in compatible API (`describe`, `it`, `expect`, `vi.fn()`, `vi.spyOn()`), allowing developers accustomed to Jest to be immediately productive.
4. **Modern Coverage Engine**: Vitest integrates natively with V8 code coverage (`@vitest/coverage-v8`), avoiding the heavy instrumentation overhead of Istanbul.

### Consequences
- Centralized configuration in `vitest.config.ts`.
- Tests run with `vitest run` in CI and `vitest` in development watch mode.

---

## ADR-003: Database ORM & Migrations — Prisma vs. TypeORM

### Context
TikUser API uses PostgreSQL 16 to persist tenant profiles, API keys, live sessions, observed users, and high-volume canonical events with JSONB payloads. The data access layer requires strict type-safety, versioned migrations, seed support, and composite relational key constraints.

### Options Considered
1. **TypeORM**: Active-record / data-mapper ORM using TypeScript decorators.
2. **Prisma ORM**: Next-generation declarative schema ORM with type-safe generated query client.
3. **Kysely**: Type-safe SQL query builder.

### Decision
We select **Prisma ORM (v5.22+)** with PostgreSQL 16.

### Rationale
1. **Declarative Schema as Single Source of Truth**: `prisma/schema.prisma` provides a unified, readable definition of models, relations, indexes, and constraints.
2. **Type Safety & Autocomplete**: Prisma automatically generates fully typed client code (`@prisma/client`) that guarantees zero type mismatches between schema and application queries.
3. **Robust Migration Engine**: `prisma migrate dev` and `prisma migrate deploy` manage versioned SQL migrations reliably across environments.
4. **Node 24 Decorator Stability**: Like NestJS, TypeORM relies heavily on experimental decorators and entity metadata reflection, which frequently break under Node 24 ESM. Prisma avoids decorators entirely.
5. **Composite Unique & Foreign Key Support**: Prisma natively supports composite unique attributes (`@@unique([tenant_id, id])`) and composite foreign keys across relational models.

### Consequences
- Requires running `pnpm prisma generate` after schema edits or fresh repository checkouts.
- Raw SQL is used for specialized partial unique indexes when needed.

---

## ADR-004: Multi-Tenant Data Isolation via Composite Foreign Keys

### Context
TikUser API is a multi-tenant SaaS application. Under no circumstance may Tenant A view, modify, or link to data belonging to Tenant B. We must decide the tenant isolation architecture.

### Options Considered
1. **Database-per-tenant**: Separate physical PostgreSQL database per tenant.
2. **Schema-per-tenant**: Separate PostgreSQL schema per tenant within a single database.
3. **Shared database with application-level filtering**: Single database where queries manually append `WHERE tenant_id = ...`.
4. **Shared database with composite unique keys and composite foreign keys**: Tables enforce composite relational keys `(tenant_id, id)` at the database engine level.

### Decision
We select **Option 4: Shared database with composite unique constraints and composite foreign keys**, combined with compulsory `tenantId` parameterization in all repository queries.

### Rationale
1. **Physical Engine-Level Enforcement**: In addition to primary keys, parent tables (`live_sessions`, `users`) define `@@unique([tenant_id, id])`. Child tables (`events`) define composite foreign keys:
   - `[tenant_id, session_id]` references `live_sessions([tenant_id, id])`
   - `[tenant_id, user_id]` references `users([tenant_id, id])`
   This makes cross-tenant linking physically impossible. Even if application code has a bug attempting to insert an event with Tenant A's `tenant_id` but Tenant B's `session_id`, PostgreSQL immediately aborts the transaction with a foreign key violation.
2. **Operational Simplicity**: Avoids the complex migration overhead of maintaining hundreds of separate schemas or physical database connection pools.
3. **Resource Efficiency**: High-density multitenancy with predictable indexing and connection pooling.

### Consequences
- Child models (`events`) must explicitly store `tenant_id`.
- Every repository method MUST require `tenantId: string` as its first parameter.
- Cross-tenant queries return `404 Not Found` (rather than 403) to conceal the existence of other tenants' resources.

---

## ADR-005: Decoupled Connector Adapter Pattern & Deterministic Mock Connector

### Context
Connecting to TikTok LIVE rooms relies on third-party libraries (e.g. `tiktok-live-connector`). These upstream libraries are subject to platform changes, regional availability, rate limiting, and network dropouts. Automated CI/CD pipelines cannot depend on a real, active TikTok livestream to verify test scenarios.

### Options Considered
1. **Direct coupling**: Instantiate and invoke `tiktok-live-connector` directly inside domain services.
2. **Decoupled Adapter Interface**: Define an abstract interface `ITikTokLiveConnector` extending `EventEmitter`, with swappable implementations (`MockTikTokConnector` and `LiveTikTokConnector`).

### Decision
We select the **Decoupled Adapter Interface Pattern** with a first-class `MockTikTokConnector`.

### Rationale
1. **Test Determinism**: `MockTikTokConnector` simulates all 7 supported TikTok events (`member`, `chat`, `gift`, `like`, `follow`, `share`, `roomUser`), connection states, and network failures in memory with zero external latency or network dependencies.
2. **Reliable CI/CD**: All 15 required acceptance scenarios can be verified deterministically in CI environments where external outbound connections to TikTok are unavailable or blocked.
3. **Isolation from Upstream Volatility**: Upstream library upgrades or bug fixes only affect `src/adapters/tiktok-live/`, leaving domain services (`SessionService`, `EventService`) completely untouched.

### Consequences
- Domain services interact strictly with `ITikTokLiveConnector`.
- A factory or dependency injection mechanism supplies `MockTikTokConnector` in test/offline environments and `LiveTikTokConnector` in production environments.

---

## ADR-006: Ephemeral Single-Use Ticket Handshake for Realtime WebSockets

### Context
The platform exposes real-time stream events over WebSockets (`/ws`). Browser WebSocket clients cannot pass custom HTTP request headers (such as `Authorization: Bearer <key>`) during standard WebSocket handshakes. Passing API keys in query parameters (`wss://api.example.com/ws?apiKey=...`) leaks plaintext keys in reverse proxy logs, browser histories, and monitoring metrics.

### Options Considered
1. **Query string authentication**: Pass API key directly in the WebSocket URL.
2. **Cookie-based authentication**: Pass credentials via HTTP cookies.
3. **Two-step Ticket Handshake via REST**: Issue an ephemeral single-use ticket via an authenticated REST endpoint (`POST /api/v1/realtime/tickets`), then authenticate the WebSocket connection using this ticket.

### Decision
We select the **Two-Step Ticket Handshake via REST**.

### Rationale
1. **Zero Credential Exposure**: Long-lived API keys are never exposed in URLs, query strings, or server access logs.
2. **Strict Scoping**: Tickets have an ultra-short TTL (60 seconds), are single-use, and are cryptographically bound to specific authorized `sessionIds` and the requesting `tenantId`.
3. **Replay Protection**: Once a ticket is redeemed in the `{ "action": "authenticate", "ticket": "..." }` frame, it is immediately invalidated.

### Consequences
- Clients must perform a REST API call before initiating a WebSocket connection.
- A ticket storage/validation mechanism (in-memory with TTL or Redis) is maintained on the server.
