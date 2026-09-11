# plan: B19 技能内容资产三波迁移（wave 3）

> 实例：`b19-skill-content-wave3` ｜ 规格（Spec）：`docs/process/specs/2026-09-11-b19-skill-content-wave3-design.md` ｜ 工作流：change

**目标（Goal）**：按 Q5 裁决把 clowder `cat-cafe-skills` 评审与协作域四个核心包（fresh-context-review / request-review / receive-review / receive-handoff-grounding）内容迁入 `packages/forgekin/governance/skills/`，让 framework 能读取，并与 wave 2 的 quality-gate/merge-gate 构成评审反馈环。
**架构（Architecture）**：见设计 §2——`skills/` 下追加 4×SKILL.md（原样）+ manifest.yaml 追加 4 路由 + README 追加命名映射/批次登记。框架零改动。
**技术栈（Tech Stack）**：Markdown + YAML 内容资产；vitest 契约测试（真实读文件）。

## 全局约束
- 不改 skill-meta/skill-query；只新增内容 + 测试。
- 命名契约：正式内容仅用官方概念名；README 提供 P0 官方名 + 中文对照映射（wave 1/2 已登记，本波追加）。

## 任务清单

### 任务 1：迁移评审与协作域 4 个核心技能包内容资产

- [ ] **步骤 1：建目录并拷贝 4 包 SKILL.md（原样）**——`packages/forgekin/governance/skills/{fresh-context-review,request-review,receive-review,receive-handoff-grounding}/SKILL.md`，逐字复制源文件后规范化换行符为 LF（wave 1/2 已确证框架 frontmatter 正则仅匹配 LF）。

```bash
cd packages/forgekin/governance
SRC=/d/software/fl/ex/clowder-ai/cat-cafe-skills
for p in fresh-context-review request-review receive-review receive-handoff-grounding; do
  mkdir -p skills/$p
  cp "$SRC/$p/SKILL.md" "skills/$p/SKILL.md"
done
node -e '
import("node:fs").then(async (fs) => {
  const base = "skills";
  for (const p of ["fresh-context-review","request-review","receive-review","receive-handoff-grounding"]) {
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

- [ ] **步骤 2：manifest.yaml 追加 4 包路由**——在 wave 1+2 `skills:` map 中追加自家 4 包，category/description/triggers 来自源 manifest，description 用 `>` 折叠块标量（避免内嵌冒号破坏 YAML）。`receive-handoff-grounding` 源分类「协作/防御」归入协作域。

```yaml
skills:
  # ...wave 1 4 键 + wave 2 4 键保留...
  fresh-context-review:
    category: "开发流程"
    description: >
      Author-triggered fresh-context scan of PR diff.
      Finding generator, NOT approval authority.
      Use when: quality-gate 通过且 PR 非 trivial，想降低正式 reviewer 认知负荷。
      Not for: 正式 review verdict、approval、merge decision。
      Output: Finding list（附在 review request 中）。
    triggers:
      - "fresh context"
      - "pre-review scan"
      - "找新眼看看"
  request-review:
    category: "开发流程"
    description: >
      Route a change to a non-author local peer when local review is the selected independent validation source.
      Use when: risk routing chooses a stateful local reviewer for implementation, governance, or semantic context.
      Not for: cloud as the selected source, vision-guardian acceptance, self-check, or review feedback handling.
      Output: risk-matched review packet + provenance-matched verdict route; mailbox archive only when the change needs the full packet.
    triggers:
      - "请 review"
      - "帮我看看"
      - "request review"
  receive-review:
    category: "开发流程"
    description: >
      处理 reviewer 反馈：Red→Green 修复 + 技术论证（禁止表演性同意）。
      Use when: 收到 review 结果、reviewer 提了 P1/P2、需要处理反馈。
      Not for: 发 review 请求（用 request-review）、自检（用 quality-gate）。
      Output: 逐项修复确认 + reviewer 放行。
    triggers:
      - "review 结果"
      - "review 意见"
      - "reviewer 说"
      - "fix these"
  receive-handoff-grounding:
    category: "协作 / 防御"
    description: >
      接球前真相核验三问：claim → resolver → verdict (sourceTier T0/T1/T2 + actionFamily)，
      防止把传球者当无审视真相源 (F167 Phase O 第一性原理)。
      Use when: 即将调 hold_ball / register_pr_tracking / register_issue_tracking /
      merge / takeover / 改 owner / 任何 irreversible action / 基于 "operator signoff" 或
      "你是 owner" 类 claim 行动之前。
      Not for: 纯阅读 cross_post (无 actionFamily 后续)、本 thread 日常 @mention 无副作用、
      implementation continuation (自检通过的下一步)。
      Output: Claim grounding verdict (verified/mismatch/insufficient) + 接球决策
      (proceed / block / push back to source thread)。
    triggers:
      - "hold_ball"
      - "register_pr_tracking"
      - "register_issue_tracking"
      - "merge approval"
      - "operator signoff"
      - "takeover"
      - "irreversible"
      - "owner reassignment"
      - "这是你的"
      - "应该是你接"
      - "operator 同意"
      - "等 X"
      - "PR 在"
```

- [ ] **步骤 3：README.md 追加 wave 3 命名映射 + 批次登记**——命名映射表追加 4 包 P0 官方名 + 中文对照；登记本波为 wave 3。

```markdown
- 命名映射追加（wave 3）：
  | 目录 id | 官方能力概念名 | 中文对照 |
  |---|---|---|
  | fresh-context-review | Fresh-Context Pre-Review | 新语境评审前置扫描 |
  | request-review | Review Request Routing | 评审请求路由 |
  | receive-review | Review Feedback Processing | 评审反馈处理 |
  | receive-handoff-grounding | Handoff Claim Grounding | 交接声明核验 |
- 批次登记追加：wave 3（2026-09-11）fresh-context-review / request-review / receive-review / receive-handoff-grounding
```

- [ ] **步骤 4：契约测试**——`governance/tests/b19-skill-content-wave3.spec.ts`：`readSkillMeta` 对 wave 3 4 包返回非空 description/triggers；`parseManifestSkillMeta(skills)` 含 ≥12 键（wave1+wave2+wave3）；`querySkill(projectRoot, name, skills)` 对 wave 3 4 包返回 detail。测试真实读文件。

```ts
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseManifestSkillMeta, readSkillMeta } from '../src/skill-meta.ts';
import { querySkill } from '../src/skill-query.ts';

// vitest 从仓库根运行（process.cwd() = flowforge 仓库根）
const skillsSource = resolve(process.cwd(), 'packages/forgekin/governance/skills');
const projectRoot = process.cwd();

const W3 = ['fresh-context-review', 'request-review', 'receive-review', 'receive-handoff-grounding'] as const;

describe('B19 wave3 skill content assets', () => {
  it('readSkillMeta returns non-empty description + triggers for 4 packages', async () => {
    for (const p of W3) {
      const meta = await readSkillMeta(resolve(skillsSource, p));
      expect(meta.description, `${p} description`).toBeTruthy();
      expect(meta.triggers?.length, `${p} triggers`).toBeGreaterThan(0);
    }
  });

  it('parseManifestSkillMeta resolves wave1+wave2+wave3 routing keys (>=12)', async () => {
    const map = await parseManifestSkillMeta(skillsSource);
    expect(map.size).toBeGreaterThanOrEqual(12);
    for (const p of W3) {
      expect(map.has(p), p).toBe(true);
      expect(map.get(p)?.category, `${p} category`).toBeTruthy();
    }
  });

  it('querySkill returns non-null detail for wave3 4 packages', async () => {
    for (const p of W3) {
      const detail = await querySkill(projectRoot, p, skillsSource);
      expect(detail, p).not.toBeNull();
      expect(detail?.id, p).toBeTruthy();
    }
  });
});
```

- [ ] **步骤 5：跑契约测试 + tsc + oxlint**——`vitest run`、包级 `tsc -p ... --noEmit`、`oxlint` 全绿（测试通过确认）。
- [ ] **步骤 6：提交**——`./mgr commit "feat(governance): B19 wave3 迁移评审与协作域 4 核心技能内容资产进 governance/skills [sherlock]"`，随后 push 累加 PR（用户批准后）。

### 任务 2：登记 + 收尾

- [ ] **步骤 1：核对 review_code/record 回落**——B19 行追加"wave 3 已迁移 fresh-context-review/request-review/receive-review/receive-handoff-grounding"；review_code.md / task.md 补登记。

```md
- review_code.md §15 B19 回落追加：B19 wave 3（2026-09-11）迁移 fresh-context-review / request-review /
  receive-review / receive-handoff-grounding 四包进 governance/skills（manifest 扩至 12 键），
  附 b19-skill-content-wave3.spec.ts 契约测试（3 it）。
```

- [ ] **步骤 2：提交**——`./mgr commit "docs(refactor): B19 wave3 技能内容迁移登记 [sherlock]"`（提交前确认 review_code/task.md 内容核对无误）。

## 计划自审清单
- [ ] 覆盖设计 §6 交付物 1-4 与 §8 DoD 1-5
- [ ] 无占位符；每任务含代码块与测试步骤（.spec. 提示齐备）
- [ ] 契约测试真实读文件

## 校验登记
`ff_dev gate b19-skill-content-wave3 plan --evidence docs/process/plans/2026-09-11-b19-skill-content-wave3.md` → 通过后 `ff_doctor plan` 本文件合规。