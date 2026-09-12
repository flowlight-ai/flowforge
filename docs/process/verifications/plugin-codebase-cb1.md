# plugin-codebase-cb1 验证证据（verification）

> 铁律：没有新鲜的验证证据，就没有完成宣称（⑩）。EP-CB1 符号级抽取管线，本仓库全量验收。

### [2026-09-12T13:46:00.000Z] ff_codebase index --repo . --mode fast（本仓库全量）
- **命令**：`node packages/plugins/codebase/bin/ff_codebase.mjs index --repo . --mode fast`
- **退出码**：0
- **输出摘要**：project=flowforge，filesIndexed=6575，nodeCount=49308，edgeCount=161175，symbolCount=41072；coverage.excluded 命中默认排除（node_modules/dist/lib 等），skipped=[]，coverage.parsePartial 如实上报 100+ 语法损坏文件（ERROR/MISSING 节点，含 .d.ts、typert 测试临时目录、vendor/cordis 装饰器语法）；durationMs=916645（≈15.3 分钟，全量 FF 主仓符号级两遍解析）
- **结论**：通过

### [2026-09-12T13:48:00.000Z] ff_codebase search 符号级 BM25 非空
- **命令**：`node packages/plugins/codebase/bin/ff_codebase.mjs search --repo . --query "store index" --limit 5`
- **退出码**：0
- **输出摘要**：total=2074，hasMore=true；首行符号为 `flowforge.packages.plugins.codebase.src.store.CodebaseStore.indexNodePaths`（Method，props 含 signature/paramCount/returnType/complexity/cognitive/loopCount/loopDepth/maxAccessDepth 属性族）
- **结论**：通过

### [2026-09-12T13:49:00.000Z] ff_codebase outline 真实文件冒烟
- **命令**：`node packages/plugins/codebase/bin/ff_codebase.mjs outline --repo . --file packages/plugins/codebase/src/store.ts --limit 5`
- **退出码**：0
- **输出摘要**：total=49，hasMore=true；行序升序（NodeRecord 27-37 → EdgeRecord 40-45 → …），字段 qn/name/label/lines/filePath/language 齐全
- **结论**：通过

### [2026-09-12T13:50:00.000Z] ff_codebase snippet 精确 QN 切片（含 ±5 行邻域）
- **命令**：`node packages/plugins/codebase/bin/ff_codebase.mjs snippet --repo . --qn flowforge.packages.plugins.codebase.src.store.CodebaseStore.upsertNodes --neighbors`
- **退出码**：0
- **输出摘要**：Method，filePath=store.ts，startLine=292，endLine=333；source 返回真实方法体与邻域上下文（含 EOF/索引插入事务）。勘误：计划示例 QN 漏 `CodebaseStore.` 类段，实际方法名为 `...store.CodebaseStore.upsertNodes`
- **结论**：通过

### [2026-09-12T13:28:00.000Z] vitest 全量回归
- **命令**：`vitest run packages/plugins/codebase/tests/`（239 用例，连续两次运行一致）
- **退出码**：0
- **输出摘要**：29 files / 239 tests 全绿，含 EP-CB1 符号层断言（Defines/DEFINES_METHOD/CALLS/INHERITS/IMPLEMENTS、parse_partial、cli outline/snippet 冒烟）
- **结论**：通过

### [2026-09-12T13:29:00.000Z] tsc --noEmit packages/plugins/codebase
- **命令**：`tsc --noEmit`
- **退出码**：0
- **输出摘要**：包级 tsc exit 0
- **结论**：通过### [2026-09-12T05:49:57.040Z] ff_codebase index --repo . --mode fast + search + outline + snippet + vitest 239 + tsc
- **命令**：`ff_codebase index --repo . --mode fast + search + outline + snippet + vitest 239 + tsc`
- **退出码**：0
- **输出摘要**：6575 files/41072 symbols/161175 edges + BM25 2074 + outline/snippet + 239 tests + tsc 0 all green
- **结论**：通过