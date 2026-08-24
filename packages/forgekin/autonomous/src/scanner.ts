/**
 * autonomous scanner — 项目扫描（真实文件系统操作，铁律 2：禁止假数据）。
 *
 * 三类扫描（对齐 Python AutonomousDaemon._scan_*）：
 * 1. 文档缺失（docs/spec.md / docs/arch.md 等）→ doc_generation 任务
 * 2. 代码 TODO/FIXME/NotImplementedError → code_generation 任务
 * 3. 测试缺失（核心模块无对应测试，三级查找策略）→ test_generation 任务
 *
 * @module @flowforge/forgekin-autonomous
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { makeSwarmTask, SwarmTask } from '@flowforge/forgekin-swarm';
import { ScannerConfig } from './config.js';

/** 标题级去重谓词（返回 true 表示任务仍在进行中，应跳过） */
export type InProgressPredicate = (title: string) => boolean;

const neverInProgress: InProgressPredicate = () => false;

/** 递归列出目录下所有文件（返回绝对路径），跳过排除目录段 */
function walkFiles(
  dir: string,
  excludedDirs: ReadonlySet<string>,
  extensions: readonly string[],
): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (excludedDirs.has(entry)) {
      continue;
    }
    const full = path.join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      results.push(...walkFiles(full, excludedDirs, extensions));
    } else if (stats.isFile() && extensions.some((ext) => entry.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

/** 递归列出目录下所有匹配前缀+扩展名的文件（模糊测试查找用） */
function walkTestFiles(
  dir: string,
  excludedDirs: ReadonlySet<string>,
  prefix: string,
  extension: string,
  infix = '',
): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (excludedDirs.has(entry)) {
      continue;
    }
    const full = path.join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      results.push(...walkTestFiles(full, excludedDirs, prefix, extension, infix));
    } else if (
      stats.isFile() &&
      entry.startsWith(prefix) &&
      entry.endsWith(extension) &&
      entry.includes(infix)
    ) {
      results.push(full);
    }
  }
  return results;
}

/** 路径段是否命中排除目录（任意层级） */
function hasExcludedSegment(filePath: string, excludedDirs: ReadonlySet<string>): boolean {
  const segments = filePath.split(path.sep);
  return segments.some((seg) => excludedDirs.has(seg));
}

/**
 * 扫描缺失的文档（doc_generation 任务）。
 */
export function scanMissingDocs(
  projectRoot: string,
  config: ScannerConfig,
): SwarmTask[] {
  const tasks: SwarmTask[] = [];
  for (const docRelPath of config.docChecklist) {
    const docPath = path.join(projectRoot, docRelPath);
    if (!existsSync(docPath)) {
      tasks.push(
        makeSwarmTask({
          title: `补充缺失文档: ${docRelPath}`,
          description:
            `项目根目录下 ${docRelPath} 文件不存在。` +
            '请根据项目实际结构生成对应文档，包含项目概述、架构设计、使用说明等。',
          requiredCapabilities: ['doc_generation'],
          priority: 'normal',
          context: { scan_source: 'autonomous', doc_path: docRelPath },
        }),
      );
    }
  }
  return tasks;
}

/**
 * 扫描代码中的 TODO/FIXME/NotImplementedError（code_generation 任务）。
 *
 * 同一文件只提交一个任务（命中首个模式即停，对齐 Python break）。
 */
export function scanCodeTodos(
  projectRoot: string,
  config: ScannerConfig,
  isInProgress: InProgressPredicate = neverInProgress,
): SwarmTask[] {
  const tasks: SwarmTask[] = [];
  const srcDir = path.join(projectRoot, config.sourceDirName);
  if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) {
    return tasks;
  }

  for (const file of walkFiles(srcDir, config.excludedDirs, config.sourceExtensions)) {
    // 跳过 tests 与第三方/生成目录（Bug 3 修复：排除 .venv 等）
    if (file.split(path.sep).includes(config.testsDirName)) {
      continue;
    }
    if (hasExcludedSegment(file, config.excludedDirs)) {
      continue;
    }
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }

    for (const pattern of config.todoPatterns) {
      const matches = content.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`));
      if (matches && matches.length > 0) {
        const relPath = path.relative(projectRoot, file).split(path.sep).join('/');
        const taskTitle = `修复代码 TODO: ${relPath}`;
        if (!isInProgress(taskTitle)) {
          tasks.push(
            makeSwarmTask({
              title: taskTitle,
              description:
                `文件 ${relPath} 中发现 ${matches.length} 处 TODO/FIXME/NotImplementedError。` +
                '请分析代码上下文并实现缺失的逻辑。',
              requiredCapabilities: ['code_generation'],
              priority: 'normal',
              context: { scan_source: 'autonomous', file: relPath, count: matches.length },
            }),
          );
        }
        break; // 同一文件只提交一个任务
      }
    }
  }
  return tasks;
}

/**
 * 扫描缺失的测试文件（test_generation 任务）。
 *
 * 三级查找策略（对齐 Python，含模糊命名修复）：
 * 1. 精确命名匹配：`tests/test_{mod_name}{ext}` 等候选路径
 * 2. 模糊命名匹配：tests 目录下递归查找 `test_*{mod_name}*{ext}`
 * 3. 内容 import 匹配：测试文件中含模块 import 路径或模块名
 */
export function scanMissingTests(
  projectRoot: string,
  config: ScannerConfig,
  isInProgress: InProgressPredicate = neverInProgress,
): SwarmTask[] {
  const tasks: SwarmTask[] = [];
  const srcDir = path.join(projectRoot, config.sourceDirName);
  const testsDir = path.join(srcDir, config.testsDirName);

  if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) {
    return tasks;
  }

  for (const modRel of config.coreModules) {
    const modPath = path.join(srcDir, modRel);
    if (!existsSync(modPath)) {
      continue;
    }

    const modName = path.basename(modRel).replace(/\.[^.]+$/, '');
    const testFileName = `${config.testFilePrefix}${modName}${config.testFileExtension}`;

    // 1. 精确命名匹配
    const candidates = [
      path.join(testsDir, testFileName),
      path.join(testsDir, modName, testFileName),
      path.join(testsDir, 'unit', testFileName),
      path.join(testsDir, 'integration', testFileName),
    ];
    // 模块自身目录下的 tests（如 flowforge/forgemind/tests/）
    const modDirTests = path.join(path.dirname(modPath), config.testsDirName);
    if (existsSync(modDirTests) && statSync(modDirTests).isDirectory()) {
      candidates.push(path.join(modDirTests, testFileName));
    }
    let hasTest = candidates.some((c) => existsSync(c));

    // 2. 模糊命名匹配：递归查找包含 modName 的测试文件
    if (!hasTest && existsSync(testsDir)) {
      const fuzzy = walkTestFiles(
        testsDir,
        config.excludedDirs,
        config.testFilePrefix,
        config.testFileExtension,
        modName,
      );
      if (fuzzy.length > 0) {
        hasTest = true;
      }
    }

    // 3. 内容 import 匹配：查找 import 该模块的测试文件
    if (!hasTest && existsSync(testsDir)) {
      const modImport =
        `${config.importPrefix}.` +
        modRel.split('/').join('.').replace(/\.[^.]+$/, '');
      const testFiles = walkTestFiles(
        testsDir,
        config.excludedDirs,
        config.testFilePrefix,
        config.testFileExtension,
      );
      for (const testFile of testFiles) {
        try {
          const testContent = readFileSync(testFile, 'utf-8');
          if (testContent.includes(modImport) || testContent.includes(modName)) {
            hasTest = true;
            break;
          }
        } catch {
          continue;
        }
      }
    }

    if (!hasTest) {
      const taskTitle = `补充测试: ${modRel}`;
      if (!isInProgress(taskTitle)) {
        tasks.push(
          makeSwarmTask({
            title: taskTitle,
            description:
              `模块 ${modRel} 缺少单元测试。请为该模块的核心功能编写测试用例，` +
              '覆盖主要分支和边界条件。',
            requiredCapabilities: ['test_generation'],
            priority: 'low',
            context: { scan_source: 'autonomous', module: modRel },
          }),
        );
      }
    }
  }

  return tasks;
}

/**
 * 扫描项目发现任务（三类汇总，对齐 Python _scan_project）。
 */
export function scanProject(
  projectRoot: string,
  config: ScannerConfig,
  isInProgress: InProgressPredicate = neverInProgress,
): SwarmTask[] {
  const tasks: SwarmTask[] = [];
  tasks.push(...scanMissingDocs(projectRoot, config));
  tasks.push(...scanCodeTodos(projectRoot, config, isInProgress));
  tasks.push(...scanMissingTests(projectRoot, config, isInProgress));
  return tasks;
}
