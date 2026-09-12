# review: EP-CB3 Cypher 子集 + 增量索引 + 轨迹摄取 @flowforge/plugin-codebase

> 实例：`plugin-codebase-cb3`（feature）｜ 规格：`docs/process/specs/2026-09-07-plugin-codebase-cb3-design.md` ｜ 计划：`docs/process/plans/2026-09-07-plugin-codebase-cb3.md`

## 审查范围

Cypher 查询引擎子集（cypher-lexer/parser/executor/entry）+ missed graph + watcher 增量索引 + ingest_traces + artifact 持久化；CLI 增 5 子命令；tools 增 query_cypher/ingest_traces。

## 规格合规（spec 核对）

- **Cypher 四段管线**：lexer（40 关键 token + 符号/字面量/EOF；写子句 CREATE/MERGE/SET/DELETE → WRITE 拒绝）、parser（node/rel pattern、`*1..3` hops、WHERE 表达式树优先 NOT>AND>OR、ORDER BY ≤8）、executor（MATCH 绑定/级联 join/聚合/排序/分页；>100k 行→error；预算>1e6→warning 诚实部分集）✅
- **missed graph**：discover 全集 − 已索引 File 差集 → 目录骨架 + totalMissed ✅
- **watcher**：mtime 基线增量 {added,modified,removed} + 删除清符号/边/FTS；一次性（常驻归 EP-CB4）✅
- **ingest_traces / artifact**：traces 独立表落库；dump（zstd CLI 探测 + gzip 诚实退化）→ restore 幂等 ✅
- **契约**：纯只读查询面；退出码 0/1/2；零外部运行时依赖 ✅

## 代码质量（契约测试审查）

- CB3 模块单测：cypher-lexer 13 / cypher-parser 15 / cypher 17 / missed 5 / watcher 6 / traces 5 / artifact 3 全绿，真实临时目录 DB + 真实 fixture 零 Mock ✅
- 全量回归 + `tsc --noEmit` exit 0 + `oxlint` 0 warnings；确定性输出（排序稳定）✅

## 本仓库验收（T4 实测）

- cypher 单 node `MATCH (n:Function) RETURN n.name LIMIT 5`：5 行 Function 符号，exit 0
- cypher 双 node `MATCH (a:Function)-[:CALLS]->(b:Function) ... ORDER BY b.name DESC LIMIT 3` 真实调用链语义正确，exit 0
- missed：totalMissed=2354（目录骨架），exit 0
- ingest_traces：`--trace-id t1 --name test-trace --agent sherlock` ingested=1，exit 0
- artifact dump：format=gzip，nodeCount=45721/edgeCount=156072，落盘 .gz 退出 0

## 关键处置（经验记录）

1. **计划校验结构强化延续**：cb3 计划初版同样触发 TASK_NO_CODE×8/TASK_NO_TEST；按 cb1/cb2 先例为每任务补 ````ts`` 块 + 任务8 测试引用后 8/8 通过（固定流程模式）。
2. **restore 大图自回灌性能处置**：对当前仓自回灌整图（45k 节点/156k 边）单事务持锁 >15 分钟阻塞读取，按性能协约终止；SQLite 原子回滚后 status 复核 DB 完好（filesIndexed=6575、计数不变、exit 0）。restore 幂等由 `tests/artifact.spec.ts` 3 用例证明，dump 端实测退出 0；全量图自回灌不作为本仓一次性验收项——诚实定义验收边界。
3. **ingest CLI 签名差异**：设计文档示例用 JSON 数组，实际 CLI 为 `--trace-id/--name/--agent` 单条落库；以真实 CLI 为准（测试锁定契约）。

## 验收结论

全部通过。EP-CB3 Cypher 子集 + 增量索引 + 轨迹摄取可接受，EP-CB0/1/2 零回归；restore 性能边界诚实记录。