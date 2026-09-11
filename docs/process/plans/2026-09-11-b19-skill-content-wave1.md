# plan: B19 技能内容资产首波迁移（wave 1）

> 实例：`b19-skill-content-wave1` ｜ 规格（Spec）：`docs/process/specs/2026-09-11-b19-skill-content-wave1-design.md` ｜ 工作流：change

**目标（Goal）**：按 Q5 裁决把 clowder `cat-cafe-skills` 四个核心包（deep-research/expert-panel/cross-cat-handoff/debugging）内容迁入 `packages/forgekin/governance/skills/` 作为技能内容源，让 framework 能读取。
**架构（Architecture）**：见设计 §2——`skills/` 下 4×SKILL.md（原样）+ manifest.yaml（4 路由）+ README（命名映射）。框架零改动。
**技术栈（Tech Stack）**：Markdown + YAML 内容资产；vitest 契约测试（真实读文件）。

## 全局约束
- 不改 skill-meta/skill-query；只新增内容 + 测试。
- 命名契约：本目录正式内容仅用官方概念名；README 提供 P0 官方名 + 中文对照映射。

## 任务清单

### 任务 1：迁移 4 个核心技能包内容资产

- [ ] **步骤 1：建目录并拷贝 4 包 SKILL.md（原样）**——`packages/forgekin/governance/skills/{deep-research,expert-panel,cross-cat-handoff,debugging}/SKILL.md`，逐字复制源文件，不修改 frontmatter。

```bash
cd packages/forgekin/governance
SKILLS=skills
SRC=/d/software/fl/ex/clowder-ai/cat-cafe-skills
for p in deep-research expert-panel cross-cat-handoff debugging; do
  mkdir -p $SKILLS/$p
  cp "$SRC/$p/SKILL.md" "$SKILLS/$p/SKILL.md"
done
```

- [ ] **步骤 2：写 manifest.yaml（4 包路由）**——`skills:` 顶层键，每包 category/description/triggers 来自源 manifest，对齐 `parseManifestSkillMeta` 消费面。

```yaml
skills:
  deep-research:
    category: "开发流程"
    description: "多源深度调研管道（Web Deep Research + Coder 合成 + 云端模型咨询）。"
    triggers: ["调研", "research", "深度研究", "问一下 GPT Pro", "咨询云端"]
  expert-panel:
    category: "专家协作"
    description: "多猫专家辩论团：轻量编排 + WHY 链标准 + 交付链。"
    triggers: ["专家辩论", "expert panel", "技术参谋", "竞品分析", "行业分析", "趋势判断", "多猫分析"]
  cross-cat-handoff:
    category: "交接协作"
    description: "跨猫交接与 review 双路由。"
    triggers: ["交接", "传话", "handoff", "fallback", "下一棒", "exact-HEAD review", "PR tracking", "advisory_read_only"]
  debugging:
    category: "调试"
    description: "系统化 bug 定位：根因调查 → 模式分析 → 假设验证 → 修复。"
    triggers: ["bug", "报错", "test failure", "unexpected behavior"]
```

- [ ] **步骤 3：写 README.md（目录约定 + 命名映射 + 批次登记）**——含 4 包 P0 官方名 + 中文对照，登记本波为 wave 1。

```markdown
skills/ —— governance 技能内容源（wave 1）

- 目录约定：每包一个 `<kebab-case-id>/SKILL.md`；路由元数据集中在 `manifest.yaml`。
- 命名映射（P0 官方名锚定）：
  | 目录 id | 官方能力概念名 | 中文对照 |
  |---|---|---|
  | deep-research | Deep Research | 深度调研 |
  | expert-panel | Expert Panel | 专家评审团 |
  | cross-cat-handoff | Cross-cat Handoff | 跨智能体交接 |
  | debugging | Systematic Debugging | 系统化调试 |
- 批次登记：wave 1（2026-09-11）deep-research / expert-panel / cross-cat-handoff / debugging
```

- [ ] **步骤 4：契约测试**——`governance/tests/b19-skill-content.spec.ts`：`readSkillMeta` 对 4 包返回非空 description/triggers；`parseManifestSkillMeta(skills)` 含 4 键；`querySkill(projectRoot, name, skills)` 返回 detail。测试真实读文件。

```ts
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { readSkillMeta, parseManifestSkillMeta } from '../src/skill-meta.js';
import { querySkill } from '../src/skill-query.js';

const skillsSrc = resolve(__dirname, '../skills');

describe('B19 wave1 skill content', () => {
  const pkgs = ['deep-research', 'expert-panel', 'cross-cat-handoff', 'debugging'] as const;

  it('readSkillMeta reads non-empty description+triggers for 4 packages', async () => {
    for (const p of pkgs) {
      const meta = await readSkillMeta(resolve(skillsSrc, p));
      expect(meta.description, p).toBeTruthy();
      expect(meta.triggers?.length, p).toBeGreaterThan(0);
    }
  });

  it('parseManifestSkillMeta resolves 4 keys', async () => {
    const map = await parseManifestSkillMeta(skillsSrc);
    for (const p of pkgs) expect(map.has(p)).toBe(true);
  });

  it('querySkill returns detail for 4 packages', async () => {
    for (const p of pkgs) {
      const detail = await querySkill(process.cwd(), p, skillsSrc);
      expect(detail, p).not.toBeNull();
    }
  });
});
```

- [ ] **步骤 5：跑契约测试 + tsc + oxlint**——`vitest run`、包级 `tsc -p . --noEmit`、`oxlint` 全绿（测试通过确认）。
- [ ] **步骤 6：提交**——`./mgr sync "feat(governance): B19 wave1 迁移 4 核心技能内容资产进 governance/skills [sherlock]"`。

### 任务 2：登记 + 收尾

- [ ] **步骤 1：核对 review_code/record 回落**——B19 行补"wave1 已迁移 4 包"；34-stage 或 task.md 补登记。

```md
- review_code.md §15 Q5 回落：B19 技能内容 QR 首波 wave1 已迁移 deep-research/expert-panel/cross-cat-handoff/debugging
  四包进 governance/skills，并附 b19-skill-content.spec.ts 契约测试（3 it 覆盖 readSkillMeta / parseManifestSkillMeta / querySkill）。
```

- [ ] **步骤 2：提交**——`./mgr sync "docs(refactor): B19 wave1 技能内容迁移登记 [sherlock]"`（提交前确认 review_code/task.md 内容核对无误）。

## 计划自审清单
- [ ] 覆盖设计 §6 交付物 1-4 与 §8 DoD 1-5
- [ ] 无占位符；每任务含代码块与测试步骤（tests/·.spec. 提示齐备）
- [ ] 契约测试真实读文件

## 校验登记
`ff_dev gate b19-skill-content-wave1 plan --evidence docs/process/plans/2026-09-11-b19-skill-content-wave1.md` → 通过后 `ff_doctor plan` 本文件合规。