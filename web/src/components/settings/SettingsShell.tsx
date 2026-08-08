'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useState } from 'react';
import { Search } from 'lucide-react';
import { SettingsContent } from './SettingsContent';
import { SettingsNav } from './SettingsNav';
import { DEFAULT_SECTION } from './settings-nav-config';

/**
 * SettingsShell — 设置中心主容器
 *
 * 从 clowder-ai 移植并简化：
 *   - 左侧 220px 导航 + 右侧内容区
 *   - URL 参数 s= 控制活动 section（支持深链）
 *   - 移除 standalone 模式与 initialEditCatId（clowder-ai 特有）
 *   - 添加搜索框过滤导航项
 *   - 添加 data-* 标记（T8 测试用）：data-settings / data-settings-nav / data-settings-content
 *
 * 依据 WEB-FUSION-DESIGN.md §7.1。
 */
function SettingsShellInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeSection = searchParams.get('s') ?? DEFAULT_SECTION;
  const [searchQuery, setSearchQuery] = useState('');

  const handleSelect = useCallback(
    (sectionId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('s', sectionId);
      router.replace(`/admin/settings?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  return (
    <div
      className="settings-shell"
      data-settings="shell"
      style={{
        display: 'flex',
        height: '100%',
        minHeight: 0,
        background: 'var(--bg)',
        overflow: 'hidden',
      }}
    >
      {/* 左侧导航 */}
      <aside
        className="settings-nav"
        style={{
          width: '220px',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg)',
          borderRight: '1px solid var(--border)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '16px 16px 8px' }}>
          <h1 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--accent)' }}>设置</h1>
        </div>
        <div style={{ padding: '0 12px 8px' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'var(--bg-elevated)',
              padding: '6px 10px',
            }}
          >
            <Search size={14} color="var(--muted)" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索设置..."
              style={{
                minWidth: 0,
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--text)',
                fontSize: '12px',
              }}
            />
          </label>
        </div>
        <div style={{ minHeight: 0, flex: 1, overflowY: 'auto', padding: '0 12px 16px' }}>
          <SettingsNav activeSection={activeSection} onSelect={handleSelect} searchQuery={searchQuery} />
        </div>
      </aside>

      {/* 右侧内容区 */}
      <div
        className="settings-content"
        data-settings-content={activeSection}
        style={{
          minWidth: 0,
          flex: 1,
          overflowY: 'auto',
        }}
      >
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <SettingsContent section={activeSection} />
        </div>
      </div>
    </div>
  );
}

export function SettingsShell() {
  return (
    <Suspense fallback={null}>
      <SettingsShellInner />
    </Suspense>
  );
}
