# 实施计划：EP-CB1 符号级抽取管线 @flowforge/plugin-codebase

**目标**：在 EP-CB0 结构层之上交付 tree-sitter 符号级抽取：web-tree-sitter（TS/TSX/JS）解析 + 符号节点（Function/Method/Class/Interface/Enum/Type/Variable + 属性族/复杂度）+ 边（DEFINES/DEFINES_METHOD/CALLS/INHERITS/IMPLEMENTS/USAGE）+ get_file_outline/get_code_snippet 工具与 CLI + parse_partial 覆盖率上报；本仓库全量索引验收。

**架构**：五模块（parser 解析器集成 / symbols 符号抽取 / complexity 复杂度计算器 / edges 边解析链 / outline 大纲与片段）+ 存储扩展（QN 查找/outline 查询）+ indexer 两遍集成（符号聚合→注册表→边解析），RAM-first 不变。

**技术栈**：web-tree-sitter@0.25（WASM，运行时依赖，D-CB1 裁决）+ tree-sitter-typescript@0.23 / tree-sitter-javascript 语法资产 + node:sqlite + vitest。

**规格**：docs/process/specs/2026-09-07-plugin-codebase-cb1-design.md；docs/refactor/34-stage-ep-cb-plugin-codebase.md（T2.1-T2.5）。

## 全局约束

- 提交一律走 ./mgr PR；单文件 ≤ 1000 行；退出码契约 0/1/2 对齐 ff_dev/ff_doctor。
- T1-T9：禁止 Mock parser/sqlite——测试用真实 wasm 解析 + 真实临时目录 DB + tests/fixtures/ 语料。
- EP-CB0 既有 57 测试零回归；QN/复杂度/解析链语义以 C 源项目为对照（设计 §4 精确到行号）。
- 34-stage T2.3 原文 CONTAINS_FILE 为笔误（那是 Folder→File 结构边）：文件→符号边按 C 语义为 DEFINES，本批勾选时勘误。

### 任务 1：graph-model 与 store 契约扩展

- [x] 步骤 1：写失败测试 tests/store.spec.ts 增 4 用例——findNodeByQn 精确命中与落空、findNodesByQnSuffix 后缀多候选、fileOutline 行序（startLine 升序）与分页 hasMore、Enum/Type 标签 upsert 往返。
- [x] 步骤 2：实现 graph-model.ts 增 Enum/Type/Field 标签与 DEFINES/DEFINES_METHOD/USAGE 边；store.ts 增 QN 精确/后缀查找与 fileOutline 查询（符号 qn 存 name 列，原名入 props.shortName）。
- [x] 步骤 3：跑 pnpm vitest run packages/plugins/codebase 确认新旧测试通过后进入任务 2。

```ts
findNodeByQn(project: string, qn: string): GraphNode | undefined
findNodesByQnSuffix(project: string, qn: string): readonly GraphNode[]
fileOutline(project: string, filePath: string, opts: { labels?: readonly string[]; limit: number; offset: number }): StoreQueryResult
```

### 任务 2：parser.ts 解析器集成（T2.1）

- [x] 步骤 1：写失败测试 tests/parser.spec.ts 4 用例——TS/TSX/JS 三语言真实解析 program 根且 hasError=false、未知语言 parserFor 返回 undefined、createCodebaseParser 单例复用、SUPPORTED_SYMBOL_LANGUAGES 常量断言。
- [x] 步骤 2：实现 src/parser.ts：createCodebaseParser（createRequire 解析 web-tree-sitter CJS + 三 wasm 路径，Parser.init 后 Language.load 预加载缓存）+ parseFile 同步解析。
- [x] 步骤 3：跑 pnpm vitest run packages/plugins/codebase 确认测试通过后进入任务 3。

```ts
export async function createCodebaseParser(): Promise<CodebaseParser>
export interface CodebaseParser { parseFile(content: string, language: string): Tree | undefined }
export const SUPPORTED_SYMBOL_LANGUAGES: readonly string[] // ['ts','tsx','js','mjs','cjs']
```

### 任务 3：complexity.ts 复杂度计算器（T2.2a）

- [x] 步骤 1：写失败测试 tests/complexity.spec.ts 6 用例——直线代码 0/0、单 if cyclomatic=1、嵌套 if cognitive=1+2、双层循环 loopDepth=2、a.b.c.d maxAccessDepth=3、参数计数 paramCount=2。
- [x] 步骤 2：实现 src/complexity.ts：显式栈帧单遍历（C helpers.c L699-769 移植）+ countParams。
- [x] 步骤 3：跑 pnpm vitest run packages/plugins/codebase 确认测试通过后进入任务 4。

```ts
export function computeComplexity(node: SyntaxNode): ComplexityMetrics
export interface ComplexityMetrics { complexity: number; cognitive: number; loopCount: number; loopDepth: number; maxAccessDepth: number }
export function countParams(paramsNode: SyntaxNode): number
```

### 任务 4：symbols.ts 符号抽取（T2.2b）

- [x] 步骤 1：写失败测试 tests/symbols.spec.ts 8 用例——函数 QN/签名；类+方法 QN 与 DEFINES_METHOD 素材；接口/枚举/类型别名标签；模块级 const→Variable；类字段箭头→Method；嵌套类 QN；匿名箭头跳过；computeQualifiedName 的 index 跳过与点段剥离。
- [x] 步骤 2：实现 src/symbols.ts：computeQualifiedName + extractSymbols（显式栈 walk 帧含 enclosingClassQn；function/class 集；类体方法抽取后仅嵌套类入栈；internal_module 扩作用域；模块级变量）+ 属性族挂接（signature/return_type/paramCount/lines/复杂度/is_test/docstring）。
- [x] 步骤 3：跑 pnpm vitest run packages/plugins/codebase 确认测试通过后进入任务 5。

```ts
export function computeQualifiedName(project: string, relPath: string, name: string): string // proj.src.pkg.file.name；index 主干跳过
export function extractSymbols(tree: Tree, source: string, ctx: { project: string; relPath: string; language: string }): SymbolExtraction
export interface SymbolExtraction { nodes: readonly NodeRecord[]; defines: readonly EdgeMaterial[]; methods: readonly EdgeMaterial[]; parseIncomplete: boolean }
```

### 任务 5：edges.ts 边解析（T2.3）

- [x] 步骤 1：写失败测试 tests/edges.spec.ts 7 用例——同文件调用 same_module、导入函数 import_map、跨文件唯一名 unique_name、弱成员 obj.foo() 未导入时抑制、this.method() 类内解析、extends/implements 边、未解析调用丢弃。
- [x] 步骤 2：实现 src/edges.ts：调用/引用收集（walk 帧含 callerQN）+ buildRegistry（简单名→QN 集）+ resolveCall 五级链（import_map→same_module→qualified_suffix→unique_name→suffix_match；弱成员抑制）+ INHERITS/IMPLEMENTS（heritage 解析）。
- [x] 步骤 3：跑 pnpm vitest run packages/plugins/codebase 确认测试通过后进入任务 6。

```ts
export function buildRegistry(nodes: readonly NodeRecord[]): Registry
export function resolveCall(callee: string, ctx: { fileQn: string; classQn?: string; imports: readonly ImportBinding[]; registry: Registry }): Resolution | undefined
export interface Resolution { readonly qn: string; readonly strategy: 'import_map' | 'same_module' | 'qualified_suffix' | 'unique_name' | 'suffix_match' }
```

### 任务 6：outline.ts + 工具/CLI（T2.4）

- [x] 步骤 1：写失败测试 tests/outline.spec.ts 5 用例——outline 行序与分页、snippet QN 精确命中（行区间文本）、后缀唯一命中、歧义建议列表、未知名返回 not-found 错误。
- [x] 步骤 2：实现 src/outline.ts（fileOutline/codeSnippet 三级解析 + 邻居上下文 ±5 行）+ tools.ts 注册 get_file_outline/get_code_snippet（execute 变 async）+ cli/main.ts 增 outline/snippet 子命令。
- [x] 步骤 3：跑 pnpm vitest run packages/plugins/codebase 确认测试通过后进入任务 7。

```ts
export function fileOutline(store: CodebaseStore, project: string, filePath: string, opts: OutlineOptions): OutlineResult
export function codeSnippet(store: CodebaseStore, project: string, qualifiedName: string, opts: { includeNeighbors?: boolean }): SnippetResult
```

### 任务 7：indexer 集成 + parse_partial（T2.4b）

- [ ] 步骤 1：写失败测试 tests/discover-indexer.spec.ts 增 4 用例——索引后 schema 含 Function/Class 计数、DEFINES 边存在、语法损坏文件上报 parse_partial、非符号语言（.md）不入符号层。
- [ ] 步骤 2：实现 indexer.ts：indexRepository 变 async（结构层不变）；符号层两遍（聚合→注册表→边解析）批量落盘；hasError→coverage.parsePartial；index_status 增 symbolCount/edgeCount。
- [ ] 步骤 3：跑 pnpm vitest run packages/plugins/codebase 确认 57 旧测试零回归 + 新增通过后进入任务 8。

```ts
// 索引结果不变量扩展（IndexResult.coverage.parsePartial 从常量空数组变为真实上报）
const symbolResult = await indexRepository({ repoPath, store, mode: 'fast' }) // 现在返回 Promise
```

### 任务 8：fixture 扩充 + 全套收口

- [ ] 步骤 1：新建 tests/fixtures/mini-repo/symbols/demo.ts（类/接口/枚举/方法/字段箭头/模块级变量/调用/继承/实现/导入全覆盖）与 broken.ts（语法损坏）；cli.spec.ts 增 outline/snippet/符号层 index 冒烟 3 用例。
- [ ] 步骤 2：跑 pnpm vitest run packages/plugins/codebase 全量收口（≥90 用例全绿、连续两次运行一致）。
- [ ] 步骤 3：确认零回归后进入任务 9。

```ts
// cli.spec.ts 冒烟断言形态
const out = runCli(['index', '--repo', repo]); expect(out.code).toBe(0)
const schema = JSON.parse(runCli(['schema', '--repo', repo]).stdout)
expect(schema.nodeLabels.some(l => l.label === 'Function' && l.count > 0)).toBe(true)
```

### 任务 9：本仓库全量验证（T2.5）+ 文档

- [ ] 步骤 1：写验证测试（真实仓库验收，记入 docs/process/verifications/plugin-codebase-cb1.md）：node packages/plugins/codebase/bin/ff_codebase.mjs index --repo . --mode fast 全量索引 exit 0，记录时长/符号数/边数/parse_partial 计数；search --query "store index" 符号级 BM25 非空返回。
- [ ] 步骤 2：跑 outline/snippet 对真实文件（src/store.ts）冒烟测试 exit 0（ff_codebase outline/snippet 输出 JSON 断言 name/label/lines 字段存在），输出数字同步记入验证文档。
- [ ] 步骤 3：跑 pnpm vitest run packages/plugins/codebase 确认全部测试通过（连续两次运行一致）后，34-stage T2.1-T2.5 勾选 + T2.3 边名勘误 + README 批次表更新 + review_code.md §13.0 进度登记，走 ./mgr sync 提交 PR。

```sh
node packages/plugins/codebase/bin/ff_codebase.mjs index --repo . --mode fast
node packages/plugins/codebase/bin/ff_codebase.mjs search --query "store index" --limit 5
node packages/plugins/codebase/bin/ff_codebase.mjs outline --file packages/plugins/codebase/src/store.ts
node packages/plugins/codebase/bin/ff_codebase.mjs snippet --qn flowforge.packages.plugins.codebase.src.store.upsertNodes
```
