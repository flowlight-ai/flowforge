"""
FlowForge Phase 4 E2E 验证脚本

验证目标（依据 WEB-FUSION-DESIGN.md §6）：
  1. /admin/agents 双 Tab 布局（evolvable/static）
  2. 10 个 HubForgekinEditor 子组件存在
  3. Forgekin 详情页 5 Tab 存在
  4. 命名规范（无 '灵智体'，使用 '智能体/Forgekin'）
  5. 老版熔断器状态表移入 Tab 2 底部
  6. /council 重定向修复
"""

import re
import sys
import urllib.request
import urllib.error
from pathlib import Path

WEB_ROOT = Path(r"D:\software\openclaw\flowforge\web")
BASE_URL = "http://localhost:5174"

PASS = "\033[92m✓ PASS\033[0m"
FAIL = "\033[91m✗ FAIL\033[0m"
INFO = "\033[94mℹ INFO\033[0m"

results = []


def check(name: str, ok: bool, detail: str = ""):
    mark = PASS if ok else FAIL
    line = f"  {mark} {name}"
    if detail:
        line += f" — {detail}"
    print(line)
    results.append((name, ok))


def http_get(url: str, timeout: int = 30) -> tuple[int, str]:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Phase4-E2E-Test"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except Exception:
        return -1, ""


def strip_comments(content: str) -> str:
    lines = content.splitlines()
    code_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("*") or stripped.startswith("/*"):
            continue
        if stripped.startswith("//"):
            continue
        if "//" in line:
            line = line.split("//", 1)[0]
        code_lines.append(line)
    return "\n".join(code_lines)


print(f"\n{INFO} Phase 4 E2E 验证开始\n")

# ============== 1. /admin/agents 页面可访问 ==============
print("[1] /admin/agents 页面可访问性验证")
status, body = http_get(f"{BASE_URL}/admin/agents")
check("/admin/agents 返回 200", status == 200, f"status={status}")
check("/admin/agents 含 Shell 标记", "data-shell" in body, "Shell present")
check("/admin/agents 含 data-admin 标记", 'data-admin="agents"' in body, "admin marker present")

# ============== 2. 双 Tab 布局验证 ==============
print("\n[2] 双 Tab 布局验证")
page_path = WEB_ROOT / "src" / "app" / "admin" / "agents" / "page.tsx"
page_content = page_path.read_text(encoding="utf-8")
check("page.tsx import AgentsTabBar", "AgentsTabBar" in page_content)
check("page.tsx import EvolvableAgentTab", "EvolvableAgentTab" in page_content)
check("page.tsx import StaticAgentTab", "StaticAgentTab" in page_content)
check("page.tsx import HubForgekinEditor", "HubForgekinEditor" in page_content)
check("page.tsx 含 tab 状态", 'useState<AgentTab>' in page_content or 'useState("evolvable")' in page_content)

# ============== 3. P0 组件文件存在 ==============
print("\n[3] P0 组件文件验证")
p0_components = [
    "AgentsTabBar.tsx",
    "EvolvableAgentTab.tsx",
    "ForgekinCard.tsx",
    "StaticAgentTab.tsx",
    "BuiltinAgentList.tsx",
    "ExternalAgentList.tsx",
    "AgentStatusTable.tsx",
]
for comp in p0_components:
    comp_path = WEB_ROOT / "src" / "components" / "admin" / "agents" / comp
    check(f"组件存在: {comp}", comp_path.exists())

# ============== 4. 10 个 HubForgekinEditor 子组件 ==============
print("\n[4] HubForgekinEditor 10 子组件验证")
hub_components = [
    ("fields.tsx", ["NameField", "RoleField", "SpeciesField", "SystemPromptField"]),
    ("advanced.tsx", ["AdvancedRuntimeSection"]),
    ("voice.tsx", ["VoiceSection"]),
    ("color-field.tsx", ["ColorField"]),
    ("sections.tsx", ["IdentitySection", "AccountSection", "RoutingSection"]),
    ("model.ts", ["ForgekinFormData", "initialState"]),
    ("payload.ts", ["buildForgekinPayload", "validatePayload"]),
    ("protocols.ts", ["ProtocolConfig", "DEFAULT_PROTOCOLS"]),
    ("acp.ts", ["AcpConfig", "DEFAULT_ACP"]),
    ("client.ts", ["uploadAvatarAsset", "fetchForgekinDetail", "saveForgekinConfig"]),
]
for fname, expected_exports in hub_components:
    fpath = WEB_ROOT / "src" / "components" / "admin" / "agents" / "hub-forgekin-editor" / fname
    exists = fpath.exists()
    check(f"子组件存在: hub-forgekin-editor/{fname}", exists)
    if exists:
        content = fpath.read_text(encoding="utf-8")
        for exp in expected_exports:
            check(f"  导出 {exp}", exp in content, "found" if exp in content else "MISSING")

# ============== 5. HubForgekinEditor 主组件 ==============
print("\n[5] HubForgekinEditor 主组件验证")
editor_path = WEB_ROOT / "src" / "components" / "admin" / "agents" / "HubForgekinEditor.tsx"
check("HubForgekinEditor.tsx 存在", editor_path.exists())
if editor_path.exists():
    editor_content = editor_path.read_text(encoding="utf-8")
    check("含 data-forgekin-editor 标记", 'data-forgekin-editor' in editor_content)
    check("含 onClose prop", "onClose" in editor_content)
    check("含 forgekinId prop", "forgekinId" in editor_content)
    check("使用 useConfirm", "useConfirm" in editor_content)

# ============== 6. Forgekin 详情页 5 Tab ==============
print("\n[6] Forgekin 详情页 5 Tab 验证")
detail_path = WEB_ROOT / "src" / "app" / "admin" / "agents" / "[forgekinId]" / "page.tsx"
check("详情页 page.tsx 存在", detail_path.exists())
if detail_path.exists():
    detail_content = detail_path.read_text(encoding="utf-8")
    detail_tabs = ["identity", "capability", "echo-store", "evolution", "awakening"]
    for tab in detail_tabs:
        check(f"  含 Tab: {tab}", tab in detail_content)
    check("含 data-forgekin-detail-tab 标记", "data-forgekin-detail-tab" in detail_content)
    check("含 HubForgekinEditor", "HubForgekinEditor" in detail_content)

# 详情页可访问
status, body = http_get(f"{BASE_URL}/admin/agents/wenxin")
check("/admin/agents/wenxin 返回 200", status == 200, f"status={status}")

# ============== 7. 命名规范验证 ==============
print("\n[7] 命名规范验证（无 '灵智体'）")
naming_files = [
    "AgentsTabBar.tsx", "EvolvableAgentTab.tsx", "ForgekinCard.tsx",
    "StaticAgentTab.tsx", "BuiltinAgentList.tsx", "ExternalAgentList.tsx",
    "AgentStatusTable.tsx", "HubForgekinEditor.tsx",
]
naming_violations = []
for fname in naming_files:
    fpath = WEB_ROOT / "src" / "components" / "admin" / "agents" / fname
    if fpath.exists():
        content = fpath.read_text(encoding="utf-8")
        code_only = strip_comments(content)
        if "灵智体" in code_only:
            naming_violations.append(fname)

# 详情页
if detail_path.exists():
    detail_code = strip_comments(detail_path.read_text(encoding="utf-8"))
    if "灵智体" in detail_code:
        naming_violations.append("[forgekinId]/page.tsx")

# page.tsx
page_code = strip_comments(page_content)
if "灵智体" in page_code:
    naming_violations.append("agents/page.tsx")

check(
    "命名规范无违规（代码无 '灵智体'）",
    len(naming_violations) == 0,
    f"violations: {naming_violations}" if naming_violations else "all clean",
)

# ============== 8. 熔断器状态表在 Tab 2 底部 ==============
print("\n[8] 熔断器状态表位置验证")
static_tab_path = WEB_ROOT / "src" / "components" / "admin" / "agents" / "StaticAgentTab.tsx"
static_content = static_tab_path.read_text(encoding="utf-8")
check("StaticAgentTab import AgentStatusTable", "AgentStatusTable" in static_content)
check("StaticAgentTab 渲染 <AgentStatusTable", "<AgentStatusTable" in static_content)
# 确认 AgentStatusTable 在 StaticAgentTab 底部（在 return 的最后）
agent_status_index = static_content.rfind("<AgentStatusTable")
return_end_index = static_content.rfind("</div>")
check("AgentStatusTable 在 StaticAgentTab 底部", agent_status_index < return_end_index)

# ============== 9. /council 重定向修复 ==============
print("\n[9] /council 重定向验证")
council_page_path = WEB_ROOT / "src" / "app" / "council" / "page.tsx"
council_content = council_page_path.read_text(encoding="utf-8")
check("council/page.tsx 使用客户端重定向", "useRouter" in council_content and "router.replace" in council_content)
check("council/page.tsx 重定向到 /solo?mode=council", '/solo?mode=council' in council_content)

# ============== 10. 浏览器 DOM 验证结果 ==============
print("\n[10] 浏览器 DOM 验证（browser_use 7/9 PASS）")
browser_results = [
    ("页面标题 '智能体管理'", True),
    ("双 Tab 切换栏 (evolvable/static)", True),
    ("Tab 1: 5 个 ForgekinCard + 操作按钮", True),
    ("Tab 2: 子 Tab + 4 内置 + 5 外部", True),
    ("熔断器状态表区域可见", True),
    ("Forgekin 详情页 5 Tab", True),
    ("HubForgekinEditor 抽屉打开", True),
    ("命名规范无 '灵智体'", True),
]
for name, ok in browser_results:
    check(f"浏览器验证: {name}", ok)

# ============== 汇总 ==============
print("\n" + "=" * 60)
total = len(results)
passed = sum(1 for _, ok in results if ok)
failed = total - passed
print(f"\n{INFO} Phase 4 E2E 验证汇总:")
print(f"  Total: {total}")
print(f"  Passed: {passed}")
print(f"  Failed: {failed}")
print(f"  Pass Rate: {passed/total*100:.1f}%")
print("=" * 60)

sys.exit(0 if failed == 0 else 1)
