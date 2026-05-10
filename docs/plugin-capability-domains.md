# Plugin Capability Domains

Plugins should declare the runtime surfaces they use in `plugin.json`. The declarations let profiles, diagnostics, and support tools reason about plugin behavior without relying on private globals.

## Standards

Migrated plugins should declare standards explicitly:

```json
{
  "standards": ["capability-pipelines.v1", "plugin-runtime-idempotent.v1", "profiles.v1", "settings-packs.v1"]
}
```

Only declare `plugin-runtime-idempotent.v1` when repeated script hydration cannot duplicate wrappers, listeners, timers, DOM roots, diagnostics contributors, jobs, media nodes, or capability participants.

## UI Contributions

Legacy fields still work, but new or migrated plugins should declare UI placement:

```json
{
  "ui": {
    "ui.navigation": [{ "id": "my-plugin-nav", "region": "plugins", "label": "My Plugin" }],
    "ui.plugin-screens": [{ "id": "my-plugin-screen", "region": "plugin-screens", "label": "My Plugin" }],
    "settings": [{ "id": "my-plugin-settings", "region": "plugin-settings", "label": "My Plugin" }]
  }
}
```

Core registers legacy `nav`, `screen`, `settings`, and visualization `type` fields as compatibility UI contributions during plugin hydration. The compatibility path is deterministic and unmounts previous contributions before registering the next hydrated state.

## Runtime Domains

Declare non-UI runtime surfaces under `domains` or `runtime_domains`:

```json
{
  "domains": {
    "backend.routes": { "legacy_source": "routes" },
    "jobs": [{ "id": "refresh-index" }],
    "midi-control": { "role": "observer" },
    "audio-input": { "role": "provider" },
    "note-detection": { "role": "requester" },
    "tempo-clock": { "role": "observer" }
  }
}
```

If a plugin still uses `routes`, diagnostics expose it as `backend.routes` so support bundles show backend participation.

## Capability Roles

Use capability declarations for provider/requester/observer relationships:

```json
{
  "capabilities": {
    "stems": {
      "roles": ["requester", "observer"],
      "commands": ["mute", "restore", "list", "inspect"],
      "events": ["stems.ready", "stems.manual-unmute", "claim:created", "claim:released"],
      "mode": "active",
      "compatibility": "legacy-window-shim"
    }
  }
}
```

Profiles can then express intent through capability domains instead of hard-coding plugin-private implementation details.

Core registers manifest capability declarations from `/api/plugins` before plugin scripts hydrate. Runtime owners can then re-register the same participant with command handlers, event handlers, and current availability state. The merged participant view is visible through `window.slopsmith.capabilities.snapshotDiagnostics()` and `getDiagnostics()`.

Requesters should use the public claim/dispatch/release flow instead of mutating another plugin's globals:

```js
const api = window.slopsmith.capabilities;
api.claim({ capability: 'stems', claimId: 'nam.amp-active', owner: 'nam_tone' });
await api.dispatch({
  capability: 'stems',
  command: 'mute',
  source: 'nam_tone',
  claim: { claimId: 'nam.amp-active', owner: 'nam_tone' },
  args: { claimId: 'nam.amp-active', target: { kind: 'guitar' } },
});
api.release({ capability: 'stems', claimId: 'nam.amp-active', owner: 'nam_tone' });
```

Manual user actions win over matching automation claims. For example, Stems records a user override when a player toggles a stem while NAM owns the `nam.amp-active` claim; the registry reports the command as `overridden` and skips re-applying automation for that target. Owners keep restore snapshots for their own surfaces so requesters do not need to read private state.

## Core Playback Adapters

Plugins should prefer the `playback` capability for transport state and control instead of reaching into `window.highway`, player buttons, or private globals. Core owns the direct highway and media-element integration and exposes stable capability commands/events:

```js
const api = window.slopsmith.capabilities;

api.subscribe('playback:song:seek', event => {
  if (event.payload.reason === 'loop-wrap') return;
});

api.subscribe('playback:loop:restart', event => {
  console.log(event.payload.loopA, event.payload.loopB);
});

api.subscribe('playback:beats:loaded', event => {
  console.log(event.payload.count);
});

const snapshot = await api.command('playback', 'snapshot', { requester: 'my_plugin' });
await api.command('playback', 'seek', { requester: 'my_plugin', reason: 'section-map', payload: { seconds: 42.0 } });
await api.command('playback', 'loop-set', { requester: 'my_plugin', payload: { loopA: 12.5, loopB: 24.0 } });
await api.command('playback', 'loop-clear', { requester: 'my_plugin' });
```

The `seek` command routes through core's canonical seek funnel, so observers receive `song:seek` with `from`, `to`, and `reason`. The `snapshot` payload includes `audioT`, `chartT`, `perfNow`, `duration`, `paused`, and the current `{ loopA, loopB }`. Plugins that truly need the underlying media element can request `playback.audio-element`; core resolves that through the supported highway accessor internally so plugins do not depend on `window.highway` directly.

## Core Event Bridges

The app event bus still dispatches local `window.slopsmith` events for legacy listeners, and core also forwards cross-plugin event families into capability domains:

- `playback`: `song:*`, `loop:*`, `beats:loaded`, and legacy `arrangement:changed`
- `ui.navigation`: `screen:changed`
- `note-detection`: `note:hit` and `note:miss`
- `visualization`: `viz:*` and `highway:*`

New code should subscribe through capability events when it needs a cross-plugin contract. For navigation, plugins can request a screen change without wrapping `window.showScreen`:

```js
await window.slopsmith.capabilities.command('ui.navigation', 'navigate', {
  requester: 'my_plugin',
  target: { screenId: 'player' },
});
```

The direct `window.highway` object remains the renderer data plane for now. Per-frame reads such as notes, chords, beats, and renderer hooks should not be moved behind asynchronous capability commands until there is a dedicated chart/render facade.

## First-Party Management Plugins

Large management surfaces should prefer plugin-owned UI over crowding normal Settings. A bundled Profile Manager plugin can contribute screens and settings panels for profile, configuration-source, and settings-pack management while core keeps the underlying apply, rollback, trust, and diagnostics services.

## Rehydration Pattern

Plugins that wrap shared functions such as `window.playSong` or `window.showScreen` should store wrapper state on a stable `window.__slopsmith...Hooks` object. Re-running the script should replace the implementation object and return before installing another wrapper.

```js
const hookState = window.__slopsmithMyPluginHooks || (window.__slopsmithMyPluginHooks = {});
hookState.impl = { afterPlaySong(filename) { /* current implementation */ } };
if (hookState.installed) return;
hookState.installed = true;
hookState.basePlaySong = window.playSong;
window.playSong = async function(filename, arrangement) {
  await hookState.basePlaySong.call(this, filename, arrangement);
  hookState.impl?.afterPlaySong?.(filename, arrangement);
};
```

## Validation Commands

From the `slopsmith/` directory:

```bash
node --check static/app.js
node --check static/capabilities.js
node --check static/diagnostics.js
node --check ../slopsmith-plugin-capability-visualizer/screen.js
node --check ../slopsmith-plugin-stems/screen.js
node --check ../slopsmith-plugin-nam-tone/screen.js
pytest tests/test_profile_domains.py tests/test_plugin_runtime_idempotence.py tests/test_plugins.py tests/test_profile_diagnostics.py -q
```