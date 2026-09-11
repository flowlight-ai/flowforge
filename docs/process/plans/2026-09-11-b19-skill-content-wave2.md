# plan: B19 技能内容资产二波迁移（wave 2）

> 实例：`b19-skill-content-wave2` ｜ 规格（Spec）：`docs/process/specs/2026-09-11-b19-skill-content-wave2-design.md` ｜ 工作流：change

**目标（Goal）**：按 Q5 裁决把 clowder `cat-cafe-skills` 工程流程域四个核心包（tdd / writing-plans / quality-gate / merge-gate）内容迁入 `packages/forgekin/governance/skills/`，让 framework 能读取。
**架构（Architecture）**：见设计 §2——`skills/` 下追加 4×SKILL.md（原样）+ manifest.yaml 追加 4 路由 + README 追加命名映射/批次登记。框架零改动。
**技术栈（Tech Stack）**：Markdown + YAML 内容资产；vitest 契约测试（真实读文件）。

## 全局约束
- 不改 skill-meta/skill-query；只新增内容 + 测试。
- 命名契约：正式内容仅用官方概念名；README 提供 P0 官方名 + 中文对照映射（wave 1 已登记，本波追加）。

## 任务清单

### 任务 1：迁移工程流程域 4 个核心技能包内容资产

- [ ] **步骤 1：建目录并拷贝 4 包 SKILL.md（原样）**——`packages/forgekin/governance/skills/{tdd,writing-plans,quality-gate,merge-gate}/SKILL.md`，逐字复制源文件后规范化换行符为 LF（wave 1 已确证框架 frontmatter 正则仅匹配 LF）。

```bash
cd packages/forgekin/governance
SRC=/d/software/fl/ex/clowder-ai/cat-cafe-skills
for p in tdd writing-plans quality-gate merge-gate; do
  mkdir -p skills/$p
  cp "$SRC/$p/SKILL.md" "skills/$p/SKILL.md"
done
node -e '
import("node:fs").then(async (fs) => {
  const base = "skills";
  for (const p of ["tdd","writing-plans","quality-gate","merge-gate"]) {
    const f = base + "/" + p + "/SKILL.md";
    const b = fs.readFileSync(f);
    if (b.includes(Buffer.from([0x0d, 0x0a]))) {
      fs.writeFileSync(f, b.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
      console.log("normalized:", p);
    }
  }
});'
```
- 说明：源 SKILL.md 为 CRLF → 规范化 LF（框架 readSkillMeta 正则 `^---\n` 仅匹配 LF，wave 1 已确证）。

- [ ] **步骤 2：manifest.yaml 追加 4 包路由**——在 wave 1 `skills:` map 中追加 tdd / writing-plans / quality-gate / merge-gate，category/description/triggers 来自源 manifest，description 用 `>` 折叠块标量（避免内嵌冒号破坏 YAML）。

```yaml
skills:
  # ...wave 1 既有 4 键保留...
  tdd:
    category: "开发流程"
    description: >
      Red-Green-Refactor for changes with behavior or regression risk.
      Use when: adding observable behavior, fixing a bug, or changing logic not already covered by a precise executable check.
      Not for: pure docs/research, deterministic generated-artifact refreshes, or mechanical changes already covered by an existing checker.
      Output: observed RED (new test or existing failing check) → minimal GREEN → refactor under protection.
    triggers:
      - "写代码"
      - "test first"
      - "TDD"
      - "红绿重构"
  writing-plans:
    category: "开发流程"
    description: >
      将 spec/需求拆分为可执行的分步实施计划。
      Use when: 有 spec 或需求，准备动手前需要拆分步骤。
      Not for: trivial 改动（≤5 行）、已有详细计划。
      Output: 分步实施计划（含 TDD 步骤和检查点）。
    triggers:
      - "写计划"
      - "implementation plan"
      - "拆分步骤"
  quality-gate:
    category: "开发流程"
    description: >
      完成声明前的按需自检：愿景对照 + spec 合规 + 风险匹配验证。
      Use when: 准备对交付作完成声明、需要整理风险匹配的自证。
      Not for: 收到 review 反馈（用 receive-review）、merge（用 merge-gate）。
      Output: Spec 合规报告（含愿景覆盖度）。
    triggers:
      - "开发完了"
      - "准备 review"
      - "自检"
      - "声称完成"
  merge-gate:
    category: "开发流程"
    description: >
      合入 main：按行为 / 数据 / 安全 / 契约 / 不可逆风险选择 targeted 或 full gate，
      并消费有客观触发理由的独立 review source。
      Use when: 选中的 reviewer 放行后准备合入、开 PR 或准备 merge。
      Not for: 开发中、review 未通过、自检未完成。
      Output: PR merged + worktree cleaned。
    triggers:
      - "合入 main"
      - "merge"
      - "准备合入"
      - "开 PR"
      - "cloud review"
      - "gh pr create"
```

- [ ] **步骤 3：README.md 追加 wave 2 命名映射 + 批次登记**——命名映射表追加 4 包 P0 官方名 + 中文对照；登记本波为 wave 2。

```markdown
- 命名映射追加（wave 2）：
  | 目录 id | 官方能力概念名 | 中文对照 |
  |---|---|---|
  | tdd | Test-First Development | 测试驱动开发 |
  | writing-plans | Implementation Planning | 实施计划编写 |
  | quality-gate | Pre-Delivery Self-Gate | 交付前自检门禁 |
  | merge-gate | Merge Governance Gate | 合入治理门禁 |
- 批次登记追加：wave 2（2026-09-11）tdd / writing-plans / quality-gate / merge-gate
```

- [ ] **步骤 4：契约测试**——`governance/tests/b19-skill-content-wave2.spec.ts`：`readSkillMeta` 对 wave 2 4 包返回非空 description/triggers；`parseManifestSkillMeta(skills)` 含 ≥8 键（wave1+wave2）；`querySkill(projectRoot, name, skills)` 对 wave 2 4 包返回 detail。测试真实读文件。

```ts
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseManifestSkillMeta, readSkillMeta } from '../src/skill-meta.ts';
import { querySkill } from '../src/skill-query.ts';

// vitest 从仓库根运行（process.cwd() = flowforge 仓库根）
const skillsSource = resolve(process.cwd(), 'packages/forgekin/governance/skills');
const projectRoot = process.cwd();

const W2 = ['tdd', 'writing-plans', 'quality-gate', 'merge-gate'] as const;

describe('B19 wave2 skill content assets', () => {
  it('readSkillMeta returns non-empty description + triggers for 4 packages', async () => {
    for (const p of W2) {
      const meta = await readSkillMeta(resolve(skillsSource, p));
      expect(meta.description, `${p} description`).toBeTruthy();
      expect(meta.triggers?.length, `${p} triggers`).toBeGreaterThan(0);
    }
  });

  it('parseManifestSkillMeta resolves wave1+wave2 routing keys (>=8)', async () => {
    const map = await parseManifestSkillMeta(skillsSource);
    expect(map.size).toBeGreaterThanOrEqual(8);
    for (const p of W2) {
      expect(map.has(p), p).toBe(true);
      expect(map.get(p)?.category, `${p} category`).toBeTruthy();
    }
  });

  it('querySkill returns non-null detail for wave2 4 packages', async () => {
    for (const p of W2) {
      const detail = await querySkill(projectRoot, p, skillsSource);
      expect(detail, p).not.toBeNull();
      expect(detail?.id, p).toBeTruthy();
    }
  });
});
```

- [ ] **步骤 5：跑契约测试 + tsc + oxlint**——`vitest run`、包级 `tsc -p ... --noEmit`、`oxlint` 全绿（测试通过确认）。
- [ ] **步骤 6：提交**——`./mgr commit "feat(governance): B19 wave2 迁移工程流程 4 核心技能内容资产进 governance/skills [sherlock]"`，随后 `./mgr sync` 推 PR（用户批准后）。

### 任务 2：登记 + 收尾

- [ ] **步骤 1：核对 review_code/record 回落**——B19 行追加"wave 2 已迁移 tdd/writing-plans/quality-gate/merge-gate"；review_code.md / task.md 补登记。

```md
- review_code.md §15 Q5 回落追加：B19 wave 2（2026-09-11）迁移 tdd / writing-plans / quality-gate / merge-gate
  四包进 governance/skills，附 b19-skill-content-wave2.spec.ts 契约测试（3 it）。
```

- [ ] **步骤 2：提交**——`./mgr commit "docs(refactor): B19 wave2 技能内容迁移登记 [sherlock]"`（提交前确认 review_code/task.md 内容核对无误）。

## 计划自审清单
- [ ] 覆盖设计 §6 交付物 1-4 与 §8 DoD 1-5
- [ ] 无占位符；每任务含代码块与测试步骤（.spec. 提示齐备）
- [ ] 契约测试真实读文件

## 校验登记
`ff_dev gate b19-skill-content-wave2 plan --evidence docs/process/plans/2026-09-11-b19-skill-content-wave2.md` → 通过后 `ff_doctor plan` 本文件合规。