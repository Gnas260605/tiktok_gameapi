# TikUser API — Technical Documentation Pack

This pack contains the implementation baseline for TikUser API v1.1.

## Files
- `docs/PRD.md` — product requirements and acceptance criteria.
- `docs/ERD.md` — entity relationships, schema notes, PostgreSQL DDL.
- `docs/API_OPENAPI.yaml` — OpenAPI 3.1 REST contract.
- `docs/WEBSOCKET_PROTOCOL.md` — WebSocket message contract.
- `AI_IMPLEMENTATION_PROMPT.md` — prompt for an AI coding agent.

## Important implementation notes
1. TikTok LIVE integration is through an unofficial connector adapter unless a separately approved official integration is available. Verify current package API, version, license, platform terms, and regional behavior before implementation.
2. Do not assume every event type is available in every LIVE room.
3. A viewer count is not a list of viewer identities.
4. Do not implement arbitrary profile lookup unless a compliant, documented provider is selected.
5. Enforce tenant isolation in every query and relationship.
6. OpenAPI describes REST. WebSocket is specified separately because OpenAPI does not natively define the socket message lifecycle.
7. The ERD DDL is a baseline. Apply the tenant-safe composite foreign-key correction described in `ERD.md` before production.

## Suggested first AI task
Read all docs, identify contradictions and unresolved decisions, validate the OpenAPI YAML, refine the migration with tenant-safe foreign keys, then produce a phase-by-phase implementation plan. Do not generate the entire application in one pass.
