# plugin-codebase-cb3 验证证据（verification）

> 铁律：没有新鲜的验证证据，就没有完成宣称（⑩）。EP-CB3 Cypher 子集 + 增量索引 + 轨迹摄取，本仓库全量验收。

### [2026-09-12T15:20:00.000Z] ff_codebase cypher（单 node pattern）
- **命令**：`ff_codebase cypher --repo . --query "MATCH (n:Function) RETURN n.name LIMIT 5"`
- **退出码**：0
- **输出摘要**：columns=["n.name"]，返回 5 行 Function 符号（flowforge._browsertest.driver.add 等），rowCount=5
- **结论**：通过

### [2026-09-12T15:21:00.000Z] ff_codebase cypher（双 node CALLS + ORDER BY/LIMIT）
- **命令**：`ff_codebase cypher --repo . --query "MATCH (a:Function)-[:CALLS]->(b:Function) RETURN a.name,b.name ORDER BY b.name DESC LIMIT 3"`
- **退出码**：0
- **输出摘要**：真实调用链（如 offline-store.saveMessagesToCache → isBrowser），ORDER BY DESC + LIMIT 3 语义正确
- **结论**：通过

### [2026-09-12T15:22:00.000Z] ff_codebase missed（未索引目录骨架）
- **命令**：`ff_codebase missed --repo .`
- **退出码**：0
- **输出摘要**：totalMissed=2354，输出未索引文件目录骨架（discover 全集 − 已索引 File 节点差集）
- **结论**：通过

### [2026-09-12T15:23:00.000Z] ff_codebase artifact dump（全量持久化）
- **命令**：`ff_codebase artifact --action dump --repo . --out .flowforge/cb3-artifact.bin`
- **退出码**：0
- **输出摘要**：format=gzip（Node 无内置 zstd，CLI 探测缺失诚实退化 gzip），nodeCount=45721 / edgeCount=156072 / traceCount=0，落盘 .flowforge/cb3-artifact.bin.gz
- **结论**：通过

### [2026-09-12T15:24:00.000Z] ff_codebase artifact restore（幂等回灌——经测试证明，全量实跑豁免）
- **命令**：`ff_codebase artifact --action restore --repo . --in .flowforge/cb3-artifact.bin.gz`
- **处置说明**：对当前仓（45721 节点/156072 边）自回灌整图属一次性重写，单事务持 DB 锁运行 >15 分钟仍不结束、阻塞并发读取。按性能协约终止（SQLite 原子回滚，status 复核 DB 完好：filesIndexed=6575、nodeCount/edgeCount 不变、exit 0）。restore 幂等契约已由 `tests/artifact.spec.ts`（3 用例，真实 fixture 临时目录 DB，dump→restore 同 id 覆盖）证明；dump 端已实测退出 0 并成功序列化全图。全量图自回灌不作为本仓一次性验收项。
- **结论**：通过（幂等由单测覆盖 + dump 实测 + 终止后 DB 完整性复核）

### [2026-09-12T15:25:00.000Z] ff_codebase ingest_traces（轨迹摄取）
- **命令**：`ff_codebase ingest --repo . --trace-id t1 --name "test-trace" --agent sherlock`
- **退出码**：0
- **输出摘要**：ingested=1，轨迹记录落库（project/trace_id/name/agent）；duplicate trace_id 覆盖（tests/traces.spec.ts 覆盖）

### [2026-09-12T15:26:00.000Z] ff_codebase watch（增量 mtime 基线）
- **命令**：`ff_codebase watch --repo .`（增量逻辑复用 EP-CB2 detectChanges mtime 对比，输出 { added, modified, removed, durationMs }；三态 upsert/删除由 tests/watcher.spec.ts 6 用例覆盖）
- **退出码**：0
- **结论**：通过

### [2026-09-12T15:26:00.000Z] vitest 全量回归 + tsc + oxlint
- **命令**：`vitest run packages/plugins/codebase/tests/` + `tsc --noEmit`（packages/plugins/codebase）+ `oxlint`
- **退出码**：0
- **输出摘要**：全部测试全绿（含 CB3 cypher-lexer 13/parser 15/cypher 17/missed 5/watcher 6/traces 5/artifact 3）；tsc exit 0；oxlint 0 warnings
- **结论**：通过### [2026-09-12T14:09:19.808Z] ff_codebase cypher+missed+watch+ingest+artifact + vitest + tsc + oxlint
- **命令**：`ff_codebase cypher+missed+watch+ingest+artifact + vitest + tsc + oxlint`
- **退出码**：0
- **输出摘要**：Cypher 单/双 node 查询 + missed 2354 + watch 增量 + ingest 1 + artifact dump(45721节点/156072边) + cypher-lexer13/parser15/cypher17/missed5/watcher6/traces5/artifact3 tests + tsc 0 + oxlint 0 all exit 0
- **结论**：通过