from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = ROOT.parent


def _sibling_file(plugin_dir: str, filename: str) -> Path:
    path = WORKSPACE_ROOT / plugin_dir / filename
    if not path.exists():
        pytest.skip(f"requires sibling plugin checkout: {plugin_dir}/{filename}")
    return path


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


def test_plugin_loader_registers_manifest_capability_declarations():
    source = (ROOT / "static" / "app.js").read_text(encoding="utf-8")

    assert "window.slopsmith.capabilities.registerParticipants(plugins)" in source
    assert "plugin-manifest-load" in source


def test_app_event_bus_dispatches_locally_and_preserves_juce_stop_state():
    source = (ROOT / "static" / "app.js").read_text(encoding="utf-8")

    assert "this.dispatchEvent(new CustomEvent(event, { detail }))" in source
    assert "const hadPlayableSong = !!audio.src || !!window._juceAudioUrl || isPlaying" in source
    assert "sm.emit('song:resume', { time: jucePlayer.currentTime })" in source
    assert "window.slopsmith.emit('song:resume', { time: jucePlayer.currentTime })" in source


def test_nam_and_stems_use_owner_claim_dispatch_semantics():
    nam_source = _sibling_file("slopsmith-plugin-nam-tone", "screen.js").read_text(encoding="utf-8")
    stems_source = _sibling_file("slopsmith-plugin-stems", "screen.js").read_text(encoding="utf-8")

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
    source = _sibling_file("slopsmith-plugin-nam-tone", "screen.js").read_text(encoding="utf-8")
    manifest = _sibling_file("slopsmith-plugin-nam-tone", "plugin.json").read_text(encoding="utf-8")

    assert "plugin-runtime-idempotent.v1" in manifest
    assert "capability-pipelines.v1" in manifest
    assert "window.__slopsmithNamHooks" in source
    assert "hookState.impl" in source
    assert "if (hookState.installed) return" in source


def test_stems_screen_uses_stable_singleton_hooks_for_rehydration():
    source = _sibling_file("slopsmith-plugin-stems", "screen.js").read_text(encoding="utf-8")
    manifest = _sibling_file("slopsmith-plugin-stems", "plugin.json").read_text(encoding="utf-8")

    assert "plugin-runtime-idempotent.v1" in manifest
    assert "capability-pipelines.v1" in manifest
    assert "window.__slopsmithStemsHooks" in source
    assert "hookState.impl" in source
    assert "if (hookState.installed) return" in source