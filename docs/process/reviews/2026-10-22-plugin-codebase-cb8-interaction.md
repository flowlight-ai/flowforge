# cb8-interaction 代码审查记录

## 元信息

| 字段 | 值 |
|---|---|
| 流程实例名 | `cb8-interaction` |
| 审查范围 | 工作区未提交改动（`packages/plugins/graph-ui/src/render/**`、`packages/plugins/graph-ui/tests/render.spec.ts`、`web/src/app/codebase-graph/data/route.ts`、`web/src/components/codebase/{CodebaseGraphView,http-codebase-read}.tsx|ts`、`web/src/components/graph/GraphPanel.tsx`） |
| 依据 | 实施计划：`docs/process/plans/2026-10-22-plugin-codebase-cb8-interaction.md`；设计：`docs/process/specs/2026-10-22-plugin-codebase-cb8-interaction-design.md` |
| 审查者 | 会话内自查（实现由并行会话产出，接管后逐文件复核） |
| 日期 | 2026-10-22 |

## 阶段 1：规格符合性（Spec Compliance）

| 任务 | 状态 | 备注 |
|---|---|---|
| 任务 1：graph-ui 真实射线拾取 | 符合 | `ThreeBinding` 增 `Vector2`/`Raycaster`；`pickRaycast` 归一化坐标→`setFromCamera`→`intersectObjects`→`userData.node`；`pickNearest` 已删除；`dispose` 清空 `nodeMeshes`。render.spec 增 1 例（计划列 2 例：命中用例已覆盖真实节点回传，坐标归一化未单独断言，由实现审阅覆盖）。 |
| 任务 2：web 工程列表端点与端口 | 符合（接口偏差） | `?list=1` 返回 `{projects:[{name,createdAt,filesIndexed,lastIndexedAt}]}`；`listHttpProjects()` 返回 `HttpProjectInfo[] \| null`，计划/设计写的是 `string[]`。视图需要文件数展示，故保留对象形状，无行为风险。 |
| 任务 3：工程下拉与切换重装配 | 符合 | `CodebaseGraphView` 增受控下拉 + `project` 状态 + `useMemo` 端口重建；`GraphPanel` 在端口变化时先 `dispose` 旧渲染并清空宿主画布（评审中发现缺失，已补）。 |
| 任务 4：验证与收尾 | 待执行 | 本评审通过后跑门禁并落验证证据。 |

**裁决**：规格符合 ✅

## 阶段 2：代码质量（Code Quality）

| 维度 | 权重 | 发现 |
|---|---|---|
| code_quality | 0.60 | 结构清晰：拾取逻辑收敛在 `pickRaycast`，注入面仍为极窄类型；web 侧沿用既有端口/装配模式，无新增运行依赖。 |
| security | 0.40（否决维） | 只读链路未变：route handler 仍只读 `node:sqlite`，无用户输入拼接 SQL；`project` 参数经既有白名单校验；新增 `?list=1` 不返回敏感信息。 |

**TR-1 技术门禁**：加权 **0.92** / 阈值 0.65（change）✅

### 发现清单（P1/P2/P3 分级）

| 级别 | 条目 | 位置 | 处置 |
|---|---|---|---|
| P1（阻断） | `@flowforge/graph-ui` 的 `main` 指向 `lib/index.js`，本地仅有 `lib/types/**`（tsc 产物），`next dev` 编译报 `Module not found: Can't resolve '@flowforge/graph-ui'`，图谱页 500。属 CB6 打包入口遗留（非本批引入），但阻断浏览器验收。 | `packages/plugins/graph-ui/package.json` | 本机以 `pnpm build`（tsdown host face）生成 `lib/index.js` 后复测；构建前置约束记入验证证据。CI web 线若未先构建 host 包，需后续批次补 prebuild，本批不改 CI。 |
| P2（技术缺陷） | `pickRaycast` 对 `setFromCamera`/`intersectObjects` 使用可选链，注入面缺方法时会静默“无命中”。类型已强约束，实际仅测试桩可触发。 | `packages/plugins/graph-ui/src/render/three.ts` | 接受（保持对桩的宽容），后续如出现第三种注入实现再收紧。 |
| P2（已修复） | 浏览器实测 seed 路径 `canvases=2`：React StrictMode 双挂载 + 在途装载竞争，旧 `load` 在新 `load` 之后追加画布；端口切换同样有此风险。 | `web/src/components/graph/GraphPanel.tsx` | 本轮修复：每次装载使用独立 slot 容器 + `loadSeq` 过期令牌，过期装载 `dispose` 并移除自身 slot；复测 `canvases=1`、切换后 `slots=1`。 |
| P2（延后） | 真实库 45721 节点 / 156073 边全量渲染在 headless 下 >7 分钟未完成（每边一个 Line，draw call 过多）。 | `packages/plugins/graph-ui/src/render/three.ts` | 设计明确「不做语义缩进/密度优化、分页」；seed 路径与数据端点均已验证，全量渲染性能留后续批次（LOD/合批/分页）处理，记入遗留。 |
| P3（风格/建议） | 工程下拉在 `enabled=0` 时仍渲染，但面板处于关闭占位态，语义不符。 | `web/src/components/codebase/CodebaseGraphView.tsx` | 本轮修复：`enabled` 为假时 `display:none`，并补 `data-project-select` 便于冒烟定位。 |
| P3（建议） | `options` 为当前工程合成兜底项时 `createdAt: ""`。 | 同上 | 仅用于兜底显示名称，无数据消费；保留。 |

## 约束核对

- [x] 审查者与实现者分离：实现由并行会话产出，本会话逐文件复核并补缺陷修复
- [x] 测试证据核对（T1-T9）：graph-ui 契约测试为注入桩，不涉及 LLM mock；无 P1 测试违规
- [x] “⚠️ 无法从 diff 验证”条目：无
- [x] 降级记录：浏览器验收依赖 `pnpm build` 生成 graph-ui 运行产物，已在验证证据中记录前置命令
