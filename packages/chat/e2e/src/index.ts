/**
 * @flowforge/chat-e2e — chat 阶段5 跨包 e2e 场景清单（T5.12）。
 *
 * 本包仅承载验收级跨包场景（tests/chat-e2e.spec.ts）与场景清单元数据；
 * 无运行时插件（非 R13 插件包 —— 场景由组合根在 CI/验收时执行）。
 *
 * 四场景（对齐 25-stage5-chat.md T5.12 验收）：
 * - `realtime-dual-client`：双客户端实时收发 + 线程房间隔离 + seq 单调
 * - `mention-concurrent-threads`：@ 多灵智体并发响应 + 线程间状态隔离
 * - `handoff-context-continuity`：交接链 propose→approve→seal→unseal，
 *   新会话可引用旧会话摘要（上下文连续）
 * - `approval-state-machine`：提案 pending→approving→approved + 投票
 *   active→closed 状态机
 *
 * @module @flowforge/chat-e2e
 */

/** e2e 场景 id 全集（T5.12）。 */
export const CHAT_E2E_SCENARIOS = [
  'realtime-dual-client',
  'mention-concurrent-threads',
  'handoff-context-continuity',
  'approval-state-machine',
] as const

export type ChatE2EScenario = (typeof CHAT_E2E_SCENARIOS)[number]

/** 场景验收断言点（对齐 25-stage5-chat.md 验收标准 1-3）。 */
export interface ChatE2EScenarioSpec {
  readonly id: ChatE2EScenario
  readonly description: string
  /** 断言点（spec 文件中 it 标题的前缀词）。 */
  readonly assertions: readonly string[]
}

/** 场景清单（验收报告引用）。 */
export const CHAT_E2E_SCENARIO_SPECS: readonly ChatE2EScenarioSpec[] = [
  {
    id: 'realtime-dual-client',
    description: '线程内多人（含多个灵智体）消息实时收发，@mention 精确路由（验收标准 1）',
    assertions: ['双客户端同房间实时收发', '非成员线程隔离', 'seq/seqEpoch 单调注入', 'emitToUser 定向'],
  },
  {
    id: 'mention-concurrent-threads',
    description: '@ 多个灵智体并发响应且线程隔离（验收标准 1 后半）',
    assertions: ['并发交错响应归集', '线程间状态互不影响', '反级联守卫', '部分完成 partial'],
  },
  {
    id: 'handoff-context-continuity',
    description: '会话交接后上下文连续：新线程可引用旧线程摘要（验收标准 2）',
    assertions: ['propose 提议', 'approve commit-point 封存', 'unseal 重开', '链上上下文可见'],
  },
  {
    id: 'approval-state-machine',
    description: '审批/提案/投票状态机正确流转（验收标准 3）',
    assertions: ['提案 pending→approved', '建线程 finalize', '投票 active→closed', 'settled 聚合'],
  },
]
