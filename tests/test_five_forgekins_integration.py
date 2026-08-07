"""Five-forgekin integration test — verify 5 Forgekin (文心/夏洛克/梵高/达芬奇/鲁班)
configurations + IM channels + external agent bindings are all wired correctly.

This is a config-validation test, not a runtime E2E test. It checks:
1. All 5 forgekin YAML files load successfully
2. IM channels YAML loads successfully
3. Each forgekin's bound_external_agents are available on host (or bridged via TraeLLMClient)
4. I9 no-self-review invariant: author vendor != reviewer vendor
5. Council quorum (≥2 distinct vendors) is satisfiable
6. Routing rules cover all 5 forgekins
7. I8 framework changes require operator approval (luban.yaml)

Run: pytest tests/test_five_forgekins_integration.py -v
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest
import yaml

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
FORGEKINS_DIR = CONFIG_DIR / "forgekins"

EXPECTED_FORGEKINS = {
    "wenxin": {"name": "文心", "vendor": "anthropic", "loop_type": "doc", "stage": "E3", "binary": "claude"},
    "sherlock": {"name": "夏洛克", "vendor": "openai", "loop_type": "code", "stage": "E4", "binary": "codex"},
    "vangogh": {"name": "梵高", "vendor": "google", "loop_type": "review", "stage": "E3", "binary": "gemini"},
    "davinci": {"name": "达芬奇", "vendor": "open_source", "loop_type": "test", "stage": "E3", "binary": "opencode"},
    "luban": {"name": "鲁班", "vendor": "bytedance", "loop_type": "framework", "stage": "E5", "binary": "trae"},
}


@pytest.fixture(scope="module")
def forgekin_configs() -> dict[str, dict]:
    """Load all 5 forgekin YAML configs."""
    configs = {}
    for slug in EXPECTED_FORGEKINS:
        path = FORGEKINS_DIR / f"{slug}.yaml"
        assert path.exists(), f"Missing forgekin config: {path}"
        with path.open(encoding="utf-8") as f:
            configs[slug] = yaml.safe_load(f)
    return configs


@pytest.fixture(scope="module")
def im_channels_config() -> dict:
    """Load IM channels YAML."""
    path = CONFIG_DIR / "im_channels.yaml"
    assert path.exists(), f"Missing IM channels config: {path}"
    with path.open(encoding="utf-8") as f:
        return yaml.safe_load(f)


# ── 1. YAML 加载完整性 ──────────────────────────────────────────

def test_all_five_forgekin_configs_load(forgekin_configs):
    """T6: 必须采集指标 — 5 个 forgekin YAML 全部可加载."""
    assert len(forgekin_configs) == 5
    for slug, expected in EXPECTED_FORGEKINS.items():
        cfg = forgekin_configs[slug]
        assert cfg["name"] == expected["name"], f"{slug}.name mismatch"
        assert cfg["vendor"] == expected["vendor"], f"{slug}.vendor mismatch"
        assert cfg["self_dev_loop"]["loop_type"] == expected["loop_type"]
        assert cfg["self_dev_loop"]["awakening_stage"] == expected["stage"]


def test_im_channels_config_loads(im_channels_config):
    """IM 通道 YAML 可加载,含 web_group + feishu_group."""
    assert "web_group" in im_channels_config
    assert "feishu_group" in im_channels_config
    assert im_channels_config["web_group"]["enabled"] is True
    assert im_channels_config["feishu_group"]["enabled"] is True


# ── 2. 外部 agent 绑定 ──────────────────────────────────────────

def test_external_agent_bindings(forgekin_configs):
    """每个 forgekin 绑定的 external_agent kind 与预期 binary 匹配."""
    for slug, expected in EXPECTED_FORGEKINS.items():
        cfg = forgekin_configs[slug]
        bindings = cfg["bound_external_agents"]
        assert len(bindings) == 1, f"{slug} should bind exactly 1 external agent"
        binding = bindings[0]
        assert binding["binary"] == expected["binary"], f"{slug}.binary mismatch"
        assert binding["role"] == "primary_executor"


@pytest.mark.parametrize("slug,expected_binary", [
    ("wenxin", "claude"),
    ("sherlock", "codex"),
    ("vangogh", "gemini"),
    ("davinci", "opencode"),
])
def test_external_agent_binary_available(slug, expected_binary):
    """T4: 禁止Mock工具 — claude/codex/gemini/opencode 二进制必须在 PATH 中."""
    found = shutil.which(expected_binary)
    assert found is not None, (
        f"External agent binary {expected_binary!r} (for {slug}) not found in PATH. "
        "Install it or add to PATH before running E2E."
    )


def test_trae_bridged_via_llm_client(forgekin_configs):
    """trae 不通过 subprocess 调用,而是通过 TraeLLMClient 桥接 Trae CN IDE."""
    luban = forgekin_configs["luban"]
    # 鲁班绑定的 trae binary 可能不在 PATH,但必须配置 trae_bridge
    assert luban["bound_external_agents"][0]["kind"] == "trae"


# ── 3. I9 no-self-review 不变量 ─────────────────────────────────

def test_i9_no_self_review(forgekin_configs):
    """I9: 审查员 vendor 必须与 author vendor 不同."""
    # 文心 (anthropic) 不能审 anthropic author → 但文心主要是 doc reviewer
    # 夏洛克 (openai) 不能审 openai author → 夏洛克不参与 review
    sherlock = forgekin_configs["sherlock"]
    assert sherlock["council_role"]["can_review"] is False, (
        "夏洛克 (codex/openai) 是 code author,不能 self-review (I9)"
    )
    # 梵高 (google) 可以审 anthropic/openai/open_source/bytedance author
    vangogh = forgekin_configs["vangogh"]
    assert vangogh["council_role"]["can_review"] is True
    assert vangogh["council_role"]["no_self_review"] is True


def test_council_quorum_satisfiable(forgekin_configs):
    """Council quorum ≥2 distinct vendors 可满足 — 5 个 forgekin 来自 5 个不同 vendor."""
    vendors = {cfg["vendor"] for cfg in forgekin_configs.values()}
    assert len(vendors) == 5, f"Expected 5 distinct vendors, got {len(vendors)}: {vendors}"


# ── 4. I8 框架变更需 operator 批准 ───────────────────────────────

def test_i8_framework_changes_require_approval(forgekin_configs, im_channels_config):
    """I8: 鲁班 (luban) 的 framework 变更必须 require operator approval."""
    luban = forgekin_configs["luban"]
    assert luban["self_dev_loop"]["requires_manual_approval"] is True
    assert luban["self_dev_loop"]["approval_callback"] == "operator_approval"

    # IM 通道: framework_changes 必须订阅 feishu_group (operator 在飞信群批准)
    feishu = im_channels_config["feishu_group"]["channels"]
    assert "framework_changes" in feishu
    assert feishu["framework_changes"]["require_operator_approval"] is True
    assert "approval_buttons" in feishu["framework_changes"]


# ── 5. 路由规则覆盖所有 5 个 forgekin ───────────────────────────

def test_routing_rules_cover_all_forgekins(im_channels_config):
    """Routing rules 必须为每个 forgekin 分配 primary role."""
    routing = im_channels_config["routing"]
    primary_forgekins = set()
    for rule_name, rule in routing.items():
        primary_forgekins.add(rule["primary"])
    expected_primaries = {"fk-wenxin", "fk-sherlock", "fk-vangogh", "fk-davinci", "fk-luban"}
    missing = expected_primaries - primary_forgekins
    assert not missing, f"Routing rules missing primary for: {missing}"


# ── 6. IM 通道订阅完整性 ────────────────────────────────────────

def test_all_forgekins_subscribe_to_council(forgekin_configs, im_channels_config):
    """5 个 forgekin 都订阅 web_group:forgekin_council + feishu_group:forgekin_council."""
    council_subscribers = set(
        im_channels_config["web_group"]["channels"]["forgekin_council"]["subscribers"]
    )
    expected_ids = {cfg["forgekin_id"] for cfg in forgekin_configs.values()}
    missing = expected_ids - council_subscribers
    assert not missing, f"forgekin_council missing subscribers: {missing}"


# ── 7. 五步闭环 + 质量阈值 ──────────────────────────────────────

def test_five_step_loop_and_quality_threshold(im_channels_config):
    """P31: 五步闭环 + P33: 质量阈值 0.85."""
    protocol = im_channels_config["protocol"]
    assert protocol["five_step_loop"] is True
    assert protocol["quality_threshold"] == 0.85
    assert protocol["council_timeout_seconds"] == 180  # 3 分钟
    assert protocol["push_back"]["enabled"] is True
    assert protocol["push_back"]["max_rounds"] == 3


# ── 8. Trae CN 桥接配置 ─────────────────────────────────────────

def test_trae_bridge_configured(im_channels_config):
    """trae_bridge 必须注入所有 5 个 forgekin."""
    bridge = im_channels_config["trae_bridge"]
    assert bridge["enabled"] is True
    injected = set(bridge["inject_to"])
    expected = {"fk-wenxin", "fk-sherlock", "fk-vangogh", "fk-davinci", "fk-luban"}
    assert injected == expected, f"trae_bridge inject_to mismatch: {injected ^ expected}"
    assert bridge["approval_callback"] == "operator_approval"


# ── 9. 协作拓扑打印 (信息性,非断言) ──────────────────────────────

def test_print_collaboration_topology(forgekin_configs, im_channels_config, capsys):
    """打印 5 Forgekin协作拓扑 (信息性,便于调试)."""
    print("\n" + "=" * 72)
    print("5 Forgekin协作拓扑 (Five Forgekin Collaboration Topology)")
    print("=" * 72)
    print(f"{'Forgekin':<10} {'Vendor':<12} {'Loop':<12} {'Stage':<6} {'Binary':<10} {'Council':<10}")
    print("-" * 72)
    for slug, expected in EXPECTED_FORGEKINS.items():
        cfg = forgekin_configs[slug]
        can_review = "Y" if cfg["council_role"]["can_review"] else "N"
        print(
            f"{cfg['name']:<10} {cfg['vendor']:<12} "
            f"{cfg['self_dev_loop']['loop_type']:<12} "
            f"{cfg['self_dev_loop']['awakening_stage']:<6} "
            f"{cfg['bound_external_agents'][0]['binary']:<10} "
            f"{can_review:<10}"
        )
    print("=" * 72)
    print(f"Web 群通道数: {len(im_channels_config['web_group']['channels'])}")
    print(f"飞信群通道数: {len(im_channels_config['feishu_group']['channels'])}")
    print(f"路由规则数: {len(im_channels_config['routing'])}")
    print(f"质量阈值: {im_channels_config['protocol']['quality_threshold']}")
    print(f"I8 框架变更需 operator 批准: {forgekin_configs['luban']['self_dev_loop']['requires_manual_approval']}")
    print("=" * 72 + "\n")
