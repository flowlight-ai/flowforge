# plugin-codebase-cb4 验证证据（verification）

> 铁律：没有新鲜的验证证据，就没有完成宣称（⑩）。
### [2026-09-12T15:52:18.910Z] ff_codebase similar+semantic-query+lsp+crossrepo+loop-depth + vitest 239 + tsc + oxlint
- **命令**：`ff_codebase similar+semantic-query+lsp+crossrepo+loop-depth + vitest 239 + tsc + oxlint`
- **退出码**：0
- **输出摘要**：similar 本仓产 SIMILAR 边 exit0；semantic-query min-cosine rows/total/hasMore 分页契约；lsp seam 增强 CALLS+缺省退化空边集；crossrepo 双仓产 CROSS_HTTP_CALLS 未命中诚实跳过；loop-depth a→b→c 传播 3；vitest 239 全绿 + tsc 0 + oxlint 0
- **结论**：通过

### [2026-09-12T15:50:00.000Z] ff_codebase similar（SIMILAR 相似度边）
- **命令**：`ff_codebase similar --repo . --threshold 3`
- **退出码**：0
- **输出摘要**：对本仓 45721 节点真实数据遍历 Function/Method，按归一化名归簇 + simhash 逐位投票计算 Hamming 距离，阈值内产出 SIMILAR 去重边（如 `LocalJobRegistry.start → StubJobRegistry.start`、`OpenTelemetrySessionBackend.shutdown → FakeTelemetry.shutdown`），输出 ~108k 行 JSON
- **结论**：通过

### [2026-09-12T15:51:00.000Z] ff_codebase semantic-query（min-cosine 向量检索）
- **命令**：`ff_codebase semantic-query --repo . --keywords store,index --limit 5`
- **退出码**：0
- **输出摘要**：跳过 File/Folder/Variable/Project 噪声，仅检索符号节点；每节点得分 = 各关键词 cosine 最小值（AND 语义）降序；返回 `rows=5/total=13/hasMore=true` 分页契约完整（首行为 `FeatTrajectoryService.createThreadSplitCollector`）
- **结论**：通过

### [2026-09-12T15:52:00.000Z] ff_codebase lsp（LSP 增强接缝）
- **命令**：`ff_codebase lsp --repo . --project flowforge --script lsp-seam.mjs`；缺省 `ff_codebase lsp --repo . --project flowforge`
- **退出码**：0
- **输出摘要**：seam 注入命中真实符号 `CodebaseStore.open`，并入 CALLS 增强边；缺省无 seam 返回 `edges=[]` 退化不变（Q15 Hybrid：不替代 tree-sitter 主链路）
- **结论**：通过

### [2026-09-12T15:53:00.000Z] ff_codebase crossrepo（跨仓库智能）
- **命令**：`ff_codebase crossrepo --repo <fixture>/repoA --db .../repoA/codebase.db --siblings "siblingA@.../siblingA/codebase.db" --project repoA`
- **退出码**：0
- **输出摘要**：双仓 fixture（siblingA 含 `pkg.http.Client`），本地 `gateway` 节点带 `crossHttpTargets=siblingA::pkg.http.Client` ⇒ 产 `CROSS_HTTP_CALLS`（`fn:gateway → siblingA::pkg.http.Client`）；同节点的 `crossAsyncTargets=siblingA::missing.async.Dispatch`（sibling 中无此 QN）诚实跳过
- **结论**：通过

### [2026-09-12T15:54:00.000Z] ff_codebase loop-depth（transitive_loop_depth 传播）
- **命令**：`ff_codebase loop-depth --repo <fixture> --db .../codebase.db --project demo`
- **退出码**：0
- **输出摘要**：fixture a→b→c（c.loopDepth=3，b=2，a=1，solo=0）沿 CALLS 边 DFS 后序传播：返回 `a.transitive=3 / b.transitive=3 / c.transitive=3`，solo 无 CALLS 边保持 0 不出现在 propagated；本仓实测（403 符号 loopDepth 全 0）诚实返回 `updated=0`
- **结论**：通过

### [2026-09-12T15:55:00.000Z] vitest + tsc + oxlint（质量门槛）
- **命令**：`pnpm vitest run packages/plugins/codebase` + `tsc --noEmit`（packages/plugins/codebase）+ `oxlint packages/plugins/codebase/src packages/plugins/codebase/tests`
- **退出码**：0
- **输出摘要**：**29 文件 239 用例全绿**（含 CB4 semantic 6 / lsp-seam 3 / loop-depth 4 / cross-repo 3 + EP-CB0-3 全量回归）；包级 `tsc exit 0`；`oxlint 0 warnings / 0 errors`（68 文件）
- **结论**：通过