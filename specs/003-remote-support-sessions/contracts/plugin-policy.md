# Contract: Plugin Manifest and Capability Policy

Remote support participation is an eligibility declaration, not a privilege grant.

## Remote Support Plugin Manifest

```json
{
  "id": "remote_support",
  "name": "Remote Support",
  "standards": [
    "capability-pipelines.v1",
    "plugin-runtime-idempotent.v1",
    "remote-support.v1"
  ],
  "settings": { "html": "settings.html" },
  "script": "screen.js",
  "routes": "routes.py",
  "capabilities": {
    "remote-support": {
      "roles": ["requester", "provider"],
      "commands": ["start", "join", "stop", "inspect", "relay.connect", "relay.disconnect"],
      "events": ["session.started", "session.ended", "session.activity", "session.warning-required"]
    },
    "settings": {
      "roles": ["provider"],
      "commands": ["register-contribution", "mount", "unmount", "inspect"]
    },
    "diagnostics": {
      "roles": ["contributor"],
      "events": ["remote-support.session.summary"]
    }
  },
  "domains": {
    "backend.routes": { "legacy_source": "routes" },
    "diagnostics": [{ "id": "remote-support-session" }]
  }
}
```

## Capability Remote Support Policy

Capability owners can declare which commands are eligible during remote support.

```json
{
  "capabilities": {
    "plugins": {
      "roles": ["provider"],
      "commands": ["inspect", "reload", "disable-for-session"],
      "remote_support": {
        "inspect": { "allow": true, "approval": "none", "risk": "low" },
        "reload": { "allow": true, "approval": "required", "risk": "medium" },
        "disable-for-session": { "allow": true, "approval": "required", "risk": "medium" }
      }
    }
  }
}
```

## Runtime Participant Policy

Runtime participants may narrow command availability when state changes.

```js
window.slopsmith.capabilities.registerParticipant("example", {
  plugins: {
    roles: ["provider"],
    commands: ["inspect", "reload"],
    remoteSupport: {
      inspect: { allow: true, approval: "none", risk: "low" },
      reload: { allow: false }
    }
  }
});
```

## Core Decision Order

1. Verify active session and required grant.
2. Verify support identity warning acceptance if identity is unverified and grant is live view or actions.
3. Verify capability owner remote-support policy.
4. Apply global deny rules.
5. Reject high-risk actions without a clear effect summary.
6. Prompt the local user when approval is required.
7. Dispatch through the normal capability command path.
8. Redact result payload.
9. Persist audit before delivering result to support.

## Diagnostics Requirements

- Capability diagnostics expose declared remote-support policies and runtime narrowing.
- Remote support diagnostics expose active session id, status, grants, relay state, recent decisions, and unavailable providers using support-safe summaries.
- Repeated plugin script evaluation must not duplicate participants, timers, relay handlers, indicators, or diagnostics contributors.