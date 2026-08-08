"""
FlowForge Phase 1 E2E 验证脚本

验证目标：
  1. 8 个 vendor CSS 文件可在 /vendor/app/ 路径下访问（HTTP 200）
  2. zustand 已正确安装（package.json + node_modules）
  3. 7 个 stores 文件存在且语法正确
  4. 8 个 Provider 组件文件存在且语法正确
  5. 同步脚本可正常执行
  6. 应用本身仍可访问（无回归）

不验证：
  - layout.tsx 是否引入新 CSS（Phase 2 工作）
  - 浏览器 DOM 是否应用新样式（Phase 2 工作）
  - Store 是否被实际使用（Phase 2-3 工作）
"""

import json
import sys
import urllib.request
import urllib.error
import subprocess
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


def http_get(url: str, timeout: int = 20) -> tuple[int, int]:
    """返回 (status_code, content_length)"""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Phase1-E2E-Test"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, len(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, 0
    except Exception:
        return -1, 0


def strip_comments(content: str) -> str:
    """移除单行注释（// ...）和块注释（* ...）行，用于命名规范检查。
    保留代码标识符，排除注释中的源文件出处引用。"""
    lines = content.splitlines()
    code_lines = []
    for line in lines:
        stripped = line.strip()
        # 跳过块注释行（* 开头）
        if stripped.startswith("*") or stripped.startswith("/*"):
            continue
        # 跳过单行注释行（// 开头）
        if stripped.startswith("//"):
            continue
        # 移除行内尾部注释（// ...）
        if "//" in line:
            line = line.split("//", 1)[0]
        code_lines.append(line)
    return "\n".join(code_lines)


print(f"\n{INFO} Phase 1 E2E 验证开始\n")

# ============== 1. 应用本身可访问（无回归） ==============
print("[1] 应用基础可用性验证")
status, length = http_get(f"{BASE_URL}/")
check("应用首页可访问 (HTTP 200)", status == 200, f"status={status}, length={length}")

# ============== 2. 8 个 vendor CSS 文件可访问 ==============
print("\n[2] Vendor CSS 文件可访问性验证")
expected_css_files = [
    "theme-tokens.css",
    "forgekin-persona-tokens.css",
    "forgekin-persona-derived.css",
    "console-tokens.css",
    "console-shell.css",
    "console-controls.css",
    "connector-tokens.css",
    "theme-extras.css",
]
css_pass_count = 0
for css_file in expected_css_files:
    url = f"{BASE_URL}/vendor/app/{css_file}"
    status, length = http_get(url)
    ok = status == 200 and length > 100
    if ok:
        css_pass_count += 1
    check(f"CSS 可访问: {css_file}", ok, f"status={status}, length={length}")
check(
    f"CSS 文件总数 8/8",
    css_pass_count == 8,
    f"通过 {css_pass_count}/8",
)

# ============== 3. CSS 源文件存在 ==============
print("\n[3] CSS 源文件存在性验证")
for css_file in expected_css_files:
    src_path = WEB_ROOT / "src" / "app" / css_file
    check(
        f"源文件存在: src/app/{css_file}",
        src_path.exists(),
        f"size={src_path.stat().st_size if src_path.exists() else 0}",
    )

# ============== 4. zustand 已安装 ==============
print("\n[4] Zustand 依赖验证")
pkg_json_path = WEB_ROOT / "package.json"
pkg_data = json.loads(pkg_json_path.read_text(encoding="utf-8"))
has_zustand_in_deps = "zustand" in pkg_data.get("dependencies", {})
check("package.json 中包含 zustand 依赖", has_zustand_in_deps)

zustand_module_path = WEB_ROOT / "node_modules" / "zustand" / "package.json"
check(
    "node_modules/zustand 已安装",
    zustand_module_path.exists(),
    f"version={json.loads(zustand_module_path.read_text(encoding='utf-8'))['version'] if zustand_module_path.exists() else 'N/A'}",
)

# ============== 5. 7 个 stores 文件存在 ==============
print("\n[5] Zustand Stores 文件验证")
expected_stores = [
    "sidebarStore.ts",
    "chatStore.ts",
    "helmWorkspaceStore.ts",
    "helmPlanStore.ts",
    "helmEditorStore.ts",
    "helmPanelStore.ts",
    "approvalHubStore.ts",
    "index.ts",
]
stores_pass_count = 0
for store_file in expected_stores:
    store_path = WEB_ROOT / "src" / "stores" / store_file
    exists = store_path.exists()
    if exists:
        stores_pass_count += 1
        # 简单语法检查：必须包含 "create" 关键字（除 index.ts）
        if store_file != "index.ts":
            content = store_path.read_text(encoding="utf-8")
            has_create = "create<" in content or "create(" in content
            check(
                f"Store 文件: src/stores/{store_file}",
                has_create,
                f"size={store_path.stat().st_size}, create keyword: {has_create}",
            )
        else:
            check(f"Index 文件: src/stores/{store_file}", True, f"size={store_path.stat().st_size}")
    else:
        check(f"Store 文件: src/stores/{store_file}", False, "NOT FOUND")
check(f"Stores 文件总数 {len(expected_stores)}/{len(expected_stores)}", stores_pass_count == len(expected_stores), f"通过 {stores_pass_count}/{len(expected_stores)}")

# ============== 6. 8 个 Provider 组件文件存在 ==============
print("\n[6] Provider 组件文件验证")
expected_providers = [
    "SessionBootstrap.tsx",
    "ForgekinHueInjector.tsx",
    "ThemeProvider.tsx",
    "ThemeApplier.tsx",
    "useConfirm.tsx",  # ConfirmProvider
    "ToastContainer.tsx",
    "BrakeModal.tsx",
    "GuideOverlay.tsx",
]
providers_pass_count = 0
for provider_file in expected_providers:
    provider_path = WEB_ROOT / "src" / "components" / provider_file
    exists = provider_path.exists()
    if exists:
        providers_pass_count += 1
        # 简单语法检查：必须包含 "use client" 或 export default
        content = provider_path.read_text(encoding="utf-8")
        has_export = "export" in content
        check(
            f"Provider 文件: src/components/{provider_file}",
            has_export,
            f"size={provider_path.stat().st_size}, has export: {has_export}",
        )
    else:
        check(f"Provider 文件: src/components/{provider_file}", False, "NOT FOUND")
check(f"Provider 文件总数 {len(expected_providers)}/{len(expected_providers)}", providers_pass_count == len(expected_providers), f"通过 {providers_pass_count}/{len(expected_providers)}")

# ============== 7. 同步脚本存在 ==============
print("\n[7] 同步脚本验证")
sync_script_path = WEB_ROOT / "scripts" / "sync-vendor-assets.mjs"
check(
    "同步脚本存在: scripts/sync-vendor-assets.mjs",
    sync_script_path.exists(),
    f"size={sync_script_path.stat().st_size if sync_script_path.exists() else 0}",
)

# package.json 中有 predev 钩子
has_predev = "predev" in pkg_data.get("scripts", {})
check("package.json scripts.predev 已配置", has_predev, f"scripts={list(pkg_data.get('scripts', {}).keys())}")

# ============== 8. 同步脚本可执行 ==============
print("\n[8] 同步脚本执行验证")
try:
    proc = subprocess.run(
        ["node", "scripts/sync-vendor-assets.mjs"],
        cwd=str(WEB_ROOT),
        capture_output=True,
        text=True,
        timeout=15,
    )
    sync_ok = proc.returncode == 0 and "sync-vendor-assets" in proc.stdout
    check(
        "同步脚本可正常执行",
        sync_ok,
        f"exit_code={proc.returncode}, output_lines={len(proc.stdout.splitlines())}",
    )
except Exception as e:
    check("同步脚本可正常执行", False, f"exception: {e}")

# ============== 9. public/vendor/app 下有 8 个 CSS ==============
print("\n[9] Public Vendor 目录验证")
public_vendor_path = WEB_ROOT / "public" / "vendor" / "app"
if public_vendor_path.exists():
    actual_css = sorted([f.name for f in public_vendor_path.glob("*.css")])
    expected_css_sorted = sorted(expected_css_files)
    check(
        "public/vendor/app 下 CSS 文件齐全",
        actual_css == expected_css_sorted,
        f"actual={actual_css}, expected={expected_css_sorted}",
    )
else:
    check("public/vendor/app 目录存在", False, "NOT FOUND")

# ============== 10. 命名规范验证（P0/P1，无 P2 别名） ==============
print("\n[10] 命名规范验证（依据 naming-contract.md）")
naming_violations = []
# 仅检查代码标识符，排除注释中的源文件出处引用（如 "来源：clowder-ai/..."）
for store_file in expected_stores:
    store_path = WEB_ROOT / "src" / "stores" / store_file
    if store_path.exists():
        content = store_path.read_text(encoding="utf-8")
        code_only = strip_comments(content).lower()
        # 不应包含 clowder / cat-cafe / cat-persona 字样（仅检查非注释代码）
        for bad in ["clowder", "cat-cafe", "cat-persona"]:
            if bad in code_only:
                naming_violations.append(f"{store_file}: code contains '{bad}'")

for provider_file in expected_providers:
    provider_path = WEB_ROOT / "src" / "components" / provider_file
    if provider_path.exists():
        content = provider_path.read_text(encoding="utf-8")
        code_only = strip_comments(content).lower()
        for bad in ["clowder", "cat-cafe"]:
            if bad in code_only:
                naming_violations.append(f"{provider_file}: code contains '{bad}'")

check(
    "命名规范无违规（代码无 clowder/cat-cafe/cat-persona，注释中出处引用允许）",
    len(naming_violations) == 0,
    f"violations: {naming_violations}" if naming_violations else "all clean",
)

# ============== 汇总 ==============
print("\n" + "=" * 60)
total = len(results)
passed = sum(1 for _, ok in results if ok)
failed = total - passed
print(f"\n{INFO} Phase 1 E2E 验证汇总:")
print(f"  Total: {total}")
print(f"  Passed: {passed}")
print(f"  Failed: {failed}")
print(f"  Pass Rate: {passed/total*100:.1f}%")
print("=" * 60)

sys.exit(0 if failed == 0 else 1)
