#!/usr/bin/env bash
# ============================================================================
#  mgr L3 ff_doctor 前置合规拦截 —— 契约测试（D5 批次，docs/refactor/33-stage T0.6.4）
#
#  用真实 mgr（复制到临时仓）触发真实 `_ff_mgr_doctor_check` 钩子，stub
#  ff_doctor.mjs 用退出码驱动五场景，禁 Mock LLM（T1）。
#  运行：bash tools/mgr-doctor-precheck.test.sh
# ============================================================================
set -u

MGR="$(cd "$(dirname "$0")/.." && pwd)/mgr"
if [ ! -f "$MGR" ]; then echo "[FAIL] 未找到 mgr: $MGR"; exit 1; fi

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

# 建立临时 mgr 仓库：复制真实 mgr + stub ff_doctor，回到 git 种子提交
make_harness() {
  root="$1"; stub_exit="${2:-0}"
  rm -rf "$root"
  mkdir -p "$root/flowlight/harnessrepo/packages/plugins/dev/bin"
  cp "$MGR" "$root/flowlight/harnessrepo/mgr"
  printf '#!/usr/bin/env node\nprocess.exit(Number(process.env.STUB_EXIT||0))\n' \
    > "$root/flowlight/harnessrepo/packages/plugins/dev/bin/ff_doctor.mjs"
  git -C "$root/flowlight/harnessrepo" init -q
  git -C "$root/flowlight/harnessrepo" config user.email t@t
  git -C "$root/flowlight/harnessrepo" config user.name t
  echo seed > "$root/flowlight/harnessrepo/a.txt"
  git -C "$root/flowlight/harnessrepo" add -A
  git -C "$root/flowlight/harnessrepo" commit -qm "chore(x): seed [sherlock]"
}

heads() { git -C "$1" rev-list --count HEAD 2>/dev/null || echo 0; }

echo "── 场景 1/5：违规中止（stub=1）──"
r=$(mktemp -d); make_harness "$r" 1
echo second >> "$r/flowlight/harnessrepo/a.txt"
git -C "$r/flowlight/harnessrepo" add a.txt
before=$(heads "$r/flowlight/harnessrepo")
STUB_EXIT=1 bash "$r/flowlight/harnessrepo/mgr" commit "chore(y): b [sherlock]" >/dev/null 2>&1
ec=$?
after=$(heads "$r/flowlight/harnessrepo")
[ "$ec" -ne 0 ] && [ "$before" = "$after" ] && ok "stub=1 → mgr 中止($ec)，未新增提交($before→$after)" \
  || bad "stub=1 → 期望中止且提交数不变，got exit=$ec before=$before after=$after"
rm -rf "$r"

echo "── 场景 2/5：合规放行（stub=0）──"
r=$(mktemp -d); make_harness "$r" 0
echo second >> "$r/flowlight/harnessrepo/a.txt"
git -C "$r/flowlight/harnessrepo" add a.txt
before=$(heads "$r/flowlight/harnessrepo")
STUB_EXIT=0 bash "$r/flowlight/harnessrepo/mgr" commit "chore(y): b [sherlock]" >/dev/null 2>&1
ec=$?
after=$(heads "$r/flowlight/harnessrepo")
[ "$ec" -eq 0 ] && [ "$after" -eq $((before+1)) ] && ok "stub=0 → 提交成功($before→$after)" \
  || bad "stub=0 → 期望提交成功+1，got exit=$ec before=$before after=$after"
rm -rf "$r"

echo "── 场景 3/5：--no-check 逃生舱（stub=1 仍提交，消息不含标识）──"
r=$(mktemp -d); make_harness "$r" 1
echo second >> "$r/flowlight/harnessrepo/a.txt"
git -C "$r/flowlight/harnessrepo" add a.txt
before=$(heads "$r/flowlight/harnessrepo")
STUB_EXIT=1 bash "$r/flowlight/harnessrepo/mgr" commit --no-check "chore(y): b [sherlock]" >/dev/null 2>&1
ec=$?
after=$(heads "$r/flowlight/harnessrepo")
msg=$(git -C "$r/flowlight/harnessrepo" log -1 --format=%s)
case "$msg" in *no-check*) leak=1;; *) leak=0;; esac
[ "$ec" -eq 0 ] && [ "$after" -eq $((before+1)) ] && [ "$leak" = 0 ] \
  && ok "--no-check → 提交成功($before→$after)，消息='$msg' 无泄漏" \
  || bad "--no-check → 期望提交成功且措辞无泄漏，got exit=$ec before=$before after=$after msg='$msg' leak=$leak"
rm -rf "$r"

echo "── 场景 4/5：FF_MGR_DOCTOR=0 环境门（stub=1 仍提交）──"
r=$(mktemp -d); make_harness "$r" 1
echo second >> "$r/flowlight/harnessrepo/a.txt"
git -C "$r/flowlight/harnessrepo" add a.txt
before=$(heads "$r/flowlight/harnessrepo")
STUB_EXIT=1 FF_MGR_DOCTOR=0 bash "$r/flowlight/harnessrepo/mgr" commit "chore(y): b [sherlock]" >/dev/null 2>&1
ec=$?
after=$(heads "$r/flowlight/harnessrepo")
[ "$ec" -eq 0 ] && [ "$after" -eq $((before+1)) ] && ok "FF_MGR_DOCTOR=0 → 提交成功($before→$after)" \
  || bad "FF_MGR_DOCTOR=0 → 期望提交成功，got exit=$ec before=$before after=$after"
rm -rf "$r"

echo "── 场景 5/5：工具链缺失 fail-open（删 stub 仍提交并出 warning）──"
r=$(mktemp -d); make_harness "$r" 1
rm "$r/flowlight/harnessrepo/packages/plugins/dev/bin/ff_doctor.mjs"
echo second >> "$r/flowlight/harnessrepo/a.txt"
git -C "$r/flowlight/harnessrepo" add a.txt
before=$(heads "$r/flowlight/harnessrepo")
out=$(STUB_EXIT=1 bash "$r/flowlight/harnessrepo/mgr" commit "chore(y): b [sherlock]" 2>&1)
ec=$?
after=$(heads "$r/flowlight/harnessrepo")
warned=0; case "$out" in *跳过合规校验*) warned=1;; esac
[ "$ec" -eq 0 ] && [ "$after" -eq $((before+1)) ] && [ "$warned" = 1 ] \
  && ok "缺工具链 → 提交成功($before→$after) 且输出 warning" \
  || bad "缺工具链 → 期望 fail-open + warning，got exit=$ec before=$before after=$after warned=$warned; out=$out"
rm -rf "$r"

echo ""
echo "=========================================="
echo "结果：$PASS 通过 / $FAIL 失败"
[ "$FAIL" -eq 0 ] || { echo "存在失败场景"; exit 1; }
echo "全部契约测试通过 ✅"