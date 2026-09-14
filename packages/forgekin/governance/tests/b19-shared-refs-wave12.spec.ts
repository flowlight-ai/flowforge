import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const skillsSource = resolve(process.cwd(), 'packages/forgekin/governance/skills');

// wave12 收尾：确保 skill 正文里所有 `../.cat-cafe-shared-refs/<file>` 相对链接都有真实落盘资产，
// 避免 SKILL.md 原样迁入后留下断链。
describe('B19 wave12 shared refs asset', () => {
  it('exposes a .cat-cafe-shared-refs asset directory', async () => {
    const files = await readdir(join(skillsSource, '.cat-cafe-shared-refs'));
    expect(files.length).toBeGreaterThanOrEqual(30);
  });

  it('every ../.cat-cafe-shared-refs reference in SKILL.md resolves to a real file', async () => {
    const refDir = join(skillsSource, '.cat-cafe-shared-refs');
    const refFiles = new Set(await readdir(refDir));
    // 仅处理真正的 skill 目录（含 SKILL.md），跳过 manifest.yaml / README.md 等文件与非 skill 资产目录
    const dirNames = (await readdir(skillsSource)).filter((n) => n !== '.cat-cafe-shared-refs');
    const skillDirs: string[] = [];
    for (const name of dirNames) {
      const target = join(skillsSource, name);
      const targetStat = await stat(target).catch(() => null);
      if (targetStat?.isDirectory()) skillDirs.push(name);
    }
    let checked = 0;
    let checkedRefs = 0;
    for (const dir of skillDirs) {
      const skillMd = join(skillsSource, dir, 'SKILL.md');
      const content = await readFile(skillMd, 'utf-8').catch(() => null);
      if (content === null) continue;
      const refs = [...content.matchAll(/\.\.\/\.cat-cafe-shared-refs\/([\w.\-]+)/g)].map((m) => m[1]);
      if (refs.length > 0) checked++;
      for (const ref of refs) {
        checkedRefs++;
        expect(refFiles.has(ref), `broken shared-ref '${ref}' from ${dir}/SKILL.md`).toBe(true);
      }
    }
    expect(checked).toBeGreaterThanOrEqual(1);
    expect(checkedRefs).toBeGreaterThanOrEqual(1);
  });
});