from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = ROOT.parent


def _sibling_file(plugin_dir: str, filename: str) -> Path:
    path = WORKSPACE_ROOT / plugin_dir / filename
    if not path.exists():
        pytest.skip(f"requires sibling plugin checkout: {plugin_dir}/{filename}")
    return path


def _sibling_text(plugin_dir: str, filename: str, required_token: str | None = None) -> str:
    text = _sibling_file(plugin_dir, filename).read_text(encoding="utf-8")
    if required_token and required_token not in text:
        pytest.skip(f"requires {plugin_dir} checkout with {required_token}")
    return text


def test_plugin_loader_guards_duplicate_hydration_and_scripts():
    source = (ROOT / "static" / "app.js").read_text(encoding="utf-8")

    assert "let _loadPluginsInFlight = false" in source
    assert "window.slopsmith._loadedPluginScripts" in source
    assert "document.querySelectorAll('.screen[id^=\"plugin-\"]')" in source


def test_plugin_loader_unmounts_previous_ui_contributions_before_reregistering():
    source = (ROOT / "static" / "app.js").read_text(encoding="utf-8")

    assert "const _pluginUiContributions = new Map()" in source
    assert "await _commandUiDomain(contribution.domain, 'unmount', plugin, contribution)" in source
    assert "await _commandUiDomain(contribution.domain, 'register-contribution', plugin, contribution)" in source
    assert "await _commandUiDomain(contribution.domain, 'mount', plugin, contribution)" in source


def test_plugin_loader_unmounts_contributions_for_removed_plugins():
    source = (ROOT / "static" / "app.js").read_text(encoding="utf-8")

    assert "const livePluginIds = new Set(plugins.map((plugin) => plugin.id))" in source
    assert "for (const [pluginId, contributions] of _pluginUiContributions)" in source
    assert "const stalePlugin = { id: pluginId }" in source
    assert "await _commandUiDomain(contribution.domain, 'unmount', stalePlugin, contribution)" in source
    assert "_pluginUiContributions.delete(pluginId)" in source



def test_capability_visualizer_waits_for_registry_instead_of_hard_error():
    source = _sibling_file("slopsmith-plugin-capability-visualizer", "screen.js").read_text(encoding="utf-8")

    assert "scheduleRegistryRetry" in source
    assert "Capability runtime is loading..." in source
    assert "Capability registry unavailable" not in source


def test_app_shell_loads_capability_registry_before_app_runtime():
    source = (ROOT / "static" / "index.html").read_text(encoding="utf-8")

    assert '<script src="/static/capabilities.js"></script>' in source
    assert source.index('/static/diagnostics.js') < source.index('/static/capabilities.js')
    assert source.index('/static/capabilities.js') < source.index('/static/app.js')


def test_capability_registry_exposes_claim_dispatch_and_ready_contracts():
    source = (ROOT / "static" / "capabilities.js").read_text(encoding="utf-8")

    for token in ["function claim(", "function release(", "async function dispatch(", "function subscribe(", "getDiagnostics: snapshotDiagnostics"]:
        assert token in source
    assert "activeClaims" in source
    assert "slopsmith:capabilities:ready" in source
    assert "outcome: 'overridden'" in source


def test_capability_runtime_overrides_do_not_mask_claims():
    source = (ROOT / "static" / "capabilities.js").read_text(encoding="utf-8")
    set_enabled = source[source.index("function setParticipantEnabled("):source.index("function registerParticipants(")]
    audio_monitoring = source[source.index("'audio-monitoring':"):source.index("'backend.routes':")]

    assert "['denied', 'failed', 'short-circuited', 'handled', 'degraded', 'overridden'].includes(decision.outcome)" in source
    assert "if (entry.type !== 'manual') return false;" in source
    assert "type: 'manual'" in source
    assert "_remember(userOverrides" not in set_enabled
    assert "roles: ['owner', 'provider']" in audio_monitoring


def test_playback_capability_wraps_transport_and_highway_surfaces():
    app_source = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
    capability_source = (ROOT / "static" / "capabilities.js").read_text(encoding="utf-8")

    assert "eventName.startsWith('loop:')" in app_source
    assert "eventName === 'beats:loaded'" in app_source
    assert "eventName === 'arrangement:changed'" in app_source
    assert "this.capabilities.emitEvent(capability, event, capabilityDetail)" in app_source
    assert "seek(seconds, reason) { return _audioSeek(seconds, reason || 'plugin-command'); }" in app_source
    for token in ["'audio-element'", "'loop-set'", "'loop-clear'", "'loop-get'", "'loop:restart'", "'beats:loaded'", "'arrangement:changed'"]:
        assert token in capability_source
    assert "highway.getAudioElement" in capability_source
    assert "highway.getTime" in capability_source
    assert "window.slopsmith.seek(seconds" in capability_source
    assert "chartT: _chartTime(audioT)" in capability_source
    assert "loop: _loopSnapshot()" in capability_source


def test_capability_events_cover_navigation_notes_and_visualization():
    app_source = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
    capability_source = (ROOT / "static" / "capabilities.js").read_text(encoding="utf-8")

    assert "capability = 'ui.navigation'" in app_source
    assert "capability = 'note-detection'" in app_source
    assert "eventName.startsWith('viz:') || eventName.startsWith('highway:')" in app_source
    for token in ["'navigate'", "'screen:changed'", "function _navigate(", "window.slopsmith.navigate(id, params)"]:
        assert token in capability_source
    for token in ["'note:hit'", "'note:miss'", "'viz:renderer:ready'", "'viz:reverted'", "'highway:canvas-replaced'"]:
        assert token in capability_source


def test_plugin_loader_registers_manifest_capability_declarations():
    source = (ROOT / "static" / "app.js").read_text(encoding="utf-8")

    assert "const capabilityPlugins = fetchedPlugins.slice().sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')))" in source
    assert "window.slopsmith.capabilities.registerParticipants(capabilityPlugins)" in source
    assert "window.slopsmith.capabilities.registerParticipants(plugins)" not in source
    assert "plugin-manifest-load" in source


def test_app_event_bus_dispatches_locally_and_preserves_juce_stop_state():
    source = (ROOT / "static" / "app.js").read_text(encoding="utf-8")

    assert "this.dispatchEvent(new CustomEvent(event, { detail }))" in source
    assert "const hadPlayableSong = !!audio.src || !!window._juceAudioUrl || isPlaying" in source
    assert "sm.emit('song:resume', payload)" in source
    assert "window.slopsmith.emit('song:resume', payload)" in source


def test_nam_and_stems_use_owner_claim_dispatch_semantics():
    nam_source = _sibling_text("slopsmith-plugin-nam-tone", "screen.js", "NAM_STEM_CLAIM_ID = 'nam.amp-active'")
    stems_source = _sibling_text("slopsmith-plugin-stems", "screen.js", "claimSnapshots")

    assert "NAM_STEM_CLAIM_ID = 'nam.amp-active'" in nam_source
    assert "api.claim({ capability: 'stems'" in nam_source
    assert "api.dispatch({" in nam_source
    assert "api.release({ capability: 'stems'" in nam_source
    assert "window._stemsState" not in nam_source
    assert "claimSnapshots" in stems_source
    assert "api.registerParticipant('stems'" in stems_source
    assert "mute: capMute" in stems_source
    assert "restore: capRestore" in stems_source
    assert "recordUserOverride" in stems_source
    assert "clearClaimSnapshots" in stems_source
    assert "'claim:released'" in stems_source


def test_nam_screen_uses_stable_singleton_hooks_for_rehydration():
    source = _sibling_text("slopsmith-plugin-nam-tone", "screen.js", "window.__slopsmithNamHooks")
    manifest = _sibling_text("slopsmith-plugin-nam-tone", "plugin.json", "capability-pipelines.v1")

    assert "plugin-runtime-idempotent.v1" in manifest
    assert "capability-pipelines.v1" in manifest
    assert "window.__slopsmithNamHooks" in source
    assert "hookState.impl" in source
    assert "if (hookState.installed) return" in source


def test_stems_screen_uses_stable_singleton_hooks_for_rehydration():
    source = _sibling_text("slopsmith-plugin-stems", "screen.js", "window.__slopsmithStemsHooks")
    manifest = _sibling_text("slopsmith-plugin-stems", "plugin.json", "capability-pipelines.v1")

    assert "plugin-runtime-idempotent.v1" in manifest
    assert "capability-pipelines.v1" in manifest
    assert "window.__slopsmithStemsHooks" in source
    assert "hookState.impl" in source
    assert "if (hookState.installed) return" in source