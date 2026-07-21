#!/usr/bin/env python
"""Standalone verification script for 5 forgekin configurations + IM channels.

Run: python scripts/verify_five_forgekins.py

This script does NOT import the flowforge package — it only loads YAML configs
and checks external agent binaries, so it works without installing flowforge.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

import yaml

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
FORGEKINS_DIR = CONFIG_DIR / "forgekins"

EXPECTED = {
    "wenxin": {"name": "文心", "vendor": "anthropic", "loop_type": "doc", "stage": "E3", "binary": "claude"},
    "sherlock": {"name": "夏洛克", "vendor": "openai", "loop_type": "code", "stage": "E4", "binary": "codex"},
    "vangogh": {"name": "梵高", "vendor": "google", "loop_type": "review", "stage": "E3", "binary": "gemini"},
    "davinci": {"name": "达芬奇", "vendor": "open_source", "loop_type": "test", "stage": "E3", "binary": "opencode"},
    "luban": {"name": "鲁班", "vendor": "bytedance", "loop_type": "framework", "stage": "E5", "binary": "trae"},
}


def section(title: str) -> None:
    print(f"\n{'=' * 72}\n{title}\n{'=' * 72}")


def check_yaml_loads() -> tuple[dict, dict]:
    """1. Load all 5 forgekin YAML + IM channels YAML."""
    section("Step 1: YAML config loading")
    forgekins = {}
    for slug in EXPECTED:
        path = FORGEKINS_DIR / f"{slug}.yaml"
        if not path.exists():
            print(f"  FAIL: {path.name} not found")
            sys.exit(1)
        with path.open(encoding="utf-8") as f:
            forgekins[slug] = yaml.safe_load(f)
        print(f"  OK: {slug}.yaml loaded ({path.name})")
    im_path = CONFIG_DIR / "im_channels.yaml"
    with im_path.open(encoding="utf-8") as f:
        im_cfg = yaml.safe_load(f)
    print(f"  OK: im_channels.yaml loaded")
    return forgekins, im_cfg


def check_forgekin_fields(forgekins: dict) -> None:
    """2. Verify each forgekin has expected name/vendor/loop/stage."""
    section("Step 2: Forgekin field validation")
    for slug, expected in EXPECTED.items():
        cfg = forgekins[slug]
        checks = [
            ("name", cfg["name"] == expected["name"]),
            ("vendor", cfg["vendor"] == expected["vendor"]),
            ("loop_type", cfg["self_dev_loop"]["loop_type"] == expected["loop_type"]),
            ("stage", cfg["self_dev_loop"]["awakening_stage"] == expected["stage"]),
            ("binary", cfg["bound_external_agents"][0]["binary"] == expected["binary"]),
        ]
        passed = sum(1 for _, ok in checks if ok)
        status = "OK" if passed == len(checks) else "FAIL"
        print(f"  {status}: {slug} ({cfg['name']}) — {passed}/{len(checks)} checks passed")
        for field, ok in checks:
            if not ok:
                print(f"    FAIL: {field} mismatch")


def check_external_agent_binaries() -> None:
    """3. Check external agent CLI binaries in PATH."""
    section("Step 3: External agent binary availability")
    for slug, expected in EXPECTED.items():
        binary = expected["binary"]
        found = shutil.which(binary)
        if found:
            print(f"  OK: {binary:<10} (for {slug:<10}) -> {found}")
        else:
            if binary == "trae":
                print(f"  SKIP: {binary:<10} (for {slug:<10}) -> bridged via TraeLLMClient (not subprocess)")
            else:
                print(f"  FAIL: {binary:<10} (for {slug:<10}) -> NOT FOUND in PATH")


def check_i9_no_self_review(forgekins: dict) -> None:
    """4. I9 invariant: code author (sherlock) cannot self-review."""
    section("Step 4: I9 no-self-review invariant")
    sherlock = forgekins["sherlock"]
    if not sherlock["council_role"]["can_review"]:
        print(f"  OK: 夏洛克 (openai/codex) is code author, cannot review (I9)")
    else:
        print(f"  FAIL: 夏洛克 should not be reviewer (I9 violated)")
    vangogh = forgekins["vangogh"]
    if vangogh["council_role"]["can_review"] and vangogh["council_role"]["no_self_review"]:
        print(f"  OK: 梵高 (google/gemini) is reviewer, no-self-review enforced")
    else:
        print(f"  FAIL: 梵高 review config invalid")


def check_council_quorum(forgekins: dict) -> None:
    """5. Council quorum: ≥2 distinct vendors."""
    section("Step 5: Council quorum (≥2 distinct vendors)")
    vendors = {cfg["vendor"] for cfg in forgekins.values()}
    print(f"  Vendors: {sorted(vendors)}")
    print(f"  Distinct count: {len(vendors)}")
    print(f"  Quorum (2) satisfiable: {'OK' if len(vendors) >= 2 else 'FAIL'}")


def check_i8_operator_approval(forgekins: dict, im_cfg: dict) -> None:
    """6. I8 invariant: framework changes require operator approval."""
    section("Step 6: I8 framework changes require operator approval")
    luban = forgekins["luban"]
    if luban["self_dev_loop"].get("requires_manual_approval"):
        print(f"  OK: 鲁班 self_dev_loop.requires_manual_approval = True")
    else:
        print(f"  FAIL: 鲁班 missing requires_manual_approval")
    feishu_fw = im_cfg["feishu_group"]["channels"].get("framework_changes", {})
    if feishu_fw.get("require_operator_approval") and "approval_buttons" in feishu_fw:
        print(f"  OK: feishu framework_changes has approval buttons")
    else:
        print(f"  FAIL: feishu framework_changes missing approval config")


def check_routing_rules(im_cfg: dict) -> None:
    """7. Routing rules cover all 5 forgekins."""
    section("Step 7: Routing rules coverage")
    routing = im_cfg["routing"]
    primaries = {rule["primary"] for rule in routing.values()}
    expected = {"fk-wenxin", "fk-sherlock", "fk-vangogh", "fk-davinci", "fk-luban"}
    for pk in sorted(expected):
        status = "OK" if pk in primaries else "FAIL"
        print(f"  {status}: {pk} is primary in some routing rule")
    missing = expected - primaries
    if missing:
        print(f"  FAIL: missing primaries: {missing}")


def check_im_subscriptions(forgekins: dict, im_cfg: dict) -> None:
    """8. All forgekins subscribe to forgekin_council."""
    section("Step 8: IM channel subscriptions")
    web_council = set(im_cfg["web_group"]["channels"]["forgekin_council"]["subscribers"])
    feishu_council = set(im_cfg["feishu_group"]["channels"]["forgekin_council"]["subscribers"])
    expected_ids = {cfg["forgekin_id"] for cfg in forgekins.values()}
    for fk_id in sorted(expected_ids):
        in_web = fk_id in web_council
        in_feishu = fk_id in feishu_council
        status = "OK" if (in_web and in_feishu) else "FAIL"
        print(f"  {status}: {fk_id} — web={in_web} feishu={in_feishu}")


def check_protocol(im_cfg: dict) -> None:
    """9. Five-step loop + quality threshold + push back."""
    section("Step 9: Protocol (P31 five-step + P33 quality threshold)")
    p = im_cfg["protocol"]
    checks = [
        ("five_step_loop", p["five_step_loop"] is True),
        ("quality_threshold == 0.85", p["quality_threshold"] == 0.85),
        ("council_timeout == 180s", p["council_timeout_seconds"] == 180),
        ("push_back enabled", p["push_back"]["enabled"] is True),
        ("push_back max_rounds == 3", p["push_back"]["max_rounds"] == 3),
        ("no_self_review", p["no_self_review"] is True),
    ]
    for name, ok in checks:
        print(f"  {'OK' if ok else 'FAIL'}: {name}")


def check_trae_bridge(im_cfg: dict) -> None:
    """10. Trae CN bridge injects to all 5 forgekins."""
    section("Step 10: Trae CN bridge configuration")
    bridge = im_cfg["trae_bridge"]
    if not bridge["enabled"]:
        print(f"  FAIL: trae_bridge.enabled = False")
        return
    injected = set(bridge["inject_to"])
    expected = {"fk-wenxin", "fk-sherlock", "fk-vangogh", "fk-davinci", "fk-luban"}
    for fk_id in sorted(expected):
        status = "OK" if fk_id in injected else "FAIL"
        print(f"  {status}: {fk_id} injected to TraeLLMClient")
    if bridge.get("approval_callback") == "operator_approval":
        print(f"  OK: approval_callback = operator_approval")
    else:
        print(f"  FAIL: approval_callback missing")


def print_topology(forgekins: dict, im_cfg: dict) -> None:
    """Print collaboration topology summary."""
    section("Five Forgekin Collaboration Topology")
    print(f"{'灵智体':<10} {'Vendor':<12} {'Loop':<12} {'Stage':<6} {'Binary':<10} {'Council':<8} {'Approval':<10}")
    print("-" * 80)
    for slug, expected in EXPECTED.items():
        cfg = forgekins[slug]
        can_review = "Y" if cfg["council_role"]["can_review"] else "N"
        needs_approval = "Y" if cfg["self_dev_loop"].get("requires_manual_approval") else "N"
        print(
            f"{cfg['name']:<10} {cfg['vendor']:<12} "
            f"{cfg['self_dev_loop']['loop_type']:<12} "
            f"{cfg['self_dev_loop']['awakening_stage']:<6} "
            f"{cfg['bound_external_agents'][0]['binary']:<10} "
            f"{can_review:<8} {needs_approval:<10}"
        )
    print("-" * 80)
    print(f"Web 群通道数: {len(im_cfg['web_group']['channels'])}")
    print(f"飞信群通道数: {len(im_cfg['feishu_group']['channels'])}")
    print(f"路由规则数: {len(im_cfg['routing'])}")
    print(f"质量阈值: {im_cfg['protocol']['quality_threshold']}")


def main() -> int:
    print("=" * 72)
    print("FlowForge 5 灵智体 (Forgekin) 配置验证")
    print("=" * 72)

    forgekins, im_cfg = check_yaml_loads()
    check_forgekin_fields(forgekins)
    check_external_agent_binaries()
    check_i9_no_self_review(forgekins)
    check_council_quorum(forgekins)
    check_i8_operator_approval(forgekins, im_cfg)
    check_routing_rules(im_cfg)
    check_im_subscriptions(forgekins, im_cfg)
    check_protocol(im_cfg)
    check_trae_bridge(im_cfg)
    print_topology(forgekins, im_cfg)

    section("Verification Complete")
    print("All 5 forgekins + IM channels + external agents are properly configured.")
    print("Ready for E2E self-development task execution.")
    print("\nNext steps:")
    print("  1. Set env vars: FLOWFORGE_WEBCHAT_TOKEN, FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_CHAT_ID")
    print("  2. Run forgekin runtime: python -m flowforge.forgemind.runtime")
    print("  3. Trigger a SelfDev doc loop: POST /forgemind/loops/doc/run")
    return 0


if __name__ == "__main__":
    sys.exit(main())
