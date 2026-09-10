/**
 * @flowforge/integration-e2e — 阶段9 集成跨包 e2e 场景清单（T9.2 / T9.3 / T9.4）。
 *
 * 本包仅承载验收级跨包场景（tests/integration-e2e.spec.ts）与场景清单元数据；
 * 无运行时插件（非 R13 插件包 —— 场景由组合根在 CI/验收时执行）。
 *
 * 三场景（对齐 29-stage9-integration.md）：
 * - `mention-cli-distillation`：用户群聊 @ 灵智体 → 调用外部 CLI（mock）→
 *   输出回传 → 经验蒸馏入库（DossierDistillationService）
 * - `forgekin-council-pr`：Forgekin 五闭环演进 → MindCouncil 跨厂商审议 →
 *   通过后提交 PR（mock git）
 * - `mcp-dag-compaction-resume`：MCP 工具调用（mock）→ 工作流 DAG 执行 →
 *   上下文压缩（BasicCompactionEngine）→ 会话续接
 *
 * @module @flowforge/integration-e2e
 */

/** e2e 场景 id 全集（阶段9）。 */
export const INTEGRATION_E2E_SCENARIOS = [
  'mention-cli-distillation',
  'forgekin-council-pr',
  'mcp-dag-compaction-resume',
] as const

export type IntegrationE2EScenario = (typeof INTEGRATION_E2E_SCENARIOS)[number]

/** 场景验收断言点（对齐 29-stage9-integration.md 验收标准）。 */
export interface IntegrationE2EScenarioSpec {
  readonly id: IntegrationE2EScenario
  readonly description: string
  /** 断言点（spec 文件中 it 标题的前缀词）。 */
  readonly assertions: readonly string[]
}

/** 场景清单（验收报告引用）。 */
export const INTEGRATION_E2E_SCENARIO_SPECS: readonly IntegrationE2EScenarioSpec[] = [
  {
    id: 'mention-cli-distillation',
    description: 'T9.2 用户群聊 @ 灵智体 → 外部 CLI（mock）调用 → 输出回传 → 经验蒸馏入库',
    assertions: [
      '多 @ 编排 pending→running→done',
      '外部 CLI 输出回传归集',
      '蒸馏提案 propose→approve→apply',
      'dossier 部分替换',
    ],
  },
  {
    id: 'forgekin-council-pr',
    description: 'T9.3 Forgekin 五闭环演进 → MindCouncil 跨厂商审议 → 通过后提交 PR（mock git）',
    assertions: [
      '五闭环注册齐全（doc/code/framework/review/test）',
      '闭环演进产出记录',
      '跨厂商审议 PASS（≥2 厂商）',
      'mock git 提交 PR',
    ],
  },
  {
    id: 'mcp-dag-compaction-resume',
    description: 'T9.4 MCP 工具调用 → 工作流 DAG 执行 → 上下文压缩 → 会话续接',
    assertions: [
      'MCP 工具输出进入会话上下文',
      'DAG 多步执行产出载荷',
      'BasicCompactionEngine 压缩旧区段',
      '会话续接引用压缩摘要',
    ],
  },
]