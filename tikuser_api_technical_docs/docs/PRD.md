# TikUser API — Product Requirements Document (PRD)

- **Product:** TikUser API
- **Version:** 1.1.0
- **Status:** Implementation baseline for MVP
- **Date:** 2026-11-02
- **Audience:** Product owner, AI coding agents, backend/frontend engineers, QA, DevOps

## 1. Product summary

TikUser API is a multi-tenant service that connects to TikTok LIVE rooms through a replaceable connector adapter, normalizes supported live events, stores observed public/profile event data, and exposes the data through authenticated REST endpoints and WebSocket delivery.

The service is not an official TikTok API. The initial connector may use a third-party, unofficial library. Connector compatibility, platform terms, regional availability, event availability, and library licensing must be verified before deployment. The system must not bypass access controls, CAPTCHA, authentication challenges, or platform restrictions.

## 2. Goals

1. Connect and disconnect a TikTok LIVE room using a creator username.
2. Receive supported events such as member, chat, gift, like, follow, share, and room-user statistics when the connector actually exposes them.
3. Normalize events into a stable internal schema independent of the connector library.
4. Upsert observed users and retain event history according to tenant retention settings.
5. Provide tenant-scoped REST APIs and authenticated WebSocket subscriptions.
6. Provide an operator dashboard in a later milestone; the MVP API must be usable without it.
7. Support a mock connector so automated tests do not depend on a real livestream.
8. Provide health checks, logs, metrics, reconnect controls, and safe shutdown.

## 3. Non-goals

- Obtaining a complete list of every viewer in a LIVE room. A room viewer count is not a viewer roster.
- Looking up arbitrary TikTok accounts independently of a LIVE event unless a separately approved and documented data provider is integrated.
- Retrieving private contact details, email addresses, phone numbers, private messages, passwords, or non-public account data.
- Guaranteeing delivery of every event from TikTok or the third-party connector.
- Automating likes, follows, gifts, comments, or other platform actions.
- Circumventing platform protections, account restrictions, rate limits, or access controls.
- Treating connector-specific raw payloads as a stable public API.

## 4. Personas and use cases

### 4.1 Tenant developer
- Creates an API key.
- Starts a LIVE session.
- Subscribes to events for that session.
- Fetches observed users and event history.
- Disconnects a session.

### 4.2 Tenant operator
- Views connection state and recent errors.
- Checks whether the connector is connected.
- Revokes compromised API keys.
- Adjusts session and retention settings within plan limits.

### 4.3 Game / website integration
- Receives `member`, `chat`, `gift`, and other supported events in real time.
- Maps events to game actions.
- Handles reconnects and duplicate delivery safely using `eventId`.

## 5. MVP scope and priority

| ID | Requirement | Priority | Acceptance |
|---|---|---:|---|
| FR-001 | Create LIVE session | P0 | Valid username creates a session in `connecting` state |
| FR-002 | Connect through connector adapter | P0 | Connector success changes state to `connected` |
| FR-003 | Disconnect session | P0 | Session enters `disconnected` or `ended` state |
| FR-004 | Normalize observed user | P0 | Stable user fields populated only when supplied |
| FR-005 | Normalize chat event | P0 | Text and sender linked to session |
| FR-006 | Normalize gift event | P0 | Gift metadata and repeat fields retained when supplied |
| FR-007 | Store events | P0 | Event is persisted before or according to documented delivery policy |
| FR-008 | List observed users | P0 | Tenant-scoped, paginated results |
| FR-009 | List event history | P0 | Tenant-scoped filters and pagination |
| FR-010 | WebSocket subscribe | P0 | Authorized client receives events for authorized session |
| FR-011 | API key authentication | P0 | Invalid/revoked key is rejected |
| FR-012 | Mock connector | P0 | Tests can emit deterministic fixture events |
| FR-013 | Reconnect policy | P1 | Bounded exponential backoff with jitter |
| FR-014 | Dashboard | P1 | Manage sessions, users, events, API keys |
| FR-015 | Usage/metrics | P1 | Basic request and event metrics |
| FR-016 | Arbitrary username lookup | Out of scope | Must not be simulated or inferred |

## 6. Functional requirements

### 6.1 Tenant and API key
- Every tenant-owned record must contain `tenant_id`.
- API keys are shown only once at creation.
- Store only a cryptographic hash of the API key; never store or log plaintext.
- API keys have a name, status, created time, optional expiry, and last-used time.
- Revocation takes effect immediately for new REST and WebSocket authentication.
- A key can access only resources belonging to its tenant.
- MVP may use one role (`owner`) internally, but authorization checks must be centralized.

### 6.2 LIVE session lifecycle
States:
- `queued`
- `connecting`
- `connected`
- `reconnecting`
- `disconnected`
- `ended`
- `failed`

Rules:
- A session is created before connector work starts.
- The API returns `202 Accepted` with the session resource; connection is asynchronous.
- One active connection per session.
- Duplicate active sessions for the same tenant and normalized creator username should be rejected with `409 SESSION_ALREADY_ACTIVE`, unless an explicit future product decision allows multiple connections.
- Connector callbacks must include the internal `sessionId`.
- Reconnect uses bounded exponential backoff and jitter. Do not reconnect forever.
- A session can be manually stopped.
- `ended` means the source room ended or the connector positively reported the room ended; `disconnected` means the connection was lost or manually stopped. Preserve the reason.

### 6.3 User identity and profile
- The canonical platform identity is `platform_user_id` when available.
- `unique_id` is a mutable username/handle and is not a permanent primary identity.
- If platform user ID is unavailable, use a documented fallback identity scoped to the platform and tenant; do not merge users solely because their nickname matches.
- `nickname`, `unique_id`, `avatar_url`, and `verified` are nullable.
- Record `first_seen_at` and `last_seen_at` from observed events.
- Store profile source and `profile_observed_at` so consumers can distinguish observed values from inferred values.
- Do not claim a field is current if it was only observed in an earlier event.

### 6.4 Event model
Canonical event envelope:
```json
{
  "eventId": "uuid",
  "tenantId": "uuid",
  "sessionId": "uuid",
  "type": "member",
  "occurredAt": "2026-11-02T10:00:00Z",
  "receivedAt": "2026-11-02T10:00:01Z",
  "user": {
    "platformUserId": "123",
    "uniqueId": "sample_user",
    "nickname": "Sample User",
    "avatarUrl": null
  },
  "data": {},
  "source": {
    "connector": "connector-name",
    "connectorVersion": "x.y.z"
  }
}
```
- `eventId` is generated by TikUser API and is unique.
- `occurredAt` is source time if available; otherwise use `receivedAt` and document that it is an ingestion timestamp.
- `receivedAt` is always assigned by TikUser API.
- `data` is type-specific and validated.
- Raw payload storage is optional, bounded, redacted, and disabled by default in production.
- Deduplication is best-effort. If source event IDs exist, use them. Otherwise use a short-lived fingerprint and document the possibility of false positives/negatives.
- Event delivery is **at least once / best effort** depending on connector and process failure; consumers must deduplicate by `eventId`.

### 6.5 Event-specific data
- `member`: membership/join details only if provided.
- `chat`: `text`, optional message/source ID.
- `gift`: gift ID/name, repeat count, diamond count, repeat-end indicator where supplied.
- `like`: like count/delta where supplied.
- `follow`, `share`: only emit when connector exposes a verified event.
- `roomUser`: viewer count/statistics only; never interpret as a list of viewers.
- `connected`, `disconnected`, `error`: internal lifecycle events, not user events.

### 6.6 REST API
- Base path `/api/v1`.
- JSON request/response.
- API key via `Authorization: Bearer <key>`.
- Pagination uses `limit` and opaque `cursor` (not offset for high-volume event data).
- All list endpoints are tenant scoped.
- Standard error envelope includes `code`, `message`, and optional `details`.
- Use `202` for asynchronous session creation; `200` for reads and successful commands; `400` invalid input; `401` missing/invalid key; `403` insufficient scope; `404` not found within tenant; `409` conflict; `429` rate limit; `500` unexpected error; `503` connector/service unavailable.

### 6.7 WebSocket
- Endpoint `/ws`.
- Authenticate with a short-lived WebSocket ticket obtained from REST (`POST /realtime/tickets`); do not place long-lived API keys in query strings.
- Client sends `subscribe` with a session ID.
- Server verifies tenant ownership and subscription permission.
- Server sends `event` messages using canonical event envelope.
- Server sends `subscribed`, `unsubscribed`, `heartbeat`, and structured `error` messages.
- Clients reconnect and deduplicate by `eventId`.
- Define maximum subscriptions and message size.

## 7. Non-functional requirements

### Security
- TLS in production.
- Hash API keys using a modern password/key hashing strategy suitable for high-entropy secrets (e.g. SHA-256/HMAC with server-side pepper for randomly generated keys); never log secrets.
- Rate limit by tenant and key.
- Validate all inputs and output schemas.
- Prevent cross-tenant access at repository/service level.
- Escape/sanitize user-generated text at rendering boundaries; do not execute comments.
- Validate avatar URLs and avoid server-side fetching of arbitrary URLs (SSRF risk).
- Secrets through environment/secret manager, not source control.

### Reliability
- Graceful shutdown drains workers and closes sockets.
- Connector adapter isolates library changes.
- Reconnect is bounded and observable.
- Database migrations are versioned.
- Failed event processing is logged and can be retried where safe.
- Mock connector supports deterministic failure simulation.

### Performance targets
Initial targets, to be validated under a documented test profile:
- REST read P95 < 300 ms for indexed queries at agreed load.
- Internal WebSocket dispatch P95 < 500 ms, excluding upstream TikTok and network delay.
- No unbounded in-memory event/user collections.
- Use pagination and retention policies.

### Observability
- Structured logs with request ID, tenant ID, session ID; no secrets.
- Metrics: active sessions, connection state counts, events received/processed/dropped, reconnect attempts, WebSocket clients, API latency/error rates, DB pool health.
- Health endpoints: liveness and readiness.
- Alerts for repeated connector failures and database unavailability.

## 8. Data retention and privacy
- Default event retention: configurable; proposed MVP default 30 days.
- User profile snapshots should be limited to fields necessary for product behavior.
- Tenant deletion must cascade or anonymize tenant-owned data according to documented policy.
- Support deletion/export workflows in a later phase if required by applicable law and platform terms.
- Do not store raw connector payloads by default.
- Publish a privacy notice and terms before public multi-tenant launch.
- Review applicable laws and TikTok terms before production use.

## 9. UX requirements (dashboard P1)
Pages:
1. Overview: active sessions, event counts, connection health.
2. Sessions: create, stop, inspect state, view error reason.
3. Users: observed users, search, profile observation time.
4. Events: realtime feed, filters, payload detail.
5. API keys: create, reveal once, revoke.
6. Settings: retention and connection limits.

Dashboard must show a clear distinction between:
- “Observed in this LIVE”
- “Profile field unavailable”
- “Last observed at”
- “Viewer count” versus “viewer identity list”

## 10. Acceptance test scenarios

1. Valid API key creates a session and receives `202`.
2. Invalid API key receives `401`.
3. Duplicate active session for same tenant/creator returns `409`.
4. Mock connector emits member; user is upserted and event stored.
5. Mock connector emits chat; text is stored and delivered to authorized WebSocket client.
6. Mock connector emits gift; optional gift fields remain null if absent.
7. Missing avatar does not fail event processing.
8. Two tenants cannot access each other's sessions/users/events.
9. Revoked key cannot create REST requests or new WebSocket tickets.
10. WebSocket subscription to another tenant's session is rejected.
11. Connector disconnect changes session state and records reason.
12. Reconnect attempts stop at configured maximum.
13. Pagination does not return records from another tenant.
14. Malformed connector payload is quarantined/logged without crashing worker.
15. Room viewer count is never exposed as a list of viewer identities.

## 11. Release gates

MVP is releasable only when:
- All P0 requirements pass.
- Database migrations work on a clean database.
- Unit, integration, and E2E tests pass.
- Tenant isolation tests pass.
- Secrets are not present in logs or repository.
- Connector compatibility and library license are reviewed.
- README and deployment guide are current.
- Limitations of unofficial connector and event coverage are disclosed.

## 12. Open decisions (must not be guessed by AI)
- Exact connector package and pinned version after license/compatibility review.
- Maximum concurrent sessions per tenant.
- Whether raw payload retention is ever enabled.
- Default and maximum event retention.
- Production deployment provider/region.
- Dashboard authentication provider.
- Whether a paid plan/usage billing is required.
