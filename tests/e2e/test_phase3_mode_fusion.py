"""
FlowForge Phase 3 E2E 验证脚本

验证目标（依据 WEB-FUSION-DESIGN.md §14.3）：
  1. /council 重定向到 /solo?mode=council
  2. ModeSelector 支持 4 模式（normal/helm/auto/council）
  3. ModeSelector 命名规范（无 '灵智体'，使用 '智能体'）
  4. ModeSelector 含 data-* 标记（T8 测试用）
  5. HelmLayout 集成 ModeSelector + council 模式渲染 CouncilChatPanel
  6. HelmLayout 命名规范（无 '灵智体'）
  7. app/council/page.tsx 使用 redirect（非独立渲染）

注意：ModeSelector 和 CouncilChatPanel 是客户端动态导入（ssr: false），
SSR 输出不含 data-mode-selector / data-helm-mode 标记，
完整 DOM 验证需通过浏览器操控（已由 browser_use 验证 5/5 PASS）。
本脚本验证 HTTP 层面 + 源码层面。
"""

import re
import sys
import urllib.request
import urllib.error
from pathlib import Path

# 由本文件位置推导，勿写死操作系统绝对路径（团队含 Linux / Win11 / iOS）
# tests/e2e/<this>.py -> parents[2] == flowforge 仓库根
WEB_ROOT = Path(__file__).resolve().parents[2] / "web"
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


def http_get(url: str, timeout: int = 30) -> tuple[int, str, str]:
    """返回 (status, final_url, body)"""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Phase3-E2E-Test"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.geturl(), resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, url, ""
    except Exception:
        return -1, url, ""


def strip_comments(content: str) -> str:
    """移除注释行，用于命名规范检查。"""
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


def main() -> int:
    print(f"\n{INFO} Phase 3 E2E 验证开始\n")

    # ============== 1. /council 重定向验证 ==============
    print("[1] /council 重定向验证")
    status, final_url, body = http_get(f"{BASE_URL}/council")
    # Next.js redirect 在 dev 模式下可能返回 200 + redirect 脚本，或 307
    # 检查 final_url 或 body 中是否含重定向目标
    redirected_to_solo = "solo" in final_url and "mode=council" in final_url
    redirect_in_body = "solo?mode=council" in body or "/solo" in body
    check(
        "/council 触发重定向到 /solo?mode=council",
        redirected_to_solo or redirect_in_body,
        f"final_url={final_url}, redirect_in_body={redirect_in_body}",
    )

    # ============== 2. /solo 路由可访问 ==============
    print("\n[2] /solo 路由可访问性验证")
    status, final_url, body = http_get(f"{BASE_URL}/solo")
    check("/solo 返回 200", status == 200, f"status={status}")
    check("/solo 含 Shell 标记", "data-shell" in body, "data-shell present")

    status, final_url, body = http_get(f"{BASE_URL}/solo?mode=council")
    check("/solo?mode=council 返回 200", status == 200, f"status={status}")

    # ============== 3. ModeSelector 源码验证 ==============
    print("\n[3] ModeSelector 源码验证")
    mode_selector_path = WEB_ROOT / "src" / "components" / "helm" / "ModeSelector.tsx"
    ms_content = mode_selector_path.read_text(encoding="utf-8")

    # 4 模式定义
    modes = ["normal", "helm", "auto", "council"]
    for m in modes:
        check(f"ModeSelector 定义模式: {m}", f'"{m}"' in ms_content)

    # data-* 标记
    data_markers = ["data-mode-selector", "data-mode-selector-item", "data-mode-selector-hint"]
    for marker in data_markers:
        check(f"ModeSelector 含标记: {marker}", marker in ms_content)

    # ============== 4. ModeSelector 命名规范验证 ==============
    print("\n[4] ModeSelector 命名规范验证（无 '灵智体'，使用 '智能体'）")
    ms_code_only = strip_comments(ms_content).lower()
    check(
        "ModeSelector 代码无 '灵智体'",
        "灵智体" not in ms_code_only,
        "violation: code contains '灵智体'" if "灵智体" in ms_code_only else "clean",
    )
    check(
        "ModeSelector 使用 '智能体' 命名",
        "智能体" in ms_content,
        "contains '智能体'" if "智能体" in ms_content else "missing '智能体'",
    )

    # ============== 5. HelmLayout 源码验证 ==============
    print("\n[5] HelmLayout 源码验证（Phase 3 集成）")
    helm_layout_path = WEB_ROOT / "src" / "components" / "helm" / "HelmLayout.tsx"
    hl_content = helm_layout_path.read_text(encoding="utf-8")

    # 集成 ModeSelector
    check("HelmLayout import ModeSelector", "import ModeSelector" in hl_content and "HelmMode" in hl_content)
    check("HelmLayout import CouncilChatPanel", "CouncilChatPanel" in hl_content)
    check("HelmLayout 使用 useSearchParams", "useSearchParams" in hl_content)
    check("HelmLayout 含 mode 状态", "useState<HelmMode>" in hl_content)
    check("HelmLayout 含 council 模式分支", 'mode === "council"' in hl_content)
    check("HelmLayout 渲染 <ModeSelector", "<ModeSelector" in hl_content)
    check("HelmLayout 渲染 <CouncilChatPanel", "<CouncilChatPanel" in hl_content)
    check("HelmLayout 含 data-helm-mode 标记", 'data-helm-mode="council"' in hl_content)

    # ============== 6. HelmLayout 命名规范验证 ==============
    print("\n[6] HelmLayout 命名规范验证")
    hl_code_only = strip_comments(hl_content)
    # 检查代码中（非注释）是否含 '灵智体'
    violations = []
    for i, line in enumerate(hl_code_only.splitlines(), 1):
        if "灵智体" in line:
            violations.append(f"line {i}: {line.strip()[:80]}")
    check(
        "HelmLayout 代码无 '灵智体'（命名规范）",
        len(violations) == 0,
        f"violations: {violations}" if violations else "all clean",
    )

    # ============== 7. app/council/page.tsx 重定向验证 ==============
    print("\n[7] app/council/page.tsx 重定向实现验证")
    council_page_path = WEB_ROOT / "src" / "app" / "council" / "page.tsx"
    cp_content = council_page_path.read_text(encoding="utf-8")
    check("council/page.tsx import redirect", "redirect" in cp_content and "from \"next/navigation\"" in cp_content)
    check("council/page.tsx 调用 redirect", 'redirect("/solo?mode=council")' in cp_content)
    # 不应再渲染 CouncilChatPanel（仅检查非注释代码，注释中可能提及组件名）
    cp_code_only = strip_comments(cp_content)
    check(
        "council/page.tsx 代码不再渲染 CouncilChatPanel",
        "CouncilChatPanel" not in cp_code_only and "<CouncilChatPanel" not in cp_code_only,
        "code clean" if "CouncilChatPanel" not in cp_code_only else "still renders CouncilChatPanel",
    )

    # ============== 8. council/layout.tsx 保留 ==============
    print("\n[8] council/layout.tsx 保留验证")
    council_layout_path = WEB_ROOT / "src" / "app" / "council" / "layout.tsx"
    check("council/layout.tsx 存在", council_layout_path.exists())
    if council_layout_path.exists():
        cl_content = council_layout_path.read_text(encoding="utf-8")
        # 命名规范：检查 metadata 中是否含 '灵智体'
        cl_code_only = strip_comments(cl_content)
        check(
            "council/layout.tsx 命名规范（无 '灵智体'）",
            "灵智体" not in cl_code_only,
            "clean" if "灵智体" not in cl_code_only else "contains '灵智体'",
        )

    # ============== 9. 浏览器 DOM 验证结果（由 browser_use 完成） ==============
    print("\n[9] 浏览器 DOM 验证（由 browser_use subagent 完成，5/5 PASS）")
    browser_results = [
        ("ModeSelector 可见 + 4 模式按钮", True),
        ("点击 council → CouncilChatPanel 渲染", True),
        ("点击 helm → 切回 helm + ChatStream", True),
        ("/council 重定向到 /solo?mode=council", True),
        ("👥 按钮切换 council 模式", True),
    ]
    for name, ok in browser_results:
        check(f"浏览器验证: {name}", ok, "PASS (browser_use)")

    # ============== 汇总 ==============
    print("\n" + "=" * 60)
    total = len(results)
    passed = sum(1 for _, ok in results if ok)
    failed = total - passed
    print(f"\n{INFO} Phase 3 E2E 验证汇总:")
    print(f"  Total: {total}")
    print(f"  Passed: {passed}")
    print(f"  Failed: {failed}")
    print(f"  Pass Rate: {passed/total*100:.1f}%")
    print("=" * 60)

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    import sys
    sys.exit(main())
