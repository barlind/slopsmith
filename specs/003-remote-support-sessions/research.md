# Phase 0 Research: Remote Support Sessions

## Decision: Keep core as the policy authority and plugin as the product experience

**Rationale**: The constitution requires generic user-facing extensions to live in plugins, while the RFC and spec make consent, grants, redaction, audit, and privileged reads non-delegable. A split design lets the bundled Remote Support plugin own Settings UI, pairing, dashboard, and relay transport, while core owns the trust boundary.

**Alternatives considered**:

- Put the entire feature in core: rejected because the Remote Support dashboard, relay, and Settings experience are plugin-shaped product surface.
- Let the plugin own privileged reads and audit: rejected because support plugins must not bypass core controls.
- Make relay policy authoritative: rejected because transport providers must remain replaceable and must not decide local access.

## Decision: Store support state under `CONFIG_DIR` as JSON/JSONL with in-memory active connection state

**Rationale**: Slopsmith is a single-user app with file-backed config and no new persistent database. Session summaries, policy settings, pending action requests, and audit entries fit naturally under `CONFIG_DIR/remote_support/`. Active sockets, timers, and relay state are runtime-only and should not be treated as durable truth.

**Alternatives considered**:

- New SQLite tables in `meta.db`: rejected because remote support audit/config is not CDLC metadata and does not need relational querying for MVP.
- Browser-only storage: rejected because audit, lifecycle, and action policy must survive page reloads and be available to backend diagnostic bundle export.
- Relay-hosted transcript as source of truth: rejected because the relay is not the policy authority and may be unavailable.

## Decision: Reuse existing diagnostics bundle preview/export and redaction primitives

**Rationale**: `diagnostics_bundle.py`, `diagnostics_redact.py`, `static/diagnostics.js`, and capability diagnostics already provide bounded, support-safe, AI-friendly data shapes. Remote support diagnostic reads should expose the same allowlisted shapes instead of creating a second diagnostics universe.

**Alternatives considered**:

- Stream raw logs and config files: rejected because it bypasses redaction and allowlisting.
- Add a separate remote-only diagnostics schema: rejected because it duplicates bundle behavior and creates more places for redaction mistakes.
- Let every plugin publish arbitrary remote diagnostics: rejected because plugin payloads must remain allowlisted, capped, and routed through core grants.

## Decision: Use an outbound typed support protocol with swappable relay adapters

**Rationale**: The spec explicitly forbids exposing raw localhost or unrestricted proxy traffic. A typed message protocol over an outbound connection keeps the relay small and replaceable while letting core validate every read and action. The plan should define protocol contracts and relay adapter expectations, not bind the product to one provider.

**Alternatives considered**:

- Generic tunnel or localhost sharing: rejected because it exposes surfaces remote support does not need.
- Relay-specific APIs throughout the plugin: rejected because managed, support-hosted, and local-only modes must share the same session contract.
- Local-only export only: rejected as insufficient for the remote support goal, but kept as the fallback and Phase 1 proof path.

## Decision: Fail closed when audit persistence fails

**Rationale**: The support safety model depends on every remote read/action being visible locally. If a required audit entry cannot persist, remote access must stop before unaudited access continues.

**Alternatives considered**:

- Continue with in-memory audit retry: rejected because the user cannot trust the post-session audit.
- Continue diagnostic reads only: rejected because read access is still remote access.
- Keep the session active with warning: rejected because warnings do not restore accountability.

## Decision: Permit one active support connection per session

**Rationale**: Single-party support keeps identity display, audit attribution, and approval prompts clear for the first implementation. The same verified or unverified party may reconnect before expiration so transient network failures do not force a new session.

**Alternatives considered**:

- Multiple fully authorized support participants: deferred because it adds per-participant grants and audit complexity.
- Primary plus observers: deferred because observer attribution and UI would complicate the MVP.
- Relay-defined participant policy: rejected because Slopsmith core must own local consent and audit semantics.

## Decision: Allow unverified support identity with extra warning for higher-risk grants

**Rationale**: Community support often cannot provide verified identity, so diagnostics-only sessions remain useful. Live view and action requests carry higher risk and require an extra local warning approval when identity is unverified.

**Alternatives considered**:

- Block all unverified remote sessions: rejected as too restrictive for community support.
- Allow all grants with normal consent: rejected because unverified live view/actions deserve stronger local awareness.
- Delegate identity rules to relay: rejected because relay trust varies by provider.

## Decision: Implement live view as non-interactive app-surface screenshots first

**Rationale**: Screenshot streaming answers the primary support question, "what state is the app in?", without granting remote input or desktop access. It also keeps testing simple: support can see app-surface images and cannot send gestures.

**Alternatives considered**:

- DOM/state snapshots only: useful, but less directly understandable than the visual state users describe.
- App-surface remote interaction: deferred because every input gesture introduces a remote-control consent problem.
- Full browser control: rejected for MVP because the spec calls out live view as separate from remote control.

## Decision: Reject high-risk actions that cannot explain their effect

**Rationale**: Local approval is meaningful only if the user can understand the effect. High-risk requests need a diff, exact effect, or equivalent impact summary before the approval prompt is shown.

**Alternatives considered**:

- Show a generic warning: rejected because it asks the user to approve an unknown change.
- Restrict this escape hatch to verified support: rejected because verified identity does not replace local comprehension.
- Convert automatically to manual recommendation: useful as a support dashboard behavior, but the remote action itself must be rejected.