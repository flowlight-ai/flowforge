'use client';

/**
 * ConfigFieldRenderer — 简化版配置字段渲染器
 *
 * 从 clowder-ai 移植并简化：
 *   - 移除 HubConfigIcons / LockIcon / PlatformFieldStatus 类型依赖
 *   - 保留 input/select/toggle/list 四种字段类型
 *   - 字段定义使用本地 ConfigField 类型
 */

export type ConfigFieldType = 'input' | 'select' | 'toggle' | 'list';

export interface ConfigFieldOption {
  value: string;
  label: string;
}

export interface ConfigField {
  envName: string;
  label: string;
  type?: ConfigFieldType;
  currentValue?: string;
  sensitive?: boolean;
  options?: ConfigFieldOption[];
}

interface ConfigFieldRendererProps {
  field: ConfigField;
  /** 当前编辑值（空字符串 = 用户尚未输入） */
  value: string;
  /** 值变化回调 */
  onChange: (envName: string, value: string) => void;
  /** HTML id 前缀 */
  idPrefix?: string;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text-strong)',
  padding: '8px 12px',
  fontSize: '13px',
  outline: 'none',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 500,
  color: 'var(--text)',
  marginBottom: '4px',
};

export function ConfigFieldRenderer({ field, value, onChange, idPrefix = 'config' }: ConfigFieldRendererProps) {
  const fieldId = `${idPrefix}-${field.envName}`;
  const fieldType = field.type ?? 'input';
  const label = (
    <label htmlFor={fieldId} style={labelStyle}>
      {field.label}
      {field.sensitive && <span style={{ color: 'var(--warn)', marginLeft: '4px' }}>🔒</span>}
    </label>
  );

  switch (fieldType) {
    case 'select':
      return (
        <div>
          {label}
          <select
            id={fieldId}
            value={value || field.currentValue || ''}
            onChange={(e) => onChange(field.envName, e.target.value)}
            style={inputStyle}
            data-testid={`field-${field.envName}`}
          >
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      );

    case 'toggle':
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label htmlFor={fieldId} style={{ ...labelStyle, marginBottom: 0 }}>
            {field.label}
          </label>
          <button
            id={fieldId}
            type="button"
            role="switch"
            aria-checked={value === 'true' || (!value && field.currentValue === 'true')}
            onClick={() => {
              const current = value || field.currentValue || 'false';
              onChange(field.envName, current === 'true' ? 'false' : 'true');
            }}
            style={{
              position: 'relative',
              display: 'inline-flex',
              height: '20px',
              width: '36px',
              alignItems: 'center',
              borderRadius: 'var(--radius-full)',
              border: 'none',
              background:
                value === 'true' || (!value && field.currentValue === 'true') ? 'var(--ok)' : 'var(--bg-muted)',
              cursor: 'pointer',
              transition: 'background var(--duration-normal) var(--ease-out)',
            }}
            data-testid={`field-${field.envName}`}
          >
            <span
              style={{
                display: 'inline-block',
                height: '14px',
                width: '14px',
                borderRadius: '50%',
                background: 'var(--bg)',
                transform:
                  value === 'true' || (!value && field.currentValue === 'true')
                    ? 'translateX(18px)'
                    : 'translateX(2px)',
                transition: 'transform var(--duration-normal) var(--ease-out)',
              }}
            />
          </button>
        </div>
      );

    case 'list':
      return (
        <div>
          {label}
          <textarea
            id={fieldId}
            placeholder={field.currentValue ?? '["item1","item2"]'}
            value={value}
            onChange={(e) => onChange(field.envName, e.target.value)}
            rows={2}
            style={{ ...inputStyle, fontFamily: 'var(--mono)' }}
            data-testid={`field-${field.envName}`}
          />
          <p style={{ margin: '2px 0 0', fontSize: '10px', color: 'var(--muted)' }}>JSON array, e.g. [&quot;a&quot;,&quot;b&quot;]</p>
        </div>
      );

    case 'input':
    default:
      return (
        <div>
          {label}
          <input
            id={fieldId}
            type={field.sensitive ? 'password' : 'text'}
            placeholder={
              field.sensitive
                ? field.currentValue
                  ? '已设置（输入新值覆盖）'
                  : '未设置'
                : (field.currentValue ?? '未设置')
            }
            value={value}
            onChange={(e) => onChange(field.envName, e.target.value)}
            style={inputStyle}
            data-testid={`field-${field.envName}`}
          />
        </div>
      );
  }
}
