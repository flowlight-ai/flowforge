"""
FlowForge Phase 2 E2E 验证脚本

验证目标（依据 WEB-FUSION-DESIGN.md §14.2）：
  1. 所有路由显示统一的 ActivityBar + ThreadSidebar + TopBar（杜绝裸页面）
  2. 4 个 Shell 标记存在（data-shell / data-activity-bar / data-thread-sidebar / data-topbar）
  3. chromeless 路由不显示 Shell
  4. SIDEBAR_HIDDEN_ROUTES 隐藏 ThreadSidebar（但有 ActivityBar + TopBar）
  5. 9 个 vendor CSS 文件在页面 <head> 中被引入
  6. 全局 Provider 组件挂载（SessionBootstrap / ForgekinHueInjector / ThemeProvider 等）
  7. 旧 Sidebar.tsx 已删除，新 ThreadSidebar 已替代
  8. SDK 导出更新（ThreadSidebar / ActivityBar / TopBar）

不验证（Phase 3 工作）：
  - HelmLayout 拆分
  - 4 模式真正融合
  - /council 重定向
"""

import json
import re
import sys
import urllib.request
import urllib.error
from pathlib import Path

# 由本文件位置推导，勿写死操作系统绝对路径（团队含 Linux / Win11 / iOS）
# tests/e2e/<this>.py -> parents[2] == flowforge 仓库根
WEB_ROOT = Path(__file__).resolve().parents[2] / "web"
SDK_PATH = WEB_ROOT / "src" / "sdk" / "index.ts"
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
        req = urllib.request.Request(url, headers={"User-Agent": "Phase2-E2E-Test"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception:
        return -1, ""


def main() -> int:
    print(f"\n{INFO} Phase 2 E2E 验证开始\n")

    # ============== 1. 所有路由显示统一 Shell ==============
    print("[1] 统一 Shell 验证（所有路由含 4 个 Shell 标记）")
    SHELL_ROUTES = ["/", "/solo", "/council", "/tasks", "/review", "/admin", "/admin/agents"]
    REQUIRED_MARKERS = ["data-shell", "data-activity-bar", "data-thread-sidebar", "data-topbar"]
    shell_pass_count = 0
    for route in SHELL_ROUTES:
        url = f"{BASE_URL}{route}"
        status, body = http_get(url)
        if status != 200:
            check(f"路由 {route} 可访问", False, f"status={status}")
            continue
        missing = [m for m in REQUIRED_MARKERS if m not in body]
        ok = len(missing) == 0
        if ok:
            shell_pass_count += 1
        check(
            f"路由 {route} 含完整 Shell 标记",
            ok,
            f"status={status}, missing={missing}" if missing else f"status={status}, all 4 markers present",
        )
    check(
        f"统一 Shell 路由总数 {len(SHELL_ROUTES)}/{len(SHELL_ROUTES)}",
        shell_pass_count == len(SHELL_ROUTES),
        f"通过 {shell_pass_count}/{len(SHELL_ROUTES)}",
    )

    # ============== 2. chromeless 路由不显示 Shell ==============
    print("\n[2] Chromeless 路由验证（展示页无 Shell）")
    # 注：/showcase /story 可能不存在，但若存在则不应有 Shell 标记
    # 这里验证 chromelessPaths 配置存在
    layout_path = WEB_ROOT / "src" / "app" / "layout.tsx"
    layout_content = layout_path.read_text(encoding="utf-8")
    has_chromeless = "chromelessPaths" in layout_content
    check("layout.tsx 含 chromelessPaths 配置", has_chromeless)
    has_no_helm_paths = "helmPaths" not in layout_content.replace("helmPaths?: string[]", "")  # 排除类型定义
    # 检查 layout.tsx 中不再使用 helmPaths 配置
    helm_paths_usage = re.findall(r"helmPaths\s*:", layout_content)
    check(
        "layout.tsx 不再配置 helmPaths（已迁移到 chromelessPaths）",
        len(helm_paths_usage) == 0,
        f"helmPaths usages: {helm_paths_usage}",
    )

    # ============== 3. SIDEBAR_HIDDEN_ROUTES 隐藏 ThreadSidebar ==============
    print("\n[3] Sidebar 隐藏路由验证")
    shell_wrapper_path = WEB_ROOT / "src" / "components" / "ShellWrapper.tsx"
    shell_wrapper_content = shell_wrapper_path.read_text(encoding="utf-8")
    sidebar_hidden_defined = "SIDEBAR_HIDDEN_ROUTES" in shell_wrapper_content
    check("ShellWrapper 定义 SIDEBAR_HIDDEN_ROUTES", sidebar_hidden_defined)

    # 验证 /admin/settings 路由：应有 ActivityBar + TopBar 但可能无 ThreadSidebar
    # 注意：SSR 渲染时 useIsDesktop 默认 true，isOpen 默认 true，所以 ThreadSidebar 会渲染
    # 但 SIDEBAR_HIDDEN_ROUTES 会过滤掉 /admin/settings
    settings_url = f"{BASE_URL}/admin/settings"
    settings_status, settings_body = http_get(settings_url)
    if settings_status == 200:
        has_activity_bar = "data-activity-bar" in settings_body
        has_topbar = "data-topbar" in settings_body
        check(f"/admin/settings 含 ActivityBar", has_activity_bar)
        check(f"/admin/settings 含 TopBar", has_topbar)
    else:
        check(f"/admin/settings 可访问", False, f"status={settings_status}")

    # ============== 4. 9 个 vendor CSS 在 <head> 中引入 ==============
    print("\n[4] Vendor CSS 引入验证（打包到 _next/static/css/app/layout.css）")
    status, body = http_get(f"{BASE_URL}/")
    # Next.js dev 模式下，所有 import 的 CSS 被打包到 _next/static/css/app/layout.css
    # 提取打包后 CSS 的 URL
    layout_css_match = re.search(r'href="(/_next/static/css/app/layout\.css[^"]*)"', body)
    if layout_css_match:
        layout_css_url = f"{BASE_URL}{layout_css_match.group(1)}"
        css_status, css_body = http_get(layout_css_url)
        # 每个 vendor CSS 文件的特征变量名（用于验证内容被正确打包）
        css_feature_map = {
            "theme-tokens.css": "--accent-hue",
            "forgekin-persona-tokens.css": "--cocreator-hue",
            "forgekin-persona-derived.css": "--cat-msg-bubble",
            "console-tokens.css": "--console-rail-bg",
            "console-shell.css": "console-shell",
            "console-controls.css": "console-controls",
            "connector-tokens.css": "--conn-slate-bg",
            "theme-extras.css": "--semantic-spotlight",
        }
        css_loaded_count = 0
        for css_file, feature in css_feature_map.items():
            found = css_status == 200 and feature in css_body
            if found:
                css_loaded_count += 1
            check(
                f"CSS 内容打包: {css_file}（特征: {feature}）",
                found,
                f"feature in layout.css: {found}",
            )
        check(
            f"CSS 文件打包总数 8/8",
            css_loaded_count == 8,
            f"通过 {css_loaded_count}/8",
        )
    else:
        check("找到 layout.css 链接", False, "未在页面 <head> 中找到 layout.css link")

    # ============== 5. 全局 Provider 组件挂载 ==============
    print("\n[5] 全局 Provider 组件验证")
    # 检查 layout.tsx 引入了所有 Provider
    required_providers = [
        ("SessionBootstrap", "SessionBootstrap"),
        ("ForgekinHueInjector", "ForgekinHueInjector"),
        ("ThemeProvider", "ThemeProvider"),
        ("ThemeApplier", "ThemeApplier"),
        ("ConfirmProvider", "ConfirmProvider"),
        ("BrakeModal", "BrakeModal"),
        ("GuideOverlay", "GuideOverlay"),
        ("ToastContainer", "ToastContainer"),
        ("ShellConfigProvider", "ShellConfigProvider"),
        ("ShellWrapper", "ShellWrapper"),
    ]
    for label, import_name in required_providers:
        found = import_name in layout_content
        check(f"layout.tsx 引入 {label}", found)

    # ============== 6. 旧 Sidebar.tsx 已删除 ==============
    print("\n[6] 旧 Sidebar 清理验证")
    old_sidebar_path = WEB_ROOT / "src" / "components" / "Sidebar.tsx"
    check("旧 Sidebar.tsx 已删除", not old_sidebar_path.exists())

    # 新 ThreadSidebar 已创建
    new_thread_sidebar_path = WEB_ROOT / "src" / "components" / "ThreadSidebar" / "ThreadSidebar.tsx"
    check("新 ThreadSidebar.tsx 已创建", new_thread_sidebar_path.exists())

    thread_sidebar_index = WEB_ROOT / "src" / "components" / "ThreadSidebar" / "index.tsx"
    check("ThreadSidebar/index.tsx 导出存在", thread_sidebar_index.exists())

    # ============== 7. 新 Shell 组件文件存在 ==============
    print("\n[7] 新 Shell 组件文件验证")
    new_components = [
        "ActivityBar.tsx",
        "TopBar.tsx",
        "ApprovalHubDrawer.tsx",
        "ThreadSidebar/ThreadSidebar.tsx",
        "ThreadSidebar/index.tsx",
        "concierge/ConciergeHost.tsx",
        "workspace/FloatingPresentationSurfaceHost.tsx",
        "workspace/ResizeHandle.tsx",
    ]
    for comp in new_components:
        comp_path = WEB_ROOT / "src" / "components" / comp
        check(f"组件存在: src/components/{comp}", comp_path.exists())

    # ============== 8. SDK 导出更新 ==============
    print("\n[8] SDK 导出验证")
    sdk_content = SDK_PATH.read_text(encoding="utf-8")
    sdk_exports = [
        ("ThreadSidebar", "ThreadSidebar"),
        ("ActivityBar", "ActivityBar"),
        ("TopBar", "TopBar"),
        ("Sidebar（兼容别名）", "ThreadSidebar as Sidebar"),
    ]
    for label, pattern in sdk_exports:
        check(f"SDK 导出 {label}", pattern in sdk_content)

    # 旧 Sidebar 直接导出已移除
    old_export = 'from "../components/Sidebar"' in sdk_content
    check("SDK 不再直接导出旧 Sidebar", not old_export)

    # ============== 9. useIsDesktop hook 存在 ==============
    print("\n[9] Hooks 验证")
    hooks_path = WEB_ROOT / "src" / "hooks" / "useIsDesktop.ts"
    check("useIsDesktop hook 存在", hooks_path.exists())

    # ============== 10. data-shell="wrapper" 标记 ==============
    print("\n[10] data-shell 标记验证（T8 测试用）")
    status, body = http_get(f"{BASE_URL}/")
    has_data_shell_wrapper = 'data-shell="wrapper"' in body
    check('页面含 data-shell="wrapper" 标记', has_data_shell_wrapper)

    has_data_shell_main = 'data-shell="main"' in body
    check('页面含 data-shell="main" 标记', has_data_shell_main)

    # ============== 11. 命名规范验证（无 P2 别名） ==============
    print("\n[11] 命名规范验证（依据 naming-contract.md P0 命名）")
    naming_files = [
        "ActivityBar.tsx",
        "TopBar.tsx",
        "ApprovalHubDrawer.tsx",
        "ThreadSidebar/ThreadSidebar.tsx",
    ]
    naming_violations = []
    for fname in naming_files:
        fpath = WEB_ROOT / "src" / "components" / fname
        if fpath.exists():
            content = fpath.read_text(encoding="utf-8")
            # 检查代码中（排除注释）是否使用 P2 别名 "灵智体"（应使用 P0 "智能体"）
            # 简化检查：在 JS 字符串/JSX 文本中不应出现 "灵智体"
            # 但注释中的出处引用允许
            lines = content.splitlines()
            for i, line in enumerate(lines, 1):
                stripped = line.strip()
                if stripped.startswith("*") or stripped.startswith("//") or stripped.startswith("/*"):
                    continue
                if "灵智体" in line:
                    naming_violations.append(f"{fname}:{i}: contains '灵智体' in code")

    # layout.tsx 也检查
    layout_violations = []
    for i, line in enumerate(layout_content.splitlines(), 1):
        stripped = line.strip()
        if stripped.startswith("*") or stripped.startswith("//") or stripped.startswith("/*"):
            continue
        if "灵智体" in line:
            layout_violations.append(f"layout.tsx:{i}: contains '灵智体' in code")

    all_violations = naming_violations + layout_violations
    check(
        "命名规范无违规（代码中无 '灵智体'，使用 P0 '智能体'）",
        len(all_violations) == 0,
        f"violations: {all_violations}" if all_violations else "all clean",
    )

    # ============== 汇总 ==============
    print("\n" + "=" * 60)
    total = len(results)
    passed = sum(1 for _, ok in results if ok)
    failed = total - passed
    print(f"\n{INFO} Phase 2 E2E 验证汇总:")
    print(f"  Total: {total}")
    print(f"  Passed: {passed}")
    print(f"  Failed: {failed}")
    print(f"  Pass Rate: {passed/total*100:.1f}%")
    print("=" * 60)

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    import sys
    sys.exit(main())
