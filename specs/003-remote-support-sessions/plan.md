# Implementation Plan: Remote Support Sessions

**Branch**: `003-remote-support-sessions` | **Date**: 2026-05-10 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/003-remote-support-sessions/spec.md`

**Setup Note**: The Spec Kit setup script resolved this feature directory from `.specify/feature.json`, but reported the current top-level git branch as `002-configuration-profiles`. The feature artifacts remain under `specs/003-remote-support-sessions/` and the spec declares `003-remote-support-sessions`.

## Summary

Implement temporary Remote Support Sessions as a bundled support plugin backed by a narrow core trust boundary. Core owns session lifecycle, consent, grants, redaction, audit persistence, diagnostic reads, and approved-action policy; the plugin owns Settings entry points, local/remote dashboard UX, pairing, and relay transport. The first deliverable proves diagnostics-only and local-only support using existing diagnostic bundle, console, plugin, and capability diagnostics surfaces, then layers in outbound typed relay transport, approved actions, and non-interactive app-surface live view.

## Technical Context

**Language/Version**: Python 3 backend; vanilla browser JavaScript using existing ES2020-style patterns
**Primary Dependencies**: FastAPI route registration, existing plugin loader, `window.slopsmith` EventTarget namespace, `window.slopsmith.capabilities`, `window.slopsmith.diagnostics`, stdlib logging, existing diagnostic bundle/redaction helpers, WebSocket-capable transport adapter
**Storage**: File-backed JSON/JSONL state under `CONFIG_DIR` for session summaries, audit entries, relay policy, and pending action requests; in-memory registry for active connection state; browser `localStorage` only for plugin UI preferences
**Testing**: pytest/FastAPI TestClient for core services and routes, existing diagnostics and plugin tests, JavaScript syntax checks with Node, Playwright browser checks for Settings consent, support indicator, local dashboard, revoke, and approval prompts
**Target Platform**: Slopsmith self-hosted Docker runtime, local browser, and desktop wrapper environments
**Project Type**: Single-user web app with plugin extension surface
**Performance Goals**: Support diagnostics dashboard visible within 30 seconds after approval; audit entries visible within 5 seconds; revoke ends remote access within 10 seconds in normal network conditions; bounded diagnostics reads keep console/log/snapshot payloads under existing caps or stricter support-specific caps
**Constraints**: No user account model or core auth middleware; no arbitrary shell; no raw desktop access; no inbound public localhost exposure; no frontend framework or build step in core; no new persistent database; no new mandatory path or environment variable; redaction before data leaves the machine; fail closed when required audit persistence fails
**Scale/Scope**: Single local user, one active support connection per session, 15 to 60 minute TTL with a 30 minute default, diagnostics-only MVP, live view as non-interactive app-surface screenshots, approved actions as typed allowlisted requests

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Capability Pipeline Gate**: PASS. Affected capabilities are `settings`, `diagnostics`, `support-session`, `support-audit`, `support-actions`, `app.live-view`, `plugins`, `integration-health`, `configuration-sources`, `profiles`, and `settings-packs`. Core is owner/provider for policy, redaction, audit, lifecycle, approval, and privileged reads. The remote support plugin is requester/provider for UX, pairing, relay, and dashboard. Capability owners may declare remote-support policy for action eligibility, but core remains final authority.
- **Ordering and Short-Circuit Gate**: PASS. Diagnostic reads resolve in this order: active session, grant coverage, field allowlist, redaction, rate limit, audit persistence, response delivery. Action requests resolve in this order: active session, `actions.request` grant, support identity warning if unverified, capability owner policy, global deny rules, high-risk summary availability, user approval, dispatch through capability command path, result redaction, audit persistence. Any failed gate short-circuits with a denied/rejected/audit-failed outcome and no remote data or mutation.
- **User Intent Gate**: PASS. User-originated actions are session start/join, consent, grant selection, revoke, approve, deny, extend, local-only export, and policy toggles. Remote/support-originated actions are diagnostic reads and typed action requests. Local revoke, denial, session expiry, audit failure, and policy restrictions override all remote requests. Automation does not persist user approval beyond the specific request shown.
- **UI Capability Gate**: PASS. The feature contributes a Settings Remote Support panel, persistent support indicator, local dashboard, approval prompts, post-session audit summary, and plugin remote dashboard. These are additive and reversible; they do not replace player layout regions. Plugin UI registration uses existing Settings/screen contribution patterns and must unmount idempotently on repeated plugin loading.
- **Compatibility and Diagnostics Gate**: PASS. Missing optional diagnostic contributors, live view provider, relay adapter, or capability owners degrade that pane/action to unavailable without failing the session. Capability diagnostics expose active support session state, grants, relay state, last decisions, unavailable providers, and recent audit/action outcomes using support-safe summaries.
- **Runtime Lifecycle Gate**: PASS. The remote support plugin must be rehydratable: repeated `screen.js` evaluation cannot duplicate DOM roots, support indicators, event listeners, timers, relay handlers, diagnostics contributors, pending approval prompts, or capability participants. The plugin declares `capability-pipelines.v1`, `plugin-runtime-idempotent.v1`, and `remote-support.v1`; tests cover repeated load and core-visible self-declaration.
- **Testability Gate**: PASS. Each user story has independent scenarios in the spec. Planned tests cover provider/requester grants, diagnostic pass-through, audit-failure short-circuit, multiple-viewer rejection, unverified-identity warning, high-risk action summary rejection, user revoke, and local-only fallback.

## Project Structure

### Documentation (this feature)

```text
specs/003-remote-support-sessions/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── remote-support-api.md
│   ├── support-protocol.md
│   └── plugin-policy.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
slopsmith/
├── lib/
│   ├── remote_support.py              # session, grant, action, audit domain logic
│   ├── remote_support_store.py        # CONFIG_DIR-backed JSON/JSONL persistence
│   └── remote_support_protocol.py     # typed support message validation helpers
├── server.py                          # thin FastAPI route registration for core support APIs
├── plugins/
│   └── remote_support/
│       ├── plugin.json
│       ├── routes.py                  # relay/pairing adapter and plugin-owned dashboard routes
│       ├── settings.html
│       └── screen.js                  # Settings panel, indicator, local dashboard, relay client
├── static/
│   ├── app.js                         # mount core-visible support indicator/settings entry if needed
│   ├── capabilities.js                # remote-support policy surface and diagnostics snapshot additions
│   └── diagnostics.js                 # live-view/client diagnostics snapshot helpers if needed
└── tests/
    ├── test_remote_support.py
    ├── test_remote_support_diagnostics.py
    ├── test_remote_support_actions.py
    ├── test_diagnostics_bundle.py
    ├── test_plugins.py
    └── test_plugin_runtime_idempotence.py
```

**Structure Decision**: Keep risky policy and persistence in core `lib/` plus thin FastAPI adapters, while placing user-facing Remote Support workflow and relay transport in the bundled `plugins/remote_support/` plugin. This follows the constitution: generic support product experience is plugin-owned, but privileged reads/actions stay in core.

## Phase 0: Research Summary

Research decisions are captured in [research.md](research.md). No unresolved `NEEDS CLARIFICATION` items remain.

## Phase 1: Design Summary

Design artifacts are captured in [data-model.md](data-model.md), [contracts/remote-support-api.md](contracts/remote-support-api.md), [contracts/support-protocol.md](contracts/support-protocol.md), [contracts/plugin-policy.md](contracts/plugin-policy.md), and [quickstart.md](quickstart.md).

## Post-Design Constitution Check

- **Capability Pipeline Gate**: PASS. Contracts define core-owned support APIs, typed support protocol messages, and plugin/capability remote-support policy declarations.
- **Ordering and Short-Circuit Gate**: PASS. Data model and contracts define session/grant/audit/action state transitions and explicit short-circuit outcomes for denial, audit failure, policy failure, missing summaries, and unavailable providers.
- **User Intent Gate**: PASS. Approval, deny, revoke, local-only fallback, and unverified-identity warning flows remain local-user controlled.
- **UI Capability Gate**: PASS. Quickstart and contracts keep UI additive: Settings entry, support indicator, local dashboard, approval prompt, and audit summary.
- **Compatibility and Diagnostics Gate**: PASS. Contracts include unavailable-provider behavior and support-safe diagnostic snapshots. No optional plugin absence blocks the diagnostics-only session.
- **Runtime Lifecycle Gate**: PASS. Plugin policy and quickstart require idempotent manifest declarations and repeated-load tests.
- **Testability Gate**: PASS. Quickstart lists focused pytest, syntax, and Playwright validation for each risky behavior.

## Complexity Tracking

No constitutional violations or justified complexity exceptions are required.