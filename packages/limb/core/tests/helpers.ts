/**
 * limb-core 测试共享工厂 — 构造 ILimbNode 测试桩。
 *
 * @module @flowforge/limb-core/tests
 */

import type { ILimbNode, LimbCapability, LimbInvokeResult, LimbNodeStatus } from '../src/index.ts';

export interface NodeOverrides {
  nodeId?: string;
  displayName?: string;
  platform?: string;
  capabilities?: LimbCapability[];
  invokeResult?: LimbInvokeResult;
  invokeImpl?: (command: string, params: Record<string, unknown>) => Promise<LimbInvokeResult>;
  health?: LimbNodeStatus;
}

export const DEFAULT_CAPABILITIES: LimbCapability[] = [
  { cap: 'camera', commands: ['camera.snap', 'camera.record'], authLevel: 'free' },
  { cap: 'gpu_render', commands: ['gpu.render'], authLevel: 'leased' },
];

/** 构造一个可控的四肢节点桩 */
export function makeNode(overrides: NodeOverrides = {}): ILimbNode {
  const nodeId = overrides.nodeId ?? 'camera-01';
  const invoke =
    overrides.invokeImpl ??
    (async (): Promise<LimbInvokeResult> => overrides.invokeResult ?? { success: true, data: { ok: true } });
  return {
    nodeId,
    displayName: overrides.displayName ?? 'Camera 01',
    platform: overrides.platform ?? 'test',
    capabilities: overrides.capabilities ?? DEFAULT_CAPABILITIES,
    async register(): Promise<void> {},
    invoke,
    async healthCheck(): Promise<LimbNodeStatus> {
      return overrides.health ?? 'online';
    },
    async deregister(): Promise<void> {},
  };
}
