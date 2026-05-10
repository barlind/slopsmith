# Contract: Remote Support Protocol

The relay carries typed messages between the local Remote Support plugin and a support dashboard. The relay is a message room, not a policy authority and not a raw tunnel.

## Envelope

```json
{
  "schema": "remote-support.message.v1",
  "id": "msg_001",
  "session_id": "rs_abc123",
  "type": "diagnostics.request",
  "sent_at": "2026-05-10T18:00:00Z",
  "actor": {
    "display_name": "Community helper",
    "kind": "human",
    "verified": false
  },
  "payload": {}
}
```

## Session Messages

### `session.hello`

Sent by support dashboard when joining a relay room.

Payload:

```json
{
  "pairing_code": "842193",
  "reconnect_token": "opaque-if-reconnecting",
  "requested_identity": { "display_name": "Support", "verified": false }
}
```

Rules:

- The local side accepts only one active support connection.
- Additional viewers receive `session.rejected` while the active support connection remains uninterrupted.
- Same-party reconnect is allowed before session expiry when local reconnect validation passes.

### `session.ready`

Sent by the local plugin when core has an active consented session.

Payload includes session mode, active grants, expiration, identity verification status, and local warning requirements.

### `session.closed`

Sent by either side. Local closure reasons include `revoked`, `expired`, `app-exit`, `relay-failed`, `audit-failed`, and `support-disconnected`.

## Diagnostic Messages

### `diagnostics.request`

Payload:

```json
{
  "kind": "logs.tail",
  "since": "2026-05-10T17:55:00Z"
}
```

Rules:

- The plugin forwards the request to core.
- Core checks session, grant, allowlist, redaction, rate limit, and audit before data is returned.
- On failure, support receives `diagnostics.error` with a support-safe reason.

### `diagnostics.response`

Payload:

```json
{
  "kind": "logs.tail",
  "audit_id": "aud_read",
  "redacted": true,
  "summary": { "line_count": 120 },
  "payload": {}
}
```

## Live View Messages

### `live-view.frame`

Payload:

```json
{
  "audit_id": "aud_frame",
  "format": "image/webp",
  "width": 1280,
  "height": 720,
  "redacted": true,
  "data": "base64-frame-data"
}
```

Rules:

- Requires `app.live_view` grant.
- Frames are non-interactive screenshots of the Slopsmith app surface only.
- The protocol does not define input gesture messages for MVP.
- Desktop content outside the app surface must not be captured.

## Action Messages

### `action.request`

Payload:

```json
{
  "action": "diagnostics.export_bundle",
  "summary": "Export redacted diagnostic bundle for this session",
  "risk": "low",
  "payload": {},
  "effect_summary": "Creates a redacted bundle containing diagnostics and session audit."
}
```

Rules:

- Requires `actions.request` grant.
- Mutating actions require local approval.
- High-risk actions without clear effect summary are rejected before approval.
- Unverified identities require the local user to accept the extra warning before live view or action grants are enabled.

### `action.status`

Payload includes action id, status, audit id, and support-safe result summary.

## Error Messages

### `error`

Payload:

```json
{
  "code": "grant_denied",
  "message": "Requested diagnostic kind is not granted",
  "audit_id": "aud_denied"
}
```

## Forbidden Payloads

- Arbitrary HTTP requests.
- TCP forwarding.
- Shell commands.
- Raw filesystem reads.
- Desktop remote-control events.
- Unbounded log, console, or screenshot streams.