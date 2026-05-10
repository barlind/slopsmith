# Feature Specification: Remote Support Sessions

**Feature Branch**: `003-remote-support-sessions`
**Created**: 2026-05-10
**Status**: Draft
**Input**: User description: "Create a spec based on RFC 0001: Remote Support Sessions"

## Clarifications

### Session 2026-05-10

- Q: If the local audit trail cannot persist a required audit entry, how should Slopsmith handle the active support session? → A: Fail closed: block the read/action, close or suspend the session, and offer local-only diagnostic export.
- Q: How should Slopsmith handle multiple support viewers attempting to join the same active session? → A: Allow one active support connection; reject additional viewers while active, but allow the same support party to reconnect.
- Q: What permissions should Slopsmith allow when the connected support identity cannot be verified? → A: Unverified identity sessions may use live view or action requests only after the local user approves an extra warning.
- Q: What is the minimum live app view capability Slopsmith should support for this feature? → A: Non-interactive screenshot stream of the Slopsmith app surface only.
- Q: How should Slopsmith handle a high-risk action request when it cannot generate a clear diff or exact effect summary for local approval? → A: Reject the high-risk action until Slopsmith can show a clear diff, exact effect, or equivalent impact summary.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start a Read-Only Support Session (Priority: P1)

A Slopsmith user who is asking for help can open Remote Support from Settings, enter a support-provided code or create a shareable session code, review exactly what diagnostic categories will be shared, and start a temporary diagnostics-only session.

**Why this priority**: This delivers the safest useful MVP by replacing manual log, screenshot, environment, plugin, and console gathering with one consented flow while preventing remote mutation.

**Independent Test**: Can be fully tested by starting Remote Support from Settings, approving diagnostics-only sharing, connecting a support viewer, and confirming that support sees only redacted diagnostic information.

**Acceptance Scenarios**:

1. **Given** Remote Support is disabled and the user has a valid support code, **When** the user opens Settings, enters the code, reviews the sharing summary, and chooses diagnostics-only mode, **Then** Slopsmith creates an active temporary session and the support side can view support-safe diagnostics.
2. **Given** a user wants community support and no support-provided code exists, **When** the user chooses to create a support session, **Then** Slopsmith produces a short-lived code or URL that can be shared with support.
3. **Given** the user reviews the consent screen, **When** the screen lists shared categories, **Then** it includes redacted logs, plugin list and versions, runtime health, browser console entries, support-safe settings summary, and clearly identifies any optional live app view as disabled unless separately selected.

---

### User Story 2 - Inspect Support-Safe App State Remotely (Priority: P1)

A human support person or AI support agent can open the remote dashboard for an active session and inspect the current health summary, plugin status, recent failures, logs, browser console entries, capability diagnostics, and diagnostic bundle preview without asking the user to manually export files.

**Why this priority**: Remote diagnostics are the central value of the feature and must work before live view or action requests are useful.

**Independent Test**: Can be tested by connecting a support dashboard to an active diagnostics-only session and verifying each diagnostic pane updates with redacted, bounded, support-safe information.

**Acceptance Scenarios**:

1. **Given** an active diagnostics-only support session, **When** support opens the dashboard, **Then** the dashboard shows the Slopsmith version, runtime summary, plugin load status, orphaned plugins, health checks, recent server log entries, browser console entries, capability diagnostics, and diagnostic bundle preview.
2. **Given** sensitive values exist in logs or settings, **When** support views diagnostics, **Then** secrets, raw local file contents, unrestricted filesystem details, and unsupported diagnostic fields are not exposed.
3. **Given** the support side is an AI support agent, **When** it inspects the dashboard, **Then** it receives the same support-safe evidence available to human support and no privileged backdoor data.

---

### User Story 3 - Maintain Local Visibility and Control (Priority: P1)

While a session is active, the local user sees a persistent support indicator that shows who is connected when known, the session mode, session age, expiration time, recent activity, and a one-click revoke control.

**Why this priority**: Remote support is a trust-boundary feature, so the user must never lose awareness or control once sharing begins.

**Independent Test**: Can be tested by starting a session, observing the local indicator during remote reads, revoking the session, and confirming remote access ends quickly.

**Acceptance Scenarios**:

1. **Given** a support session is active, **When** support reads diagnostics, **Then** the local indicator remains visible and the recent activity list reflects the read.
2. **Given** the user selects revoke, **When** the revoke action is confirmed, **Then** all remote access for that session ends and support sees the session as closed.
3. **Given** a session reaches its expiration time, the app exits, the relay fails, or support disconnects, **When** the session closes, **Then** Slopsmith updates the local state and records the closure reason.

---

### User Story 4 - Request User-Approved Support Actions (Priority: P2)

When diagnostics indicate a likely fix, support can request a typed action such as exporting a diagnostic bundle, rerunning health checks, restarting the backend, reloading plugins, testing an integration, or applying a proposed configuration change, and the local user can approve or deny it after seeing the purpose and risk.

**Why this priority**: Approved actions reduce back-and-forth after diagnostics work, but they must remain secondary to the read-only foundation.

**Independent Test**: Can be tested by submitting both low-risk and mutating action requests from the support dashboard and confirming that only eligible, granted, approved actions run.

**Acceptance Scenarios**:

1. **Given** an active session with action requests enabled, **When** support requests a plugin reload, **Then** Slopsmith shows the action summary, requester, risk, expected effect, and approval controls before the action can run.
2. **Given** the user denies an action request, **When** support checks the dashboard, **Then** the action remains denied, no mutation occurs, and the denial is audited.
3. **Given** support requests an action that is not allowed by the active session, the affected capability owner, or global safety policy, **When** the request is evaluated, **Then** Slopsmith rejects the request and records the rejection.

---

### User Story 5 - Use Local-Only and Policy-Restricted Support Paths (Priority: P3)

A cautious user or organization can avoid remote connectivity while still using the same local diagnostic dashboard and bundle export flow, and administrators can restrict whether remote relay sessions are allowed.

**Why this priority**: The feature must remain optional and useful even when relay access is unavailable or prohibited.

**Independent Test**: Can be tested by disabling remote relay use, opening Remote Support, and verifying that local dashboard and diagnostic bundle export remain available while remote session creation is blocked or hidden.

**Acceptance Scenarios**:

1. **Given** remote relay use is disabled by policy, **When** the user opens Remote Support, **Then** Slopsmith offers local diagnostics and bundle export without creating a remote session.
2. **Given** relay setup fails, **When** the user tries to start a remote support session, **Then** Slopsmith explains the failure, closes any partial session safely, and offers local-only diagnostic export.
3. **Given** an organization requires a self-controlled support relay, **When** Remote Support is configured, **Then** sessions can use that approved relay option without changing the user consent, grants, redaction, or audit behavior.

### Edge Cases

- Session codes or URLs are expired, malformed, already used, or belong to a different relay.
- The remote party disconnects and reconnects before the session expires.
- The relay becomes unreachable during a diagnostic read or pending action request.
- The support identity is unknown or cannot be verified; diagnostics may proceed with normal consent, but live view or action requests require an extra local warning approval.
- The user closes Slopsmith while a session is active or while an approval prompt is pending.
- Diagnostic data contains secrets, tokens, local paths, personal information, or plugin-provided fields that are not explicitly allowed for support sharing.
- A plugin declares remote support participation but is not currently loaded, fails to initialize, or is orphaned.
- Multiple support viewers attempt to join the same session; Slopsmith allows one active support connection, rejects additional viewers while active, and allows the same support party to reconnect before expiration.
- Support requests actions in diagnostics-only or live-view-only mode.
- High-risk configuration changes have large diffs or effects that cannot be summarized safely; Slopsmith rejects the action request until it can show a clear diff, exact effect, or equivalent impact summary.
- The local audit store is unavailable, full, or cannot persist a required entry; Slopsmith fails closed by blocking the remote read or action, closing or suspending the session, and offering local-only diagnostic export.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Slopsmith MUST provide a Remote Support entry point from Settings.
- **FR-002**: Users MUST be able to create a short-lived support session code or URL for user-initiated support.
- **FR-003**: Users MUST be able to join a support-initiated session by entering a short-lived code or opening a session link.
- **FR-004**: Slopsmith MUST show a consent screen before any remote session becomes active.
- **FR-005**: The consent screen MUST list the categories of information that will be shared and distinguish required diagnostics from optional live app view or action-request access.
- **FR-006**: Slopsmith MUST support separate session modes for view-only diagnostics, live app view, and action requests with user approval.
- **FR-007**: View-only diagnostics mode MUST prevent remote mutation, remote control, and action execution.
- **FR-008**: Sessions MUST have a short expiration time selected from an allowed range of 15 to 60 minutes, with a 30-minute default.
- **FR-009**: Users MUST be able to revoke an active support session with one local action.
- **FR-010**: Slopsmith MUST display a persistent local support indicator while any remote support session is active.
- **FR-011**: The support indicator MUST show connected identity when known, session mode, session age, expiration time, revoke control, and recent activity.
- **FR-012**: User installs MUST connect outward to an approved support relay or support-hosted endpoint and MUST NOT expose raw localhost services, unrestricted local endpoints, or inbound public access as the primary support mechanism.
- **FR-013**: Remote support transport MUST carry typed support messages and MUST NOT provide arbitrary shell access, unrestricted traffic proxying, or raw desktop access.
- **FR-014**: The support relay or transport provider MUST NOT be able to override local consent, grants, redaction, action approval, or audit policy.
- **FR-015**: Slopsmith MUST provide a local-only fallback that can show the same support-safe diagnostics and export a diagnostic bundle without creating a remote session.
- **FR-016**: The remote support dashboard MUST show health summary, Slopsmith version and runtime summary, plugin load status, orphaned plugins, recent server log entries, browser console entries, capability diagnostics, client and backend hardware summaries, support-safe settings summary, and diagnostic bundle preview when covered by active grants.
- **FR-017**: Diagnostic reads MUST use allowlisted support-safe fields and the same redaction rules used for diagnostic bundle export.
- **FR-018**: Slopsmith MUST block raw secret reads, arbitrary filesystem reads, unsupported diagnostic fields, and unredacted local file contents from leaving the machine through remote support.
- **FR-019**: Every remote read MUST create a local audit entry that includes session, time, requester when known, category requested, grant used, and outcome.
- **FR-020**: Every session lifecycle event MUST create a local audit entry, including creation, activation, expiration, revocation, failure, support disconnect, and app exit closure.
- **FR-021**: Support action requests MUST be typed, allowlisted, and include requester, summary, risk level, requested effect, and bounded payload summary.
- **FR-022**: Read-only actions MAY run without a separate approval prompt only when they are covered by the active session grants and support policy.
- **FR-023**: Mutating actions, actions touching local files, and actions changing configuration MUST require explicit local user approval.
- **FR-024**: High-risk action requests MUST show a diff, exact effect, or equivalent user-understandable impact summary before approval, and MUST be rejected when Slopsmith cannot generate that summary.
- **FR-025**: Denied, expired, rejected, failed, and approved action requests MUST all be recorded in the local audit trail.
- **FR-026**: Capability owners MAY declare which support actions are eligible, but Slopsmith core MUST remain the final authority for active grants, global safety rules, user approval, dispatch eligibility, and auditing.
- **FR-027**: A plugin declaring remote support participation MUST NOT receive privileged access unless the local user grants an active session and core policy authorizes the specific read or action.
- **FR-028**: Live app view MUST require a separate explicit grant and MUST provide a non-interactive screenshot stream scoped to the Slopsmith app surface rather than the desktop environment.
- **FR-029**: Slopsmith MUST end sessions when the user revokes access, the TTL expires, the app exits, the relay fails, or support explicitly disconnects.
- **FR-030**: After a session closes, users MUST be able to view an audit summary and export a diagnostic bundle that includes the session audit.
- **FR-031**: Organizations or advanced users MUST be able to disable remote relay sessions while preserving local diagnostic export.
- **FR-032**: Remote support MUST apply bounded history and rate limits for logs, console entries, snapshots, and repeated reads to preserve local performance and reduce accidental data exposure.
- **FR-033**: If Slopsmith cannot persist a required audit entry, it MUST fail closed by blocking the remote read or action, closing or suspending the active support session, and offering local-only diagnostic export.
- **FR-034**: A support session MUST allow only one active support connection at a time, MUST reject additional support viewers while one is active, and MAY allow the same support party to reconnect before the session expires.
- **FR-035**: When the connected support identity cannot be verified, Slopsmith MUST label the identity as unverified and MUST require an extra local warning approval before enabling live app view or action requests.

### Key Entities *(include if feature involves data)*

- **Remote Support Session**: A temporary consented support relationship with an identifier, created time, expiration time, mode, status, connection summary, grants, and closure reason.
- **Support Grant**: A scoped permission that allows a specific class of diagnostic read, live app view, or action request during one active session.
- **Support Diagnostic Snapshot**: A redacted, bounded view of logs, console entries, plugin state, capability diagnostics, health checks, runtime summaries, settings summaries, and bundle preview data.
- **Support Action Request**: A typed support request with requester, action type, summary, risk, expected effect, payload summary, approval state, result, and audit linkage.
- **Audit Entry**: A local record of session lifecycle, remote reads, action requests, approvals, denials, failures, and session closure details.
- **Support Identity**: The displayed identity of the connected human support person, organization, or AI support agent when the relay or support workflow can verify it.
- **Relay Configuration**: The selected managed, support-hosted, or local-only support path, including policy restrictions and user-visible connection details.

### Capability Pipelines *(mandatory for plugin interoperability)*

- **Capabilities Affected**: settings, diagnostics, support-session lifecycle, support-audit, app live view, action requests, plugin lifecycle, integration health, capability diagnostics, diagnostic bundle export.
- **Owners/Providers**: Slopsmith core owns consent, grants, redaction, audit, lifecycle state, safety policy, approval prompts, and privileged reads. The remote support plugin owns Settings experience, support dashboard experience, relay configuration, support pairing, and typed support message exchange. Existing diagnostic and capability owners provide support-safe summaries through core-controlled grants.
- **Participants**: The remote support plugin requests session lifecycle changes, observes session activity, presents the local and remote experiences, and transports typed support messages. Core handles grant checks, redaction, approval, dispatch, and audit. Diagnostic contributors provide allowlisted read models. Capability owners declare eligible support actions. Human support viewers and AI support agents consume the same support-safe dashboard and may request eligible actions.
- **Events**: Session started, session activated, session activity recorded, session expiring, session ended, diagnostics read requested, diagnostics read completed, action requested, action approved, action denied, action completed, and action failed. Event payloads include session identifier, time, requester when known, mode, affected diagnostic or action category, support-safe summary, and outcome.
- **Commands**: Start session, join session, revoke session, inspect session, extend session within the allowed TTL range, list audit entries, request diagnostic snapshot, request log or console snapshot, request plugin or capability snapshot, request health check, request diagnostic bundle export, request approved action, approve action, deny action, and inspect action status. Commands return support-safe summaries and explicit success, denial, expiration, or failure states.
- **Ordering**: Diagnostic reads are evaluated by active session status, grant coverage, read allowlist, redaction, rate limits, transport delivery, and audit recording. Action requests are evaluated by active session status, action-request grant, capability owner policy, global safety rules, user approval requirement, dispatch eligibility, result handling, returned support-safe payload, and audit recording.
- **User Override Policy**: Local user revoke, denial, session close, and policy restrictions override remote support requests. User-initiated actions outside remote support are not silently converted into remote approvals. Remote action approval applies only to the specific request shown to the user.
- **Compatibility Behavior**: If optional plugins, diagnostic contributors, capability owners, or live view providers are absent, the dashboard shows the unavailable category without failing the whole session. If relay connectivity is unavailable or disabled, local-only diagnostics and bundle export remain available.
- **Runtime Lifecycle**: Remote support plugin scripts and dashboard surfaces must be rehydratable. Re-running plugin code in the same renderer session must not duplicate session indicators, event listeners, timers, diagnostics contributors, relay handlers, action prompts, or capability participants.
- **Standard Declarations**: The remote support plugin declares capability pipeline support, idempotent plugin runtime support, and remote support participation. Core treats remote support participation as a privileged eligibility signal, not as automatic access, and validates behavior through session grant checks, audit records, and repeated-load regression coverage.
- **Diagnostics**: Capability diagnostics expose active remote support session state, active grants, last redacted reads, recent action decisions, relay status, unavailable diagnostic contributors, and plugin participation status using support-safe summaries.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 90% of users can create or join a diagnostics-only support session from Settings in under 2 minutes during usability testing.
- **SC-002**: Support can view health summary, plugin status, recent logs, console entries, and capability diagnostics for an active diagnostics-only session within 30 seconds of user approval.
- **SC-003**: 100% of remote reads and support action requests produce local audit entries visible to the user within 5 seconds.
- **SC-004**: In security validation, 100% of seeded secrets, unsupported diagnostic fields, and raw local file contents are absent from remote support diagnostic views.
- **SC-005**: Users can revoke an active session with one local action, and remote access ends within 10 seconds in 99% of tested revocations.
- **SC-006**: View-only diagnostics mode blocks 100% of mutating action requests, remote control attempts, and ungranted live view attempts in acceptance testing.
- **SC-007**: Sessions expire automatically at or before the configured expiration time in 100% of tested sessions.
- **SC-008**: At least 80% of support investigations for seeded plugin load, route, health, or console failures can identify the likely failing area without asking the user for additional files.
- **SC-009**: Local-only fallback allows diagnostic bundle export and local dashboard review in under 2 minutes when remote relay access is unavailable or disabled.
- **SC-010**: In 100% of audit persistence failure tests, Slopsmith blocks the remote read or action and closes or suspends the support session before any unaudited access continues.
- **SC-011**: In 100% of multiple-viewer tests, Slopsmith rejects additional active support viewers and records the rejected join attempt without disrupting the existing allowed support connection.
- **SC-012**: In 100% of unverified-identity tests, live app view and action-request grants remain disabled until the local user accepts the additional warning.
- **SC-013**: In 100% of live-view tests, support can inspect a non-interactive screenshot stream of the Slopsmith app surface and cannot send input gestures or view desktop content outside the app surface.
- **SC-014**: In 100% of high-risk action tests without a clear diff, exact effect, or equivalent impact summary, Slopsmith rejects the action request before presenting it for approval.

## Assumptions

- Remote Support is bundled as a supported Slopsmith experience but remains disabled until the local user enables or joins a session.
- Diagnostics-only is the default and first production mode; live app view and approved actions require separate explicit grants, and live app view starts as a non-interactive app-surface screenshot stream.
- The default session TTL is 30 minutes, with product policy allowing values from 15 to 60 minutes.
- Support identity is displayed when it can be verified by the configured support workflow; otherwise the session clearly labels the connected party as unverified or unknown and requires an additional warning before higher-risk grants.
- Audit summaries are retained locally for at least 30 days unless the user or organization clears them earlier by policy.
- Local-only diagnostic dashboard and bundle export are available even when remote relay support is unavailable, disabled, or not configured.
- The first implementation proves read-only diagnostics before enabling live app view or mutating actions.
- Remote support never includes arbitrary shell access, raw desktop sharing, or unrestricted local service exposure.