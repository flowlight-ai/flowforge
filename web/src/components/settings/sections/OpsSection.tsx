'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, BarChart3, Gauge, GitBranch, Trophy, ClipboardCheck } from 'lucide-react';
import {
  SettingsBadge,
  SettingsEmptyState,
  SettingsFilterTabs,
  SettingsHubLink,
  SettingsRow,
  SettingsSection,
  SettingsStatusStrip,
  SettingsText,
} from '../primitives';

type OpsTab = 'health' | 'usage' | 'quotas' | 'routing' | 'leaderboard' | 'eval';

interface ServiceHealth {
  id: string;
  name: string;
  status?: 'healthy' | 'degraded' | 'down' | 'unknown';
  latencyMs?: number;
  message?: string;
}

interface ToolUsage {
  toolName: string;
  category?: string;
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  avgLatencyMs?: number;
}

interface QuotaPool {
  forgekinId?: string;
  forgekinName?: string;
  dailyLimit?: number;
  used?: number;
}

interface QuotaUsageItem {
  forgekinId?: string;
  forgekinName?: string;
  tokensIn?: number;
  tokensOut?: number;
  calls?: number;
}

interface RoutingPolicy {
  id: string;
  name: string;
  enabled?: boolean;
  priority?: number;
  description?: string;
  targets?: { provider?: string; model?: string; weight?: number }[];
}

interface LeaderEntry {
  forgekinId?: string;
  forgekinName?: string;
  name?: string;
  value?: number;
  [key: string]: unknown;
}

interface EvalTask {
  id: string;
  title?: string;
  forgekinName?: string;
  type?: string;
  status?: string;
  qualityScore?: number;
  createdAt?: string;
}

const statusTone: Record<NonNullable<ServiceHealth['status']>, 'emerald' | 'amber' | 'red' | 'slate'> = {
  healthy: 'emerald',
  degraded: 'amber',
  down: 'red',
  unknown: 'slate',
};

const statusLabel: Record<NonNullable<ServiceHealth['status']>, string> = {
  healthy: '健康',
  degraded: '降级',
  down: '故障',
  unknown: '未知',
};

const LEADER_METRICS = [
  { key: 'tasks', label: '任务数' },
  { key: 'token', label: 'Token 用量' },
  { key: 'quality', label: '质量分' },
  { key: 'uptime', label: '在线时长' },
];

/**
 * OpsSection — 运维监控（对齐 clowder-ai OpsContent 多子 tab）
 *
 * 子 Tab：服务健康（/ops/services）、工具用量（/tools/usage）、
 * 配额（/quotas/pools + /quotas/usage）、路由策略（/routing/policies + PATCH 开关）、
 * 排行榜（/leaderboard?metric=）、Eval 评估（/eval/tasks + 判决）。
 */
export function OpsSection() {
  const [tab, setTab] = useState<OpsTab>('health');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // health
  const [services, setServices] = useState<ServiceHealth[]>([]);
  // usage
  const [toolUsage, setToolUsage] = useState<ToolUsage[]>([]);
  // quotas
  const [pools, setPools] = useState<QuotaPool[]>([]);
  const [quotaUsage, setQuotaUsage] = useState<QuotaUsageItem[]>([]);
  // routing
  const [policies, setPolicies] = useState<RoutingPolicy[]>([]);
  // leaderboard
  const [metric, setMetric] = useState('tasks');
  const [leaderboard, setLeaderboard] = useState<LeaderEntry[]>([]);
  // eval
  const [evalTasks, setEvalTasks] = useState<EvalTask[]>([]);

  const [loading, setLoading] = useState(true);

  const flash = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 3000);
  };

  const fetchHealth = useCallback(async () => {
    const res = await fetch('/api/v1/ops/services').catch(() => null);
    if (!res || !res.ok) {
      setServices([]);
      return;
    }
    const data = await res.json().catch(() => ({ items: [] }));
    const list = data?.items || [];
    setServices(Array.isArray(list) ? list.map((item: any, i: number) => ({
      id: item.id || `svc_${i}`,
      name: item.name || `服务 ${i + 1}`,
      status: item.status || 'unknown',
      message: item.message,
      latencyMs: item.latency_ms || item.latencyMs,
    })) : []);
  }, []);

  const fetchToolUsage = useCallback(async () => {
    const data = await fetch('/api/v1/tools/usage').then((r) => r.json()).catch(() => ({}));
    const list = data?.data?.items || data?.items || data?.tools || [];
    setToolUsage(Array.isArray(list) ? list : []);
  }, []);

  const fetchQuotas = useCallback(async () => {
    const [p, u] = await Promise.all([
      fetch('/api/v1/quotas/pools').then((r) => r.json()).catch(() => ({ items: [] })),
      fetch('/api/v1/quotas/usage').then((r) => r.json()).catch(() => ({ items: [] })),
    ]);
    setPools(Array.isArray(p?.items) ? p.items : (Array.isArray(p?.pools) ? p.pools : []));
    setQuotaUsage(Array.isArray(u?.items) ? u.items : []);
  }, []);

  const fetchRouting = useCallback(async () => {
    const data = await fetch('/api/v1/routing/policies').then((r) => r.json()).catch(() => ({ policies: [] }));
    setPolicies(Array.isArray(data?.policies) ? data.policies : []);
  }, []);

  const fetchLeaderboard = useCallback(async (m: string) => {
    const data = await fetch(`/api/v1/leaderboard?metric=${encodeURIComponent(m)}&limit=20`)
      .then((r) => r.json()).catch(() => ({}));
    const list = data?.data?.entries || data?.entries || data?.data?.items || data?.items || [];
    setLeaderboard(Array.isArray(list) ? list : []);
  }, []);

  const fetchEval = useCallback(async () => {
    const data = await fetch('/api/v1/eval/tasks?limit=30').then((r) => r.json()).catch(() => ({ items: [] }));
    setEvalTasks(Array.isArray(data?.items) ? data.items : []);
  }, []);

  useEffect(() => {
    setLoading(true);
    const run = async () => {
      if (tab === 'health') await fetchHealth();
      else if (tab === 'usage') await fetchToolUsage();
      else if (tab === 'quotas') await fetchQuotas();
      else if (tab === 'routing') await fetchRouting();
      else if (tab === 'leaderboard') await fetchLeaderboard(metric);
      else if (tab === 'eval') await fetchEval();
      setLoading(false);
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, metric]);

  const togglePolicy = async (p: RoutingPolicy) => {
    setBusy(p.id);
    try {
      const res = await fetch(`/api/v1/routing/policies/${encodeURIComponent(p.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !p.enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      flash(p.enabled ? `已禁用策略 ${p.name}` : `已启用策略 ${p.name}`);
      await fetchRouting();
    } catch {
      flash('策略切换失败');
    } finally {
      setBusy(null);
    }
  };

  const submitVerdict = async (taskId: string, verdict: 'approve' | 'reject' | 'redo') => {
    setBusy(taskId);
    try {
      const res = await fetch(`/api/v1/eval/${encodeURIComponent(taskId)}/verdict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict, feedback: '' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      flash('已提交评估判决');
      await fetchEval();
    } catch {
      flash('判决提交失败');
    } finally {
      setBusy(null);
    }
  };

  const downCount = services.filter((s) => s.status === 'down').length;
  const degradedCount = services.filter((s) => s.status === 'degraded').length;

  return (
    <SettingsSection
      title="运维监控"
      description="服务健康、工具用量、配额池、路由策略、排行榜与 Eval 评估。"
      badge={
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <SettingsBadge tone="slate" size="xxs">{tab}</SettingsBadge>
          {tab === 'health' && <SettingsHubLink title="刷新健康检查" onClick={fetchHealth}>刷新</SettingsHubLink>}
        </div>
      }
    >
      <div style={{ marginBottom: '12px' }}>
        <SettingsFilterTabs
          tabs={[
            { key: 'health', label: '服务健康' },
            { key: 'usage', label: '工具用量' },
            { key: 'quotas', label: '配额池' },
            { key: 'routing', label: '路由策略' },
            { key: 'leaderboard', label: '排行榜' },
            { key: 'eval', label: 'Eval 评估' },
          ]}
          activeKey={tab}
          onTabChange={(k) => setTab(k as OpsTab)}
        />
      </div>

      {message && <SettingsText as="p" variant="xs" tone={message.includes('失败') ? 'red' : 'muted'}>{message}</SettingsText>}
      {loading ? (
        <SettingsText as="p" tone="muted">加载中...</SettingsText>
      ) : tab === 'health' ? (
        <>
          {downCount > 0 && (
            <SettingsStatusStrip tone="error" style={{ marginBottom: '12px' }}>
              ⚠ {downCount} 个服务处于故障状态
            </SettingsStatusStrip>
          )}
          {downCount === 0 && degradedCount > 0 && (
            <SettingsStatusStrip tone="warn" style={{ marginBottom: '12px' }}>
              {degradedCount} 个服务降级运行
            </SettingsStatusStrip>
          )}
          {downCount === 0 && degradedCount === 0 && services.length > 0 && (
            <SettingsStatusStrip tone="success" style={{ marginBottom: '12px' }}>
              ✓ 全部服务运行正常
            </SettingsStatusStrip>
          )}
          {services.length === 0 ? (
            <SettingsEmptyState icon={<Activity size={32} color="var(--muted)" />} title="暂无健康数据" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {services.map((s) => (
                <SettingsRow
                  key={s.id}
                  icon={<Activity size={16} color="var(--info)" />}
                  title={s.name}
                  meta={s.message}
                  badges={
                    <>
                      <SettingsBadge tone={s.status ? statusTone[s.status] : 'slate'} size="xxs">
                        {s.status ? statusLabel[s.status] : '未知'}
                      </SettingsBadge>
                      {s.latencyMs != null && <SettingsBadge tone="slate" size="xxs">{s.latencyMs}ms</SettingsBadge>}
                    </>
                  }
                />
              ))}
            </div>
          )}
        </>
      ) : tab === 'usage' ? (
        toolUsage.length === 0 ? (
          <SettingsEmptyState icon={<BarChart3 size={32} color="var(--muted)" />} title="暂无工具调用记录" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {toolUsage.map((t) => (
              <SettingsRow
                key={t.toolName}
                icon={<BarChart3 size={16} color="var(--accent)" />}
                title={t.toolName}
                meta={`成功 ${t.successCalls} · 失败 ${t.failedCalls}`}
                badges={
                  <>
                    {t.category && <SettingsBadge tone="slate" size="xxs">{t.category}</SettingsBadge>}
                    <SettingsBadge tone="blue" size="xxs">{t.totalCalls} 次</SettingsBadge>
                    {t.avgLatencyMs != null && t.avgLatencyMs > 0 && (
                      <SettingsBadge tone="purple" size="xxs">{t.avgLatencyMs}ms</SettingsBadge>
                    )}
                    {t.failedCalls > 0 && <SettingsBadge tone="red" size="xxs">{t.failedCalls} 失败</SettingsBadge>}
                  </>
                }
              />
            ))}
          </div>
        )
      ) : tab === 'quotas' ? (
        <>
          {pools.length === 0 && quotaUsage.length === 0 ? (
            <SettingsEmptyState icon={<Gauge size={32} color="var(--muted)" />} title="暂无配额数据" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <SettingsText as="p" variant="xs" tone="muted">配额池（{pools.length}）</SettingsText>
              {pools.map((p, i) => {
                const name = p.forgekinName || p.forgekinId || `池 ${i + 1}`;
                const used = p.used ?? 0;
                const limit = p.dailyLimit ?? 0;
                const ratio = limit > 0 ? used / limit : 0;
                return (
                  <SettingsRow
                    key={p.forgekinId || i}
                    icon={<Gauge size={16} color="var(--accent-2)" />}
                    title={name}
                    meta={limit > 0 ? `已用 ${used} / ${limit}` : `已用 ${used}`}
                    badges={
                      ratio >= 0.9
                        ? <SettingsBadge tone="red" size="xxs">接近上限</SettingsBadge>
                        : ratio >= 0.6
                          ? <SettingsBadge tone="amber" size="xxs">用量偏高</SettingsBadge>
                          : <SettingsBadge tone="emerald" size="xxs">正常</SettingsBadge>
                    }
                  />
                );
              })}
              {quotaUsage.length > 0 && (
                <>
                  <SettingsText as="p" variant="xs" tone="muted" >用量记录（{quotaUsage.length}）</SettingsText>
                  {quotaUsage.map((u, i) => (
                    <SettingsRow
                      key={`${u.forgekinId || ''}_${i}`}
                      icon={<Gauge size={16} color="var(--info)" />}
                      title={u.forgekinName || u.forgekinId || `记录 ${i + 1}`}
                      meta={`输入 ${u.tokensIn ?? 0} · 输出 ${u.tokensOut ?? 0} tokens`}
                      badges={<SettingsBadge tone="blue" size="xxs">{u.calls ?? 0} 次调用</SettingsBadge>}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </>
      ) : tab === 'routing' ? (
        policies.length === 0 ? (
          <SettingsEmptyState icon={<GitBranch size={32} color="var(--muted)" />} title="暂无路由策略" description="首次访问将从 llm_route.yaml 自动派生。" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {policies.map((p) => (
              <SettingsRow
                key={p.id}
                icon={<GitBranch size={16} color="var(--accent)" />}
                title={p.name}
                meta={p.description || (p.targets?.length ? p.targets.map((t) => `${t.provider || ''}/${t.model || ''}`).join(' → ') : undefined)}
                badges={
                  <>
                    {p.priority != null && <SettingsBadge tone="slate" size="xxs">优先级 {p.priority}</SettingsBadge>}
                    {p.targets && p.targets.length > 0 && <SettingsBadge tone="purple" size="xxs">{p.targets.length} 目标</SettingsBadge>}
                    <SettingsBadge tone={p.enabled ? 'emerald' : 'slate'} size="xxs">{p.enabled ? '启用' : '禁用'}</SettingsBadge>
                  </>
                }
                actions={
                  <SettingsHubLink
                    title={p.enabled ? '禁用该路由策略' : '启用该路由策略'}
                    onClick={() => togglePolicy(p)}
                    style={busy === p.id ? { opacity: 0.5 } : undefined}
                  >
                    {busy === p.id ? '处理中...' : p.enabled ? '禁用' : '启用'}
                  </SettingsHubLink>
                }
              />
            ))}
          </div>
        )
      ) : tab === 'leaderboard' ? (
        <>
          <div style={{ marginBottom: '12px' }}>
            <SettingsFilterTabs
              tabs={LEADER_METRICS.map((m) => ({ key: m.key, label: m.label }))}
              activeKey={metric}
              onTabChange={(k) => setMetric(k)}
            />
          </div>
          {leaderboard.length === 0 ? (
            <SettingsEmptyState icon={<Trophy size={32} color="var(--muted)" />} title="暂无排行数据" description="产生 swarm_trace 统计后自动生成。" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {leaderboard.map((e, i) => (
                <SettingsRow
                  key={`${e.forgekinId || e.forgekinName || e.name || ''}_${i}`}
                  icon={<Trophy size={16} color={i < 3 ? 'var(--accent-2)' : 'var(--muted)'} />}
                  title={`${i + 1}. ${e.forgekinName || e.name || e.forgekinId || '未知'}`}
                  badges={e.value != null ? <SettingsBadge tone="blue" size="xxs">{e.value}</SettingsBadge> : null}
                />
              ))}
            </div>
          )}
        </>
      ) : evalTasks.length === 0 ? (
        <SettingsEmptyState icon={<ClipboardCheck size={32} color="var(--muted)" />} title="暂无评估任务" description="产生 checkpoints 后自动列出。" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {evalTasks.map((t) => (
            <SettingsRow
              key={t.id}
              icon={<ClipboardCheck size={16} color="var(--info)" />}
              title={t.title || t.id}
              meta={t.createdAt}
              badges={
                <>
                  {t.type && <SettingsBadge tone="slate" size="xxs">{t.type}</SettingsBadge>}
                  <SettingsBadge tone={t.status === 'completed' ? 'emerald' : 'amber'} size="xxs">
                    {t.status === 'completed' ? '已评估' : '待评估'}
                  </SettingsBadge>
                  {t.qualityScore != null && <SettingsBadge tone="purple" size="xxs">质量 {t.qualityScore}</SettingsBadge>}
                </>
              }
              actions={
                t.status !== 'completed' ? (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <SettingsHubLink title="通过" onClick={() => submitVerdict(t.id, 'approve')} style={busy === t.id ? { opacity: 0.5 } : undefined}>通过</SettingsHubLink>
                    <SettingsHubLink title="重做" onClick={() => submitVerdict(t.id, 'redo')} style={busy === t.id ? { opacity: 0.5 } : undefined}>重做</SettingsHubLink>
                    <SettingsHubLink title="拒绝" onClick={() => submitVerdict(t.id, 'reject')} style={{ color: 'var(--danger)', opacity: busy === t.id ? 0.5 : 1 }}>拒绝</SettingsHubLink>
                  </div>
                ) : null
              }
            />
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
