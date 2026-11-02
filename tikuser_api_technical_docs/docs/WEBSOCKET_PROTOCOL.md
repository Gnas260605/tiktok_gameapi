# TikUser API — WebSocket Protocol

## Endpoint and authentication

- Endpoint: `wss://api.example.com/ws`
- Obtain a short-lived ticket using `POST /api/v1/realtime/tickets`.
- Connect using the ticket in the first authentication message after opening the socket.
- Do not place long-lived API keys in URL query parameters.
- Ticket is single-use, expires quickly (recommended 60 seconds), and is scoped to an explicit list of session IDs.

## Client messages

### authenticate
```json
{ "action": "authenticate", "ticket": "short-lived-ticket" }
```

### subscribe
```json
{ "action": "subscribe", "sessionId": "uuid" }
```

### unsubscribe
```json
{ "action": "unsubscribe", "sessionId": "uuid" }
```

### ping
```json
{ "action": "ping", "clientTime": "2026-11-02T10:00:00Z" }
```

## Server messages

### authenticated
```json
{ "type": "authenticated", "connectionId": "uuid" }
```

### subscribed
```json
{ "type": "subscribed", "sessionId": "uuid" }
```

### event
```json
{
  "type": "event",
  "event": {
    "eventId": "uuid",
    "sessionId": "uuid",
    "type": "chat",
    "occurredAt": "2026-11-02T10:00:00Z",
    "receivedAt": "2026-11-02T10:00:01Z",
    "user": null,
    "data": { "text": "Hello" }
  }
}
```

### pong
```json
{ "type": "pong", "serverTime": "2026-11-02T10:00:02Z" }
```

### error
```json
{
  "type": "error",
  "error": {
    "code": "SESSION_FORBIDDEN",
    "message": "The session is not available to this client."
  }
}
```

## Protocol requirements

- Reject unauthenticated clients after a short timeout.
- Enforce tenant and ticket session scope on every subscribe.
- Limit concurrent sockets and subscriptions per tenant.
- Set maximum inbound message size.
- Heartbeat idle connections.
- Close revoked/expired ticket sessions according to policy.
- Do not broadcast an event until it has passed validation and the documented persistence policy.
- Include stable `eventId`; clients deduplicate.
- Preserve per-session ordering where feasible, but do not promise global ordering across sessions.
- Client reconnect strategy: exponential backoff with jitter.
- Suggested close codes: 1000 normal, 1008 policy violation, 1011 internal error, 1013 temporary overload.
