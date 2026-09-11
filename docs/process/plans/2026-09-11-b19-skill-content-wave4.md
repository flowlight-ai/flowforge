# plan: B19 技能内容资产四波迁移（wave 4）

> 实例：`b19-skill-content-wave4` ｜ 规格（Spec）：`docs/process/specs/2026-09-11-b19-skill-content-wave4-design.md` ｜ 工作流：change

**目标（Goal）**：按 Q5 裁决把 clowder `cat-cafe-skills` 协作与编排域四个核心包（thread-orchestration / cross-thread-sync / collaborative-thinking / custody-recognition）内容迁入 `packages/forgekin/governance/skills/`，让框架能读取。
**架构（Architecture）**：见设计 §2——`skills/` 下追加 4×SKILL.md（原样）+ manifest.yaml 追加 4 路由 + README 追加命名映射/批次登记。框架零改动。
**技术栈（Tech Stack）**：Markdown + YAML 内容资产；vitest 契约测试（真实读文件）。

## 全局约束
- 不改 skill-meta/skill-query；只新增内容 + 测试。
- 命名契约：正式内容仅用官方概念名；README 提供 P0 官方名 + 中文对照映射。
- 源 SKILL.md 为 CRLF → 规范化 LF（框架 frontmatter 正则仅匹配 LF）。

## 任务清单

### 任务 1：迁移协作与编排域 4 个核心技能包内容资产

- [ ] **步骤 1：建目录并拷贝 4 包 SKILL.md（原样）**——`packages/forgekin/governance/skills/{thread-orchestration,cross-thread-sync,collaborative-thinking,custody-recognition}/SKILL.md`，逐字复制源文件后规范化换行符为 LF。

```bash
cd packages/forgekin/governance
SRC=/d/software/fl/ex/clowder-ai/cat-cafe-skills
for p in thread-orchestration cross-thread-sync collaborative-thinking custody-recognition; do
  mkdir -p skills/$p
  cp "$SRC/$p/SKILL.md" "skills/$p/SKILL.md"
done
node -e '
import("node:fs").then(async (fs) => {
  const base = "skills";
  for (const p of ["thread-orchestration","cross-thread-sync","collaborative-thinking","custody-recognition"]) {
    const f = base + "/" + p + "/SKILL.md";
    const b = fs.readFileSync(f);
    if (b.includes(Buffer.from([0x0d, 0x0a]))) {
      fs.writeFileSync(f, b.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
      console.log("normalized:", p);
    }
  }
});'
```
（规范化 CRLF -> LF，框架 readSkillMeta 正则 `^---\n` 仅匹配 LF）
- 说明：wave 1/2/3 已验证本做法可被框架 `readSkillMeta` 正确解析。

- [ ] **步骤 2：manifest.yaml 追加 4 包路由**——在 wave 1+2+3 `skills:` map 中追加自家 4 包，category/description/triggers 来自源 manifest，description 含多行用 `>` 折叠块标量（避免内嵌冒号破坏 YAML）。`custody-recognition` 源分类「开发流程」保留，其余三包归「引导与协作」。

```yaml
skills:
  # ...wave 1 4 键 + wave 2 4 键 + wave 3 4 键保留...
  thread-orchestration:
    category: "引导与协作"
    description: >
      大任务的主动拆解与多 thread 并行编排。
      Use when: 任务涉及 2+ 个独立可交付子任务，需要不同猫参与、不同 thread 并行推进。
      Not for: 单一任务（直接做）、已有 thread 之间的被动协调（用 cross-thread-sync）、
      单 session 内 subagent 并行（CLI 内置能力）。
      Output: 子 thread 创建 + 选猫 + 各 thread 交付 + 主 thread 汇聚报告。
      GOTCHA: projectPath 是子 thread 的工作区/真相源归属，不是外部目标仓。
    triggers:
      - "拆任务"
      - "分 thread"
      - "并行推进"
      - "开多个 thread"
      - "thread orchestration"
      - "任务分解"
  cross-thread-sync:
    category: "引导与协作"
    description: >
      跨 thread 协同：发现平行 session → 通知（3+2 件套）→ 争用协调 → 确认。
      Use when: 平行 session 之间需要协同、收到跨线程消息、通知改动影响、共享文件争用。
      Not for: 跨猫工作交接（用 cross-cat-handoff）。
      GOTCHA: 收到跨线程 ACTION 不等于接活；先做 thread/feat ownership gate，不属于当前 thread 就 cross-post 退回。
      Output: cross-post 通知 + 争用协调完成。
    triggers:
      - "跨线程"
      - "平行 session"
      - "cross thread"
      - "共享文件争用"
  collaborative-thinking:
    category: "引导与协作"
    description: >
      单人或多猫的创意探索、独立思考、讨论收敛。
      Use when: brainstorm、多猫独立思考、讨论结束需要收敛、方向性问题需要多视角。
      Not for: 已有明确 spec 直接写代码、单猫执行已定方案。
      Output: 收敛报告（共识/分歧/行动项）+ 三件套沉淀检查。
    triggers:
      - "brainstorm"
      - "讨论"
      - "多猫独立思考"
      - "收敛"
  custody-recognition:
    category: "开发流程"
    description: >
      识别他人是否委托工作（custody offer）：abstain / admit / offer / retry。
      Use when: 某个来源可能委托工作、期待接球、后续跟踪、别忘记做某事。
      Not for: 随口提及、终盘 offer、泛化计划、Schedule / Needs Me。
      Output: abstain / admit / offer / retry 决策。
    triggers:
      - "帮我接住"
      - "帮我跟踪"
      - "之后要做"
      - "别忘了"
      - "custody offer"
```

- [ ] **步骤 3：README.md 追加 wave 4 命名映射 + 批次登记**——命名映射表追加 4 包 P0 官方名 + 中文对照；登记本波为 wave 4。

```markdown
- 命名映射追加（wave 4）：
  | 目录 id | 官方能力概念名 | 中文对照 |
  |---|---|---|
  | thread-orchestration | Multi-Thread Orchestration | 多线程编排 |
  | cross-thread-sync | Cross-Thread Coordination | 跨线程协同 |
  | collaborative-thinking | Collaborative Deliberation | 协作思辨收敛 |
  | custody-recognition | Custody Acceptance | 接球权识别 |
- 批次登记追加：wave 4（2026-09-11）thread-orchestration / cross-thread-sync / collaborative-thinking / custody-recognition
```

- [ ] **步骤 4：契约测试**——`governance/tests/b19-skill-content-wave4.spec.ts`：`readSkillMeta` 对 wave 4 4 包返回非空 description/triggers；`parseManifestSkillMeta(skills)` 含 ≥16 键（wave1+wave2+wave3+wave4）；`querySkill(projectRoot, name, skills)` 对 wave 4 4 包返回 detail。测试真实读文件。测试文件与 wave1/2/3 同构（见 wave3 计划步骤 4 模板，W3 换为 W4 四包）。

```ts
// governance/tests/b19-skill-content-wave4.spec.ts
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseManifestSkillMeta, readSkillMeta } from '../src/skill-meta.ts';
import { querySkill } from '../src/skill-query.ts';

const skillsSource = resolve(process.cwd(), 'packages/forgekin/governance/skills');
const projectRoot = process.cwd();
const W4 = ['thread-orchestration', 'cross-thread-sync', 'collaborative-thinking', 'custody-recognition'] as const;

describe('B19 wave4 skill content assets', () => {
  it('readSkillMeta returns non-empty description + triggers for 4 packages', async () => {
    for (const p of W4) {
      const meta = await readSkillMeta(resolve(skillsSource, p));
      expect(meta.description, `${p} description`).toBeTruthy();
      expect(meta.triggers?.length, `${p} triggers`).toBeGreaterThan(0);
    }
  });

  it('parseManifestSkillMeta resolves wave1+wave2+wave3+wave4 routing keys (>=16)', async () => {
    const map = await parseManifestSkillMeta(skillsSource);
    expect(map.size).toBeGreaterThanOrEqual(16);
    for (const p of W4) {
      expect(map.has(p), p).toBe(true);
      expect(map.get(p)?.category, `${p} category`).toBeTruthy();
    }
  });

  it('querySkill returns non-null detail for wave4 4 packages', async () => {
    for (const p of W4) {
      const detail = await querySkill(projectRoot, p, skillsSource);
      expect(detail, p).not.toBeNull();
      expect(detail?.id, p).toBeTruthy();
    }
  });
});
```

- [ ] **步骤 5：跑契约测试 + tsc + oxlint**——`vitest run`、包级 `tsc -p ... --noEmit`、`oxlint` 全绿（测试通过确认）。
- [ ] **步骤 6：提交**——`./mgr commit "feat(governance): B19 wave4 迁移协作与编排域 4 核心技能内容资产进 governance/skills [sherlock]"`，随后 push 累加 PR（用户批准后）。

### 任务 2：登记 + 收尾

- [ ] **步骤 1：核对 review_code/record 回落**——B19 行追加"wave 4 已迁移 thread-orchestration/cross-thread-sync/collaborative-thinking/custody-recognition"；review_code.md / task.md 补登记。

```md
- review_code.md §15 B19 回落追加：B19 wave 4（2026-09-11）迁移 thread-orchestration / cross-thread-sync /
  collaborative-thinking / custody-recognition 四包进 governance/skills（manifest 扩至 16 键），
  附 b19-skill-content-wave4.spec.ts 契约测试。
```

- [ ] **步骤 2：提交**——`./mgr commit "docs(refactor): B19 wave4 技能内容迁移登记 [sherlock]"`（提交前确认 review_code/task.md 内容核对无误）。

## 计划自审清单
- [ ] 覆盖设计 §6 交付物 1-4 与 §8 DoD 1-5
- [ ] 无占位符；每任务含代码块与测试步骤（.spec. 提示齐备）
- [ ] 契约测试真实读文件

## 校验登记
`ff_dev gate b19-skill-content-wave4 plan --evidence docs/process/plans/2026-09-11-b19-skill-content-wave4.md` → 通过后 `ff_doctor plan` 本文件合规。