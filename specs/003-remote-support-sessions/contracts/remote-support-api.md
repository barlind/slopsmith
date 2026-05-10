# Contract: Core Remote Support API

This contract describes the core-owned local API that the bundled Remote Support plugin can call. Names are planned route shapes; implementation may register them in `server.py` or a route module, but policy decisions stay in core.

## Common Rules

- All responses are JSON except diagnostic bundle export.
- Every successful remote read/action response must correspond to a persisted audit entry.
- If audit persistence fails, the API returns `audit_failed`, blocks the read/action, and suspends or closes the session.
- Remote callers never receive raw filesystem access, raw shell access, unrestricted local HTTP proxying, or unredacted secret fields.
- Error response shape:

```json
{
  "ok": false,
  "error": {
    "code": "grant_denied",
    "message": "diagnostics.logs grant is not active",
    "audit_id": "aud_123"
  }
}
```

## Session Lifecycle

### `POST /api/support/sessions`

Create a local session draft after user consent.

Request:

```json
{
  "mode": "diagnostics",
  "ttl_minutes": 30,
  "connection_kind": "managed-relay",
  "requested_grants": ["diagnostics.snapshot", "diagnostics.logs"],
  "support_identity": {
    "display_name": "Community helper",
    "kind": "human",
    "verified": false
  }
}
```

Response:

```json
{
  "ok": true,
  "session": {
    "id": "rs_abc123",
    "status": "active",
    "mode": "diagnostics",
    "expires_at": "2026-05-10T18:30:00Z",
    "grants": ["diagnostics.snapshot", "diagnostics.logs"],
    "connection": { "kind": "managed-relay", "pairing_code": "842193" }
  },
  "audit_id": "aud_create"
}
```

### `POST /api/support/sessions/join`

Join a support-initiated code or link after local consent.

Request:

```json
{
  "code_or_url": "842193",
  "mode": "diagnostics",
  "requested_grants": ["diagnostics.snapshot", "diagnostics.console"],
  "accepted_unverified_identity_warning": false
}
```

### `GET /api/support/sessions`

List local support session summaries, newest first.

### `GET /api/support/sessions/{session_id}`

Inspect one session summary, active grants, connection status, and last activity.

### `POST /api/support/sessions/{session_id}/revoke`

Revoke a session locally. Must end remote access before returning success.

### `POST /api/support/sessions/{session_id}/extend`

Extend within the allowed 15 to 60 minute range after local user confirmation.

## Diagnostic Reads

### `GET /api/support/sessions/{session_id}/diagnostics/snapshot`

Returns a redacted support-safe aggregate of allowed diagnostics.

Query parameters:

- `kind`: `summary`, `logs.tail`, `console.snapshot`, `plugins.snapshot`, `capabilities.snapshot`, `health.check`, or `bundle.preview`.

Response:

```json
{
  "ok": true,
  "audit_id": "aud_read",
  "snapshot": {
    "schema": "remote-support.diagnostics.snapshot.v1",
    "kind": "plugins.snapshot",
    "redacted": true,
    "summary": { "loaded_count": 12, "orphan_count": 1 },
    "payload": {}
  }
}
```

### `POST /api/support/sessions/{session_id}/diagnostics/bundle-preview`

Returns the same support-safe preview tree used by Settings diagnostics export, filtered by active grants.

### `POST /api/support/sessions/{session_id}/diagnostics/export-bundle`

Creates a diagnostic bundle only when covered by grants and policy. If remote delivery is requested, the returned payload is still redacted and audited.

## Action Requests

### `POST /api/support/sessions/{session_id}/actions`

Create a typed action request from support.

Request:

```json
{
  "action": "plugin.reload",
  "summary": "Reload plugin list to recover a missing route",
  "risk": "medium",
  "payload": { "plugin_id": "sloppak_converter" },
  "effect_summary": "Reloads plugin metadata and route registration; does not modify DLC files."
}
```

Response status values:

- `awaiting-approval`: request is eligible and shown locally.
- `rejected`: policy, grant, summary, identity, or global deny rules rejected it before approval.
- `denied`: local user denied it.
- `audit_failed`: audit persistence failed and the session was suspended/closed.

### `POST /api/support/actions/{action_id}/approve`

Local-only approval endpoint. Executes only the exact request shown to the user.

### `POST /api/support/actions/{action_id}/deny`

Local-only denial endpoint. Records denial and does not mutate state.

### `GET /api/support/actions/{action_id}`

Inspect support-safe status and result summary.

## Audit

### `GET /api/support/sessions/{session_id}/audit`

Returns local audit entries for the session.

### `GET /api/support/audit`

Returns recent audit summaries across sessions for Settings and diagnostic bundle inclusion.

## Policy Settings

### `GET /api/support/policy`

Returns relay enablement, allowed provider labels, local-only availability, and retention summary.

### `POST /api/support/policy`

Updates advanced/user policy such as disabling remote relay sessions. Must not create a new mandatory environment variable.