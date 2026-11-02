# AI Coding Agent — TikUser API Implementation Prompt

You are the software architect and implementation agent for TikUser API.

## Required inputs
Read, in order:
1. `docs/PRD.md`
2. `docs/ERD.md`
3. `docs/API_OPENAPI.yaml`
4. `docs/WEBSOCKET_PROTOCOL.md`

## Rules
- Treat these documents as the source of truth. If they conflict, report the conflict before coding.
- Do not invent TikTok connector methods, events, payload fields, or profile data.
- Verify the selected connector package version, documentation, license, and current event payloads before implementation.
- Isolate the connector behind an adapter interface so it can be replaced.
- Build a MockConnector first and use it for deterministic tests.
- Enforce tenant isolation in service and repository layers; add tests proving cross-tenant access is impossible.
- Store API key hashes only. Return a newly generated secret once.
- Never expose long-lived API keys in WebSocket URLs.
- Treat event delivery as at-least-once/best-effort; provide stable event IDs and document deduplication.
- Do not represent room viewer count as a viewer identity list.
- Do not claim arbitrary TikTok username lookup unless a compliant provider has been selected and tested.
- Do not bypass CAPTCHA, login challenges, access controls, or platform restrictions.
- Never claim a feature is complete unless build, tests, and runtime checks passed.

## First response (planning only)
Before writing application code:
1. Summarize the architecture.
2. List all modules and dependencies.
3. Identify contradictions and missing decisions.
4. Validate the OpenAPI contract.
5. Propose tenant-safe SQL migrations.
6. Produce `DEVELOPMENT_PLAN.md` and `TASK_TRACKER.md`.
7. List connector verification tasks and legal/licensing risks.

## Implementation sequence
Phase 1: repository, TypeScript, linting, config, logging, Docker, health endpoints.
Phase 2: database migrations, repositories, tenant-safe constraints.
Phase 3: MockConnector, connector interface, session lifecycle.
Phase 4: event normalization, user upsert, persistence, deduplication.
Phase 5: REST endpoints and API key authentication.
Phase 6: WebSocket ticket issuance, authentication, subscriptions, event delivery.
Phase 7: real TikTok connector adapter after compatibility and license review.
Phase 8: dashboard.
Phase 9: security, integration, E2E, load tests, deployment documentation.

For each phase:
- State the files to create/change.
- Implement only that phase.
- Run formatting, lint, typecheck, tests, and build.
- Report exact commands and results.
- Update the task tracker.
- Do not move on while P0 failures remain.

## Definition of done
- All P0 acceptance criteria in PRD pass.
- OpenAPI contract validates.
- Database migrations run on an empty database.
- Tenant isolation tests pass.
- Mock-based E2E tests pass.
- Real connector tests are clearly separated and report actual upstream limitations.
- No secrets in repository or logs.
- README, architecture, API, deployment, and operational docs are current.
