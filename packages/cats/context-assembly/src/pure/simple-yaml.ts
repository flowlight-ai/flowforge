/**
 * Minimal YAML subset parser (self-contained).
 *
 * Supports exactly the shape used by workflow-triggers.yaml:
 * a top-level map of `key: value` where a value may be an inline scalar or a
 * `key: |` block scalar followed by indented lines. Comments (`#`) and blank
 * lines are tolerated. This intentionally does NOT implement general YAML.
 */

export function parseSimpleYamlMap(raw: string): Record<string, string> {
  const lines = raw.split('\n');
  const result: Record<string, string> = {};
  let currentKey: string | null = null;
  let currentCollecting = false;

  const flushBlock = (content: string[]) => {
    if (currentKey !== null) {
      const text = content.join('\n');
      result[currentKey] = text.trimEnd();
    }
  };

  let blockLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      if (currentCollecting) blockLines.push('');
      continue;
    }
    // Lines with leading whitespace (4 spaces) continue the current block scalar.
    if (currentCollecting && /^\s{2,}/.test(line)) {
      blockLines.push(trimmed);
      continue;
    }
    // A new unindented key starts a new entry.
    const match = line.match(/^([a-zA-Z0-9_.-]+)\s*:\s*(.*)$/);
    if (match) {
      flushBlock(blockLines);
      currentKey = match[1] ?? null;
      const value = match[2] ?? '';
      if (value === '|') {
        currentCollecting = true;
        blockLines = [];
      } else {
        currentCollecting = false;
        blockLines = [];
        if (currentKey !== null) result[currentKey] = value;
      }
      continue;
    }
    // Non-matching line inside a block scalar (e.g. `#` trailing). Keep going.
    if (currentCollecting) blockLines.push(trimmed);
  }

  if (currentKey !== null && currentCollecting) {
    if (blockLines.length > 0) {
      const text = blockLines.join('\n');
      result[currentKey] = text.trimEnd();
    }
  }

  return result;
}