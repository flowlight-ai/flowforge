import { describe, expect, it } from 'vitest';
import {
  getAllConnectorDefinitions,
  getConnectorDefinition,
  registerConnectorDefinition,
  unregisterConnectorDefinition,
} from '../src/types/connector.ts';

describe('F140 ConnectorDefinitions', () => {
  it('GitHub connectors use a unified slate-gray gradient', () => {
    // Semantic depth: lightest (ambient) → base (standard) → deeper (attention) → deepest (action needed)
    const expected = {
      'github-repo-event': '#94A3B8', // slate-400 — ambient inbox
      'github-review': '#778899', // light-slate — standard notification
      'github-ci': '#778899', // light-slate — standard notification
      'github-issue-comment': '#778899', // light-slate — standard notification
      'github-review-feedback': '#64748B', // slate-500 — needs attention
      'github-conflict': '#475569', // slate-600 — needs action
    };
    for (const [id, color] of Object.entries(expected)) {
      const def = getConnectorDefinition(id);
      expect(def).toBeTruthy();
      expect(def?.themeColor).toBe(color);
      expect(def?.icon.type).toBe('svg');
      // 测试便利性: 上一行已断言 icon.type === 'svg'，此处按 svg 变体读取 iconId
      expect(def?.icon.type === 'svg' ? def.icon.iconId : undefined).toBe('github');
    }
  });

  it('all definitions have unique ids', () => {
    const all = getAllConnectorDefinitions();
    const ids = all.map((d) => d.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('all definitions have themeColor + structured icon', () => {
    for (const def of getAllConnectorDefinitions()) {
      expect(def.themeColor).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(def.icon).toBeTruthy();
      if (def.icon.type === 'svg') {
        expect(typeof def.icon.iconId).toBe('string');
      } else {
        expect(def.icon.src).toMatch(/^\//);
      }
    }
  });

  it('replaces runtime connector definitions without overriding static definitions', () => {
    const runtimeId = 'runtime-definition-update-probe';
    const builtInBefore = getConnectorDefinition('weixin');
    expect(builtInBefore).toBeTruthy();
    if (!builtInBefore) throw new Error('weixin connector definition not found');

    try {
      registerConnectorDefinition({
        id: runtimeId,
        displayName: 'Runtime Probe v1',
        icon: { type: 'png', src: '/test-v1.png' },
        themeColor: '#336699',
        description: 'runtime probe v1',
      });
      registerConnectorDefinition({
        id: runtimeId,
        displayName: 'Runtime Probe v2',
        icon: { type: 'png', src: '/test-v2.png' },
        themeColor: '#669933',
        description: 'runtime probe v2',
      });
      registerConnectorDefinition({
        ...builtInBefore,
        displayName: 'Overridden Weixin',
      });

      expect(getConnectorDefinition(runtimeId)?.displayName).toBe('Runtime Probe v2');
      expect(getConnectorDefinition('weixin')).toBe(builtInBefore);
    } finally {
      unregisterConnectorDefinition(runtimeId);
    }
  });
});
