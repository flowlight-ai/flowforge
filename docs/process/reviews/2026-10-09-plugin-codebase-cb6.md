# plugin-codebase — EP-CB6 graph-ui 3D 可视化（设计评审）

- 日期：2026-10-09
- 评审对象：`docs/process/plans/2026-10-09-plugin-codebase-cb6.md` + `docs/process/specs/2026-10-09-plugin-codebase-cb6-design.md`
- 评审角色：**operator（待审）** —— 本记录为两阶段审查的**设计评审**阶段；实现前需 operator 确认放行
- 关联登记：`docs/refactor/review_code.md`（§13.0 EP-CB6 / §15 Q17/Q22 / §16 计划表）+ `34-stage` EP-CB6 任务清单

---

## 1. 评审范围

本评审覆盖 EP-CB6 的**方案设计**与**总体计划**，不含代码实现（docs-first，实现待评审通过后动工）。

## 2. 设计对照检查（对齐既有 TE 批次惯例）

| 检查项 | 状态 | 说明 |
|---|---|---|
| 归属与范围 | ✅ | 明确归属 EP2 前端融合 + 非核心链路（Q17 已裁决），不触碰 plugin-codebase 核心六域 |
| 独立包落点 | ✅ | 新包 `@flowforge/graph-ui`，数据契约层与渲染解耦，避免反向耦合 |
| seam 注入式 | ✅ | GraphDataPort / RendererPort / 布局坐标 seam 全部注入式，对齐 stretch 批次惯例 |
| 契约测试 | ✅ | graph-data / 布局（确定性）/ 渲染 seam（桩）三类独立契约测试 |
| 只读消费 | ✅ | 明确"不写 DB、不重写索引"，消费 plugin-codebase 只读查询面 |
| 默认关闭 | ✅ | web 面板默认关闭/仅显式启用，对齐 audio-proxy 先例，避免默认 heavy GPU 页面 |
| three.js 唯一新增运行时依赖 | ✅ | 渲染 seam 内引用，React/DOM 胶水隔离；不引入 React-three-fiber |

## 3. 待 operator 裁决 / 确认事项

1. **包名与组织**：独立 `packages/plugins/graph-ui`（`@flowforge/graph-ui`）而非并入 `@flowforge/plugin-codebase` 的 `ui/`——确认符合你对 graph-ui「EP2 前端融合域」的预期。（Q22 提案已默认独立包）
2. **three.js 选型**：确认采用 three.js（而非 force-graph React 封装或自研 Canvas 2D），作为唯一新增前端运行时依赖。
3. **web 接入形态**：新独立路由 `app/codebase/graph`（默认关闭/显式启用）——确认非默认挂载到既有导航。
4. **实现范围裁剪**：本批次仅交付「数据契约层 + 布局纯函数 + 渲染 seam + web 准入面板」，不做 C 源 graph-ui 全量交互（如 code 预览面板联动）——确认可接受。

## 4. 结论

- 待 operator 审查并裁决 §3 四项确认项；确认放行后，按 `docs/process/plans/2026-10-09-plugin-codebase-cb6.md` 批次 T6.2–T6.5 进入实现。
- 实现完成后，补 `docs/process/verifications/plugin-codebase-cb6.md` 验证证据并经 mgr 提交 PR。