# Data Model: Remote Support Sessions

## RemoteSupportSession

Represents one temporary support relationship approved by the local user.

**Fields**

- `id`: opaque local session identifier.
- `created_at`: UTC timestamp.
- `expires_at`: UTC timestamp; must be 15 to 60 minutes after creation unless extended within policy.
- `status`: `starting`, `pending-consent`, `active`, `suspended`, `revoked`, `expired`, `failed`, or `closed`.
- `mode`: `diagnostics`, `live-view`, or `approved-actions`.
- `connection_kind`: `managed-relay`, `support-hosted-relay`, or `local-only`.
- `connection_summary`: support-safe endpoint/code/provider summary, never raw secrets.
- `support_identity_id`: optional link to `SupportIdentity`.
- `active_grants`: list of `SupportGrant` values.
- `closure_reason`: optional reason for terminal states.
- `last_activity_at`: UTC timestamp for the last audited read/action/lifecycle event.

**Relationships**

- Has many `AuditEntry` records.
- Has zero or one active `SupportConnection`.
- Has many `SupportActionRequest` records.
- Has one `RelayConfiguration` snapshot.

**Validation Rules**

- Only one active support connection is allowed per active session.
- A session cannot become active until consent is recorded and an audit entry is persisted.
- Session state changes must persist audit before remote access continues.
- If audit persistence fails, the session transitions to `suspended` or `failed` before any remote read/action continues.

**State Transitions**

```text
starting -> pending-consent -> active -> revoked
starting -> pending-consent -> active -> expired
starting -> failed
active -> suspended -> revoked
active -> failed
active -> closed
```

## SupportConnection

Represents the currently connected support party for a session.

**Fields**

- `id`: connection identifier.
- `session_id`: parent `RemoteSupportSession`.
- `support_identity_id`: optional displayed identity.
- `connected_at`: UTC timestamp.
- `last_seen_at`: UTC timestamp.
- `reconnect_token_hash`: optional local-only hash for same-party reconnect.
- `verified`: boolean.

**Validation Rules**

- Additional support viewers are rejected while an active connection exists.
- Same-party reconnect is allowed before session expiration when the reconnect token matches and the old connection is no longer active.
- Rejected joins create audit entries.

## SupportIdentity

Represents the displayed remote party.

**Fields**

- `id`: local identity reference.
- `display_name`: support-safe name shown to the user.
- `kind`: `human`, `ai-agent`, `organization`, or `unknown`.
- `verified`: boolean.
- `verification_source`: optional support-safe relay/provider claim.

**Validation Rules**

- Unknown or unverified identities must be labeled as such.
- Live-view and action-request grants require an extra warning approval when identity is unverified.

## SupportGrant

Scoped permission active for one session.

**Values**

- `diagnostics.snapshot`
- `diagnostics.logs`
- `diagnostics.console`
- `diagnostics.plugins`
- `diagnostics.capabilities`
- `diagnostics.health`
- `diagnostics.bundle_preview`
- `diagnostics.bundle_export`
- `app.live_view`
- `actions.request`

**Validation Rules**

- Grants are session-scoped and expire with the session.
- Grants can be narrower than session mode.
- Remote support plugin eligibility does not imply grants.

## SupportDiagnosticRead

Represents a read request and its support-safe result summary.

**Fields**

- `id`: read request identifier.
- `session_id`: parent session.
- `requested_by`: `SupportIdentity` or connection reference.
- `kind`: `snapshot`, `logs.tail`, `console.snapshot`, `plugins.snapshot`, `capabilities.snapshot`, `health.check`, or `bundle.preview`.
- `grant_used`: support grant that authorized the read.
- `status`: `allowed`, `denied`, `rate-limited`, `failed`, or `audit-failed`.
- `summary`: support-safe result metadata.
- `created_at`: UTC timestamp.

**Validation Rules**

- A read cannot return payload data until audit persistence succeeds.
- Payload fields must be allowlisted and redacted before transport.
- Logs, console, and snapshots use bounded history and size limits.

## SupportActionRequest

Represents a typed action requested by support and decided locally.

**Fields**

- `id`: action request identifier.
- `session_id`: parent session.
- `requested_by`: support identity/connection reference.
- `action`: `app.restart`, `diagnostics.export_bundle`, `plugin.reload`, `plugin.disable_for_session`, `integration.test`, `config.patch`, or future allowlisted action.
- `summary`: user-readable request summary.
- `risk`: `low`, `medium`, or `high`.
- `payload_summary`: bounded, redacted summary.
- `effect_summary`: diff, exact effect, or equivalent impact summary when required.
- `status`: `requested`, `awaiting-approval`, `approved`, `denied`, `rejected`, `expired`, `running`, `completed`, `failed`, or `audit-failed`.
- `decision_at`: optional UTC timestamp.
- `result_summary`: optional support-safe result.

**Validation Rules**

- Actions require active session and `actions.request` grant.
- Mutating actions require explicit local approval.
- High-risk actions without `effect_summary` are rejected before approval.
- Capability owner policy and global deny rules must allow the action.
- Denied, rejected, failed, and completed actions are audited.

## AuditEntry

Local accountability record for support activity.

**Fields**

- `id`: audit identifier.
- `session_id`: parent session.
- `time`: UTC timestamp.
- `actor`: `local-user`, `support`, `core`, `plugin`, or `relay`.
- `actor_identity`: support-safe identity summary when known.
- `event`: lifecycle, read, join, action, approval, denial, failure, or close event type.
- `category`: affected diagnostic/action/session category.
- `outcome`: `allowed`, `denied`, `rejected`, `completed`, `failed`, `revoked`, `expired`, or `audit-failed`.
- `summary`: support-safe human-readable summary.
- `redaction_summary`: optional redaction counts or note.

**Validation Rules**

- Required audit entries must persist before remote reads/actions continue.
- Audit entries must avoid raw secrets, raw local file contents, and unrestricted filesystem details.
- Audit summaries are included in diagnostic bundle export after session close.

## RelayConfiguration

Captures the selected support path and policy restrictions.

**Fields**

- `kind`: `managed-relay`, `support-hosted-relay`, or `local-only`.
- `enabled`: boolean.
- `display_name`: user-visible provider label.
- `endpoint_summary`: support-safe endpoint label.
- `policy`: options for disabled remote relay, allowed provider list, and retention display.

**Validation Rules**

- `local-only` must remain available when remote relay is disabled or unavailable.
- Relay configuration cannot weaken consent, grants, redaction, approval, audit, or fail-closed behavior.

## RemoteSupportPolicy

Capability-level eligibility for remote support actions.

**Fields**

- `capability`: capability name.
- `command`: command name.
- `allow`: boolean.
- `approval`: `none` or `required`.
- `risk`: `low`, `medium`, or `high`.
- `effect_summary_required`: boolean.

**Validation Rules**

- Core global deny rules override capability policy.
- Runtime participant policy can narrow availability, not bypass core grants or approval.
- Policies are visible in capability diagnostics.

## SupportProtocolMessage

Typed relay message between support dashboard and local plugin.

**Fields**

- `schema`: `remote-support.message.v1`.
- `id`: message identifier.
- `session_id`: support session reference.
- `type`: typed message name.
- `sent_at`: UTC timestamp.
- `actor`: support-safe sender summary.
- `payload`: bounded object specific to the message type.

**Validation Rules**

- Messages never carry arbitrary HTTP/TCP traffic.
- Unknown message types are rejected and audited when associated with a session.
- Payloads are size-bounded before dispatch.