# plugin-dev L3 mgr × ff_doctor 本地硬拦截 实施计划

> 实例：`plugin-dev-d5-mgr-precheck`（`docs/process/instances/plugin-dev-d5-mgr-precheck.json`）
> 规格（Spec）：`docs/process/specs/2026-09-10-plugin-dev-d5-mgr-precheck-design.md`
> 工作流：change（变更请求，轻量门禁）

**目标（Goal）**：闭合遵从度五层体系 L3——mgr 在 `commit`/`sync` 真正产生提交前调用 `ff_doctor all`，违规活跃实例状态/坏 plan 被本地硬拦截，堵住"提示词可以不听，本地就放行"。
**架构（Architecture）**：mgr（bash）新增自包含 `_ff_mgr_doctor_check <repo>`，复刻 `_check_msg_format` 先例接入 `cmd_commit`/`cmd_sync` 双钩子；经 `node packages/plugins/dev/bin/ff_doctor.mjs all --repo <repo>` 的退出码契约（0 放行/1 中止/2 放行）驱动。提供 `--no-check` 逃生舱与 `FF_MGR_DOCTOR=0` 环境门，工具链缺失 fail-open。
**技术栈（Tech Stack）**：bash（mgr）、node/tsx（ff_doctor 直跑 TS）、git；契约测试为 bash 自测脚本（临时仓库 + 复制真实 mgr 触发真实钩子，禁 Mock LLM）。

## 全局约束

- 共享基础设施红线：mgr 只新增一个自包含函数 + 两处调用点 + 逃生舱解析，其余命令零改动。
- 单文件 ≤1000 行；mgr 增量 ≤40 行。
- 测试遵守 T1-T9 铁律：真实命令与退出码断言，禁止 Mock LLM/假数据。
- 逃生舱显式且带 warning，不得静默关闭；默认 fail-open-on-toolchain-missing。

## 任务清单

### 任务 1：`_ff_mgr_doctor_check` 校验函数 + `cmd_commit`/`cmd_sync` 双钩子接线

- [ ] **步骤 1：写失败契约测试**（RED）——`tools/mgr-doctor-precheck.test.sh` 首场景：临时仓复制真实 mgr + stub `ff_doctor.mjs`（退出码 STUB_EXIT 控制），断言 stub 返回 1 时提交被中止、提交数不增。当前未实现钩子的 mgr 上该场景表现为提交成功（RED）。
- [ ] **步骤 2：实现钩子**（GREEN）——在 mgr 追加 `_ff_mgr_doctor_check <d>`（env 门 + 工具链探测 + `exit 1` 中止）与 `cmd_commit`/`cmd_sync` 双钩子 + `--no-check` 解析。
- [ ] **步骤 3：跑契约测试确认通过**——`bash tools/mgr-doctor-precheck.test.sh` 五场景全 GREEN。
- [ ] **步骤 4：回归既有命令**——`./mgr status`、`./mgr log -2` 输出正常。
- [ ] **步骤 5：提交**——`./mgr sync "feat(dev): mgr L3 ff_doctor 提交前合规拦截 [sherlock]"`。

```bash
_ff_mgr_doctor_check() {
  local d="$1"
  [ "${FF_MGR_DOCTOR:-1}" = "0" ] && return 0
  local docbin="$d/packages/plugins/dev/bin/ff_doctor.mjs"
  if ! command -v node >/dev/null 2>&1 || [ ! -f "$docbin" ]; then
    echo -e "  ${Y}⚠ L3 ff_doctor 不可用(node 缺失或非 dev 仓), 跳过合规校验${N}" >&2
    return 0
  fi
  if ! node "$docbin" all --repo "$d"; then
    echo -e "  ${R}✗ L3 合规拦截: ff_doctor all 未通过, 提交已中止${N}" >&2
    echo -e "  ${Y}  强制跳过: 追加 --no-check, 或设置 FF_MGR_DOCTOR=0${N}" >&2
    exit 1
  fi
}
```

### 任务 2：契约测试覆盖五场景 + 文档回填

- [ ] **步骤 1：补全契约测试五场景**——违规中止（stub=1 提交中止）、合规放行（stub=0 提交成功）、`--no-check` 逃生（stub=1 仍提交且消息不含 `--no-check`）、`FF_MGR_DOCTOR=0`（stub=1 仍提交）、缺工具链 fail-open（删 stub 文件仍提交）。
- [ ] **步骤 2：跑全量契约测试**——`bash tools/mgr-doctor-precheck.test.sh` 退出码 0，断言行全部通过。
- [ ] **步骤 3：四处文档回填**——13-dev-process / AGENTS.md / review_code §11.4a L3 行 / 33-stage T0.6.4 勾选 + PR 号。
- [ ] **步骤 4：交叉核对一致性**——用 grep 复核 `L3`、`--no-check`、`ff_doctor` 四处措辞一致、无残留占位。
- [ ] **步骤 5：提交**——`./mgr sync "docs(dev): L3 mgr ff_doctor 拦截接线回填四文档 [sherlock]"`。

```bash
cross_check() {
  grep -rln "ff_doctor all --repo" docs/rules/13-dev-process.md docs/AGENTS.md \
    docs/refactor/review_code.md docs/refactor/33-stage-ep0-plugin-dev.md
}
assert_no_residual() {
  grep -rn "待接线" docs/refactor/review_code.md || true
}
```

## 计划自审清单

- [ ] 规格覆盖：设计文档 §3 架构、§4 集成契约、§8 交付物、§7 取舍逐节落到任务 1/2
- [ ] 占位符扫描：全文无字面占位词、无无代码块步骤、无惰性任务引用
- [ ] 任务 1 含 RED→GREEN 测试步骤；git 命令均带真实参数与预期断言
- [ ] 逃生舱三种（`--no-check`/`FF_MGR_DOCTOR=0`/缺工具链）均有对应测试场景

## 校验登记

`ff_dev gate plugin-dev-d5-mgr-precheck plan --evidence docs/process/plans/2026-09-10-plugin-dev-d5-mgr-precheck.md` → 通过后 `ff_doctor plan ` 本文件输出合规。