/**
 * HubEvalTypes — 评估中心共享类型定义
 *
 * 仅包含类型定义与常量，不包含运行时逻辑，便于在 HubEvalTab、
 * HubEvalVerdictCard、HubEvalFrictionSections 间复用。
 *
 * 命名规范：使用 P0 "可进化智能体 / Forgekin"（非 "灵智体"）。
 */

/** 摩擦投影状态：available 表示已有可读的 raw report */
export interface EvalHubFrictionProjection {
  projectionStatus: 'available' | 'unavailable';
  /** 建议修复条目（actionable_candidate） */
  actionableCandidates: Array<{
    clusterId: string;
    representative: string;
    channels: string[];
    count: number;
    sensorForms: string[];
    severity: 'low' | 'medium' | 'high';
    actionability: 'actionable_candidate';
    followupDraft: {
      clusterId: string;
      title: string;
      summary: string;
      evidenceRefs: string[];
      reportingMode: 'none' | 'final-only' | 'state-transitions' | 'blocking-ack';
      /** 建议负责的 Forgekin ID */
      suggestedOwnerForgekinId?: string;
      projectPath?: string;
    };
    referenceOnlyEvidenceRefs: string[];
  }>;
  /** 仅引用条目（reference_only） */
  referenceOnly: Array<{
    clusterId: string;
    representative: string;
    channels: string[];
    count: number;
    sensorForms: string[];
    severity: 'low' | 'medium' | 'high';
    actionability: 'reference_only';
    evidenceRefs: string[];
  }>;
  source?: {
    rawReportPath: string;
  };
}

/** 评估中心条目（live-verdict 反馈类型） */
export interface EvalHubItem {
  id: string;
  domainId: string;
  packetId: string;
  feedbackType: 'live-verdict';
  verdict: 'delete_sunset' | 'build' | 'fix' | 'keep_observe';
  phenomenon: string;
  ownerAsk: string;
  /** 被评估的 Harness（可能是 Forgekin 或 Static Agent） */
  harnessUnderEval: {
    featureId: string;
    componentId: string;
    name: string;
  };
  reeval: {
    nextEvalAt?: string;
    status: 'observing' | 'pending_owner' | 'pending_reeval';
    summary: string;
  };
  lifecycle: {
    ownerResponseStatus: 'not_required' | 'not_started';
    closureStatus: 'observing' | 'open';
    stale: boolean;
  };
  evidence: {
    snapshotRefs: string[];
    attributionRefs: string[];
    metricRefs: string[];
    otherRefs: string[];
  };
  trend: {
    generatedAt: string;
    window: { durationHours: number };
    components: Array<{
      componentId: string;
      componentName: string;
      confidence: string;
      activationCounts: Record<string, number | null>;
      frictionCounts: Record<string, number | null>;
    }>;
  };
  systemWorkspace: {
    kind: 'eval_domain';
    id: string;
    label: string;
    threadId: string;
    stateSot: 'registry';
  };
  source: {
    verdictPath: string;
    bundleDir: string;
  };
  friction?: EvalHubFrictionProjection;
}

/** 判决标签映射（含 stale 过期状态） */
export const VERDICT_LABELS: Record<EvalHubItem['verdict'] | 'stale', string> = {
  keep_observe: '持续观察',
  fix: '需修复',
  build: '需新建',
  delete_sunset: '可下线',
  stale: '已过期',
};
