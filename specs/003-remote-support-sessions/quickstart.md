# Quickstart: Remote Support Sessions

This guide describes the validation flow for implementing the plan.

## Prerequisites

- Work from the Slopsmith core app directory: `/Users/barlind/Code/barlind/ss/slopsmith`.
- Use the existing Python environment or create one compatible with the repository tests.
- Keep Remote Support disabled unless a local test explicitly starts a session.

## Focused Implementation Order

1. Add core remote support domain logic and CONFIG_DIR-backed audit/session store.
2. Add core support API routes as thin adapters over the domain logic.
3. Reuse diagnostics preview/export and redaction for support-safe reads.
4. Add the bundled `plugins/remote_support` plugin with Settings entry, local dashboard, support indicator, and idempotent runtime behavior.
5. Add relay protocol adapter and local-only fallback.
6. Add approved action request policy and local approval prompts.
7. Add non-interactive app-surface screenshot live view.

## Validation Commands

From `/Users/barlind/Code/barlind/ss/slopsmith`:

```bash
python3 -m pytest tests/test_remote_support.py tests/test_remote_support_diagnostics.py tests/test_remote_support_actions.py -q
python3 -m pytest tests/test_diagnostics_bundle.py tests/test_plugins.py tests/test_plugin_runtime_idempotence.py -q
node --check static/capabilities.js
node --check static/diagnostics.js
node --check static/app.js
node --check plugins/remote_support/screen.js
```

Run browser coverage when UI surfaces are implemented:

```bash
npx playwright test tests/browser/remote-support.spec.ts
```

## Manual Acceptance Flow

1. Open Settings and confirm Remote Support is present but inactive.
2. Start a diagnostics-only local session and confirm the consent screen lists redacted logs, plugins, health, browser console, settings summary, and optional live view/actions as disabled.
3. Open the local dashboard and confirm diagnostic panes use support-safe summaries.
4. Trigger a remote diagnostic read and confirm the persistent support indicator shows recent activity.
5. Revoke the session and confirm remote reads are rejected within the expected window.
6. Simulate audit persistence failure and confirm Slopsmith blocks the read/action, suspends or closes the session, and offers local-only diagnostic export.
7. Attempt a second viewer join and confirm it is rejected without disrupting the active connection.
8. Use an unverified support identity and confirm live view/action grants require an extra warning before activation.
9. Request a high-risk action without an effect summary and confirm it is rejected before approval.
10. Enable live view and confirm support sees only a non-interactive app-surface screenshot stream.

## Expected Diagnostic Bundle Additions

- Session audit summary after a session closes.
- Remote support plugin diagnostics under the plugin diagnostics section.
- Capability diagnostics including remote-support policy and recent support decisions.