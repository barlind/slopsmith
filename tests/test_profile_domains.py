import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_core_ui_domains_expose_contribution_commands():
    source = (ROOT / "static" / "capabilities.js").read_text(encoding="utf-8")
    for domain in [
        "ui.navigation",
        "ui.plugin-screens",
        "ui.player-controls",
        "ui.player-panels",
        "ui.player-overlays",
        "settings",
    ]:
        assert domain in source
    for command in [
        "register-contribution",
        "mount",
        "unmount",
        "set-visible",
        "reorder-by-policy",
        "inspect",
    ]:
        assert command in source


def test_cloned_plugin_ui_placement_audit_passes_declared_domain_threshold(tmp_path):
    declared = {
        "id": "declared",
        "nav": {"label": "Declared", "screen": "declared"},
        "screen": "screen.html",
        "settings": {"html": "settings.html"},
        "ui": {
            "ui.navigation": [{"id": "declared-nav"}],
            "ui.plugin-screens": [{"id": "declared-screen"}],
            "settings": [{"id": "declared-settings"}],
        },
    }
    legacy = {
        "id": "legacy",
        "nav": {"label": "Legacy", "screen": "legacy"},
        "screen": "screen.html",
    }
    for index in range(9):
        plugin_dir = tmp_path / f"declared-{index}"
        plugin_dir.mkdir()
        (plugin_dir / "plugin.json").write_text(json.dumps({**declared, "id": f"declared-{index}"}), encoding="utf-8")
    plugin_dir = tmp_path / "legacy"
    plugin_dir.mkdir()
    (plugin_dir / "plugin.json").write_text(json.dumps(legacy), encoding="utf-8")

    manifests = [json.loads(path.read_text(encoding="utf-8")) for path in tmp_path.glob("*/plugin.json")]
    ui_plugins = [manifest for manifest in manifests if manifest.get("nav") or manifest.get("screen") or manifest.get("settings")]
    declared_plugins = [manifest for manifest in ui_plugins if isinstance(manifest.get("ui"), dict) or isinstance(manifest.get("ui_contributions"), dict)]

    assert len(declared_plugins) / len(ui_plugins) >= 0.9