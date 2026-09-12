# plan: B19 技能内容资产五波迁移（wave 5）

> 实例：`b19-skill-content-wave5` ｜ 规格（Spec）：`docs/process/specs/2026-09-11-b19-skill-content-wave5-design.md` ｜ 工作流：change

**目标（Goal）**：按 Q5 裁决把 clowder `cat-cafe-skills` 开发流程域余量四个核心包（feat-lifecycle / worktree / co-creation-docs / owner-friendly-plugin-development）内容迁入 `packages/forgekin/governance/skills/`，让框架能读取，覆盖 feature 立项→隔离开发→协同交付→插件化开发规范的整条生命周期。
**架构（Architecture）**：见设计 §2——`skills/` 下追加 4×SKILL.md（原样）+ manifest.yaml 追加 4 路由 + README 追加命名映射/批次登记。框架零改动。
**技术栈（Tech Stack）**：Markdown + YAML 内容资产；vitest 契约测试（真实读文件）。

## 全局约束
- 不改 skill-meta/skill-query；只新增内容 + 测试。
- 命名契约：正式内容仅用官方概念名；README 提供 P0 官方名 + 中文对照映射。
- 源 SKILL.md 为 CRLF → 规范化 LF（框架 frontmatter 正则仅匹配 LF）。
- 计划文档内代码块不含行首 `#` 注释（避免被 no-Placeholder 校验误判为标题）。

## 任务清单

### 任务 1：迁移开发流程域余量 4 个核心技能包内容资产

- [ ] **步骤 1：建目录并拷贝 4 包 SKILL.md（原样）**——`packages/forgekin/governance/skills/{feat-lifecycle,worktree,co-creation-docs,owner-friendly-plugin-development}/SKILL.md`，逐字复制源文件后规范化换行符为 LF。

```bash
cd packages/forgekin/governance
SRC=/d/software/fl/ex/clowder-ai/cat-cafe-skills
for p in feat-lifecycle worktree co-creation-docs owner-friendly-plugin-development; do
  mkdir -p skills/$p
  cp "$SRC/$p/SKILL.md" "skills/$p/SKILL.md"
done
node -e '
import("node:fs").then(async (fs) => {
  const base = "skills";
  for (const p of ["feat-lifecycle","worktree","co-creation-docs","owner-friendly-plugin-development"]) {
    const f = base + "/" + p + "/SKILL.md";
    const b = fs.readFileSync(f);
    if (b.includes(Buffer.from([0x0d, 0x0a]))) {
      fs.writeFileSync(f, b.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
      console.log("normalized:", p);
    }
  }
});'
```
- 说明：wave 1-4 已验证本做法可被框架 `readSkillMeta` 正确解析；规范化 CRLF → LF，框架正则 `^---\n` 仅匹配 LF。

- [ ] **步骤 2：manifest.yaml 追加 4 包路由**——在 wave 1-4 `skills:` map 中追加自家 4 包，category/description/triggers 来自源 manifest，description 含多行用 `>` 折叠块标量（避免内嵌冒号破坏 YAML）。四包均为「开发流程」。

```yaml
skills:
  # ...wave 1-4 各 4 键保留（至 merge-gate/custody-recognition）...
  feat-lifecycle:
    category: "开发流程"
    description: >
      Feature 立项、讨论、完成的全生命周期管理。
      Use when: 开个新功能、new feature、F0xx、立项、feature 完成、验收通过、讨论新功能需求。
      Not for: 不涉及 Feature/Design Gate 真相更新的纯代码实现、review、merge（那些有专门的 skill）。
      Output: Feature 聚合文件 + BACKLOG 索引 + 真相源同步。
    triggers:
      - "开个新功能"
      - "new feature"
      - "建档"
      - "立项"
      - "F0xx"
  worktree:
    category: "开发流程"
    description: >
      创建 Git worktree 隔离开发环境，含 Redis 6398 安全配置。
      Use when: 开始任何代码修改、新功能开发、bug fix。
      Not for: classifier 放行的 co-creation docs direct-push lane、不涉及代码的讨论。
      Output: 隔离的 worktree + 正确的 Redis/环境配置。
    triggers:
      - "开始开发"
      - "新 worktree"
      - "隔离环境"
  co-creation-docs:
    category: "开发流程"
    description: >
      共创型文档交付 lane：先区分只审阅还是授权落盘，再用冲突、治理风险、可逆性决定 direct push / PR / cloud / full gate。
      Use when: 共创架构图、思想纲领、discussion、研究笔记或其他 docs-only 内容并准备落盘。
      Not for: 只读 review、任何代码/脚本/skill/SOP 执行面改动、用户数据或外部契约变更。
      Output: 风险匹配的文档校验 + 可选内容 review + commit/push 或 PR 证据。
      GOTCHA: 行数和 Markdown diff 不是升档条件；显然 light 可自判直推，进入重载体前或拿不准时才运行 classifier。
    triggers:
      - "共创文档"
      - "落盘文档"
      - "docs lane"
  owner-friendly-plugin-development:
    category: "开发流程"
    description: >
      把真实用户旅程转成可安装、可授权、状态诚实、可恢复的 Clowder AI 插件产品边界。
      Use when: 设计或开发需要 Settings 安装/授权、后台 runtime、事件或数据入站、Needs Me、Host 路由的插件。
      Not for: 只搭 Codex 插件目录、纯 skill/MCP、无宿主生命周期的一次性 API 脚本、只修插件内部实现 bug。
      Output: 用户旅程契约 + ownership/authority map + 生命周期/恢复/发布方案 + fresh-consumer 与真实 dogfood 证据。
    triggers:
      - "开发插件"
      - "设计插件"
      - "插件产品边界"
```

- [ ] **步骤 3：README.md 追加 wave 5 命名映射 + 批次登记**——命名映射表追加 4 包 P0 官方名 + 中文对照；登记本波为 wave 5。

```markdown
- 命名映射追加（wave 5）：
  | 目录 id | 官方能力概念名 | 中文对照 |
  |---|---|---|
  | feat-lifecycle | Feature Lifecycle Management | 功能生命周期管理 |
  | worktree | Isolated Workspace Setup | 隔离工作区搭建 |
  | co-creation-docs | Co-Creation Docs Delivery | 共创文档交付 |
  | owner-friendly-plugin-development | Hosted Plugin Product Boundary | 宿主插件产品边界 |
- 批次登记追加：wave 5（2026-09-11）feat-lifecycle / worktree / co-creation-docs / owner-friendly-plugin-development
```

- [ ] **步骤 4：契约测试**——`governance/tests/b19-skill-content-wave5.spec.ts`：`readSkillMeta` 对 wave 5 4 包返回非空 description/triggers；`parseManifestSkillMeta(skills)` 含 ≥20 键（wave1+wave2+wave3+wave4+wave5）；`querySkill(projectRoot, name, skills)` 对 wave 5 4 包返回 detail。测试真实读文件，与 wave1-4 同构。

```ts
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseManifestSkillMeta, readSkillMeta } from '../src/skill-meta.ts';
import { querySkill } from '../src/skill-query.ts';

const skillsSource = resolve(process.cwd(), 'packages/forgekin/governance/skills');
const projectRoot = process.cwd();

const W5 = ['feat-lifecycle', 'worktree', 'co-creation-docs', 'owner-friendly-plugin-development'] as const;

describe('B19 wave5 skill content assets', () => {
  it('readSkillMeta returns non-empty description + triggers for 4 packages', async () => {
    for (const p of W5) {
      const meta = await readSkillMeta(resolve(skillsSource, p));
      expect(meta.description, `${p} description`).toBeTruthy();
      expect(meta.triggers?.length, `${p} triggers`).toBeGreaterThan(0);
    }
  });

  it('parseManifestSkillMeta resolves wave1+wave2+wave3+wave4+wave5 routing keys (>=20)', async () => {
    const map = await parseManifestSkillMeta(skillsSource);
    expect(map.size).toBeGreaterThanOrEqual(20);
    for (const p of W5) {
      expect(map.has(p), p).toBe(true);
      expect(map.get(p)?.category, `${p} category`).toBeTruthy();
    }
  });

  it('querySkill returns non-null detail for wave5 4 packages', async () => {
    for (const p of W5) {
      const detail = await querySkill(projectRoot, p, skillsSource);
      expect(detail, p).not.toBeNull();
      expect(detail?.id, p).toBeTruthy();
    }
  });
});
```

- [ ] **步骤 5：跑契约测试 + tsc + oxlint**——`vitest run`、包级 `tsc -p ... --noEmit`、`oxlint` 全绿（测试通过确认）。
- [ ] **步骤 6：提交**——`./mgr commit "feat(governance): B19 wave5 迁移开发流程域余量 4 核心技能内容资产进 governance/skills [sherlock]"`，随后 push 累加 PR（用户批准后）。

### 任务 2：登记 + 收尾

- [ ] **步骤 1：核对 review_code/record 回落**——B19 行追加"wave 5 已迁移 feat-lifecycle/worktree/co-creation-docs/owner-friendly-plugin-development"；review_code.md / task.md 补登记。

```md
- review_code.md §15 B19 回落追加：B19 wave 5（2026-09-11）迁移 feat-lifecycle / worktree /
  co-creation-docs / owner-friendly-plugin-development 四包进 governance/skills（manifest 扩至 20 键），
  附 b19-skill-content-wave5.spec.ts 契约测试。
```

- [ ] **步骤 2：提交**——`./mgr commit "docs(refactor): B19 wave5 技能内容迁移登记 [sherlock]"`（提交前确认 review_code/task.md 内容核对无误）。

## 计划自审清单
- [ ] 覆盖设计 §6 交付物 1-4 与 §8 DoD 1-5
- [ ] 无占位符；每任务含代码块与测试步骤（.spec. 提示齐备）
- [ ] 契约测试真实读文件

## 校验登记
`ff_dev gate b19-skill-content-wave5 plan --evidence docs/process/plans/2026-09-11-b19-skill-content-wave5.md` → 通过后 `ff_doctor plan` 本文件合规。