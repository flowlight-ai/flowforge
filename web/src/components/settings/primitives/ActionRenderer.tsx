'use client';

import { useCallback, useState } from 'react';
import { SettingsPrimaryButton } from './SettingsPrimaryButton';
import { SettingsSecondaryButton } from './SettingsSecondaryButton';
import { SettingsText } from './SettingsText';

/**
 * ActionRenderer — 简化版连接器动作渲染器
 *
 * 从 移植并大幅简化：
 *   - 移除 polling/state machine（AC-A26 复杂逻辑）
 *   - 移除 ActionRendererParts/ActionRendererState 子模块依赖
 *   - 保留 button + status 两种 render 类型
 *
 * 仅用于设置区内简单的动作触发场景；复杂连接器流程仍走原 Hub 组件。
 */

export type ActionRenderType = 'button' | 'status';

export interface ActionDefinition {
  id: string;
  label: string;
  render: ActionRenderType;
  /** 调用此动作的 API 路径（POST 请求） */
  endpoint?: string;
  /** 完成后跳转的下一个动作 id */
  next?: string;
}

export interface ActionResult {
  ok: boolean;
  label?: string;
  message?: string;
}

interface ActionRendererProps {
  /** 连接器或目标对象 id */
  targetId: string;
  /** 当前动作链 */
  actions: ActionDefinition[];
  /** 已配置/已连接状态 */
  configured?: boolean;
  /** 状态变化回调 */
  onStatusChange?: () => void;
  /** 主题色 */
  themeColor?: string;
}

async function executeAction(targetId: string, action: ActionDefinition): Promise<ActionResult> {
  if (!action.endpoint) {
    return { ok: false, label: '未配置 endpoint' };
  }
  try {
    const res = await fetch(action.endpoint.replace('{id}', encodeURIComponent(targetId)), { method: 'POST' });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, label: err.error ?? `请求失败 (${res.status})` };
    }
    const data = (await res.json().catch(() => ({}))) as { label?: string; message?: string };
    return { ok: true, label: data.label, message: data.message };
  } catch {
    return { ok: false, label: '网络错误' };
  }
}

export function ActionRenderer({
  targetId,
  actions,
  configured,
  onStatusChange,
  themeColor,
}: ActionRendererProps) {
  const firstAction = actions[0];
  const [currentActionId, setCurrentActionId] = useState<string | undefined>(firstAction?.id);
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<ActionResult | null>(null);

  const currentAction = actions.find((a) => a.id === currentActionId) ?? firstAction;

  const handleAction = useCallback(
    async (actionId: string) => {
      const action = actions.find((a) => a.id === actionId);
      if (!action) return;
      setRunning(true);
      setLastResult(null);
      const result = await executeAction(targetId, action);
      setLastResult(result);
      setRunning(false);
      if (result.ok && action.next) {
        setCurrentActionId(action.next);
      }
      onStatusChange?.();
    },
    [actions, targetId, onStatusChange],
  );

  if (!currentAction) {
    return (
      <SettingsText as="p" tone="muted">
        无可用动作
      </SettingsText>
    );
  }

  if (currentAction.render === 'status' && configured) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <SettingsText tone="emerald">● 已连接</SettingsText>
        <SettingsSecondaryButton
          onClick={() => {
            const disconnect = actions.find((a) => a.id === 'disconnect');
            if (disconnect) handleAction(disconnect.id);
          }}
          disabled={running}
        >
          {running ? '处理中...' : '断开连接'}
        </SettingsSecondaryButton>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start' }}>
      <SettingsPrimaryButton
        onClick={() => handleAction(currentAction.id)}
        disabled={running}
        data-guide-id={`action-${currentAction.id}`}
      >
        {running ? '处理中...' : currentAction.label}
      </SettingsPrimaryButton>
      {lastResult && (
        <SettingsText as="p" tone={lastResult.ok ? 'emerald' : 'red'}>
          {lastResult.label ?? (lastResult.ok ? '成功' : '失败')}
        </SettingsText>
      )}
      {themeColor && (
        <span
          aria-hidden
          style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: themeColor }}
        />
      )}
    </div>
  );
}
