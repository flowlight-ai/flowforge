# T8.3a-a2 组合根挂载 实施计划

> **执行者必读**：使用 executing-plans（③）行内执行本计划。步骤使用 checkbox（`- [ ]`）跟踪。
> **前提修正**：组合根已存在（`packages/bundle/web-app/cordis.patch.yml:96-97` 已挂 `@flowforge/host-webserver`），本计划**不新建 bundle**，只增一行挂载与依赖。详见 `docs/process/specs/2026-09-09-web-t83a2-composition-root-design.md`。
> **产物保全教训**：本文件曾因并行会话的 sync stash/merge 周期丢失（未跟踪文件被吞），故流程产物一律随子项目提交入库，不留在未跟踪态。

**目标**：把 `@flowforge/host-cats-api` 挂进 web-app 组合根，使 `/api/profile-updates` 在 profile 启动时可用。
**架构**：patch 清单 layer 2 增 `cats-api` 行（`inject: [webServer]`）→ 包清单补 workspace 依赖（peer+dev，与 host-webserver 同构）→ 以既有 bundle 断言测试锁定。
**技术栈**：cordis patch YAML（Loader）+ pnpm workspace。
**规格**：`docs/process/specs/2026-09-09-web-t83a2-composition-root-design.md`

## 全局约束

- 只改 `packages/bundle/web-app/cordis.patch.yml`、`packages/bundle/web-app/package.json`、`packages/bundle/web-app/tests/web-app.spec.ts`（以及为消费方补导出类型的 `packages/cats/routes/src/index.ts`）
- 不改 base bundle、不改 webserver 行、不新增启动脚本
- 新增行必须带 `inject: [webServer]`
- 端口口径：由 `webStartup` 提供（dev 默认 3080），不引入独立 env
- 提交走 `./mgr commit` / `./mgr sync`，规范 `type(scope): 描述 [sherlock]`

---

### 任务 1：patch 清单增加挂载行

**文件**：
- 修改：`packages/bundle/web-app/cordis.patch.yml`（`connection` 行之后）

**接口**：
- 消费：`@flowforge/host-cats-api`（PR#163，内部调用 `ctx.webServer.register`）

- [x] **步骤 1：在 layer 2 末尾（`connection` 行之后）插入**

```yaml
    # cats HTTP mount (T8.3a-a2): the profile-updates route group over the
    # shared webserver row. Injecting webServer keeps activation after the bind.
    - id: cats-api
      name: '@flowforge/host-cats-api'
      inject: [webServer]
```

- [x] **步骤 2：以仓库自定义 schema 解析测试确认（bundle 断言测试承载）**

`!!js` 是仓库自定义 YAML tag，普通 `js-yaml` 无法解析；验证由 `packages/bundle/web-app/tests/web-app.spec.ts`（使用 `entryListSchema`）承载，见任务 3 步骤 2。

- [x] **步骤 3：提交**

```sh
git add packages/bundle/web-app/cordis.patch.yml
./mgr commit "build(bundle-web-app): T8.3a-a2组合根挂载host-cats-api [sherlock]"
```

---

### 任务 2：包依赖登记（peer+dev 同构）

**文件**：
- 修改：`packages/bundle/web-app/package.json`（`peerDependencies` 与 `devDependencies`）
- 修改：`pnpm-lock.yaml`（`pnpm install` 自动更新）

**接口**：
- 产出：`@flowforge/host-cats-api` 在 web-app bundle 内可解析

- [x] **步骤 1：两段依赖各增加一行（与 host-webserver 同构）**

```json
    "@flowforge/host-cats-api": "workspace:^",
```

- [x] **步骤 2：安装并测试确认**

```sh
pnpm install
```

```sh
node -e "const f=require('fs');console.log('link:',f.existsSync('packages/bundle/web-app/node_modules/@flowforge/host-cats-api'))"
```

测试通过标准：install 退出码 0 且第二条输出 `link: true`。

- [x] **步骤 3：提交**

```sh
git add packages/bundle/web-app/package.json pnpm-lock.yaml
./mgr commit "build(bundle-web-app): 补host-cats-api的peer+dev工作区依赖 [sherlock]"
```

---

### 任务 3：断言测试、类型导出与回归

**文件**：
- 修改：`packages/bundle/web-app/tests/web-app.spec.ts`（"declares web-only host rows" 用例）
- 修改：`packages/cats/routes/src/index.ts`（导出列表端口类型，供消费方引用）

**接口**：
- 消费：任务 1 的新增行

- [x] **步骤 1：扩展既有断言**

```ts
    expect(rows.find(row => row.id === 'cats-api')?.name).toBe('@flowforge/host-cats-api')
    expect(rows.find(row => row.id === 'cats-api')?.inject).toEqual(['webServer'])
```

- [x] **步骤 1b：cats-routes 导出列表端口类型**

```ts
export type {
  BacklogPort,
  MemoryPublishPort,
  PackExporterPort,
  PackLoaderPort,
  ProfileUpdateListQuery,
  ProfileUpdateListResult,
  ProfileUpdatePort,
  SelfClaimPolicyPort,
} from './ports.ts'
```

（消费方测试 `packages/host/cats-api/tests/profile-updates-list.spec.ts` 需要 `ProfileUpdateListQuery`。）

- [x] **步骤 2：运行测试确认**

```sh
pnpm vitest run packages/bundle/web-app packages/host/cats-api
```

测试通过标准：7 文件 28 项全绿。

- [x] **步骤 3：类型与 lint 测试确认**

```sh
pnpm tsc -b packages/host/cats-api --force
```

```sh
pnpm lint
```

测试通过标准：`tsc -b` 退出码 0；lint 输出 `0 errors`。

- [x] **步骤 4：提交**

```sh
git add packages/cats/routes/src/index.ts packages/bundle/web-app/tests/web-app.spec.ts
./mgr commit "feat(cats-routes)+test(bundle-web-app): 导出列表端口类型+断言cats-api挂载行 [sherlock]"
```

---

### 任务 4：证据登记与 PR 收尾

**文件**：
- 无源码变更；产物为验证证据与 PR

- [ ] **步骤 1：重建实例状态并登记证据**

实例文件会被并行会话的 sync 周期吞掉（未跟踪文件），故先重放门禁再登记：

```sh
node packages/plugins/dev/bin/ff_dev.mjs init plugin-web-t83a2 --workflow change
node packages/plugins/dev/bin/ff_dev.mjs gate plugin-web-t83a2 design --score 0.8975 --evidence docs/process/specs/2026-09-09-web-t83a2-composition-root-design.md --approver operator
node packages/plugins/dev/bin/ff_dev.mjs advance plugin-web-t83a2
node packages/plugins/dev/bin/ff_dev.mjs advance plugin-web-t83a2
node packages/plugins/dev/bin/ff_dev.mjs gate plugin-web-t83a2 plan --evidence docs/process/plans/2026-09-09-web-t83a2-composition-root.md
node packages/plugins/dev/bin/ff_dev.mjs advance plugin-web-t83a2
node packages/plugins/dev/bin/ff_dev.mjs advance plugin-web-t83a2
node packages/plugins/dev/bin/ff_dev.mjs advance plugin-web-t83a2
node packages/plugins/dev/bin/ff_dev.mjs evidence plugin-web-t83a2 --command "pnpm vitest run packages/bundle/web-app" --exit 0 --summary "bundle 断言含 cats-api 行与 inject，17 项全绿"
node packages/plugins/dev/bin/ff_dev.mjs evidence plugin-web-t83a2 --command "pnpm vitest run packages/host/cats-api" --exit 0 --summary "cats-api 11 项不回归"
node packages/plugins/dev/bin/ff_dev.mjs evidence plugin-web-t83a2 --command "pnpm tsc -b packages/host/cats-api --force" --exit 0 --summary "cats-api 构建类型通过"
node packages/plugins/dev/bin/ff_dev.mjs advance plugin-web-t83a2
node packages/plugins/dev/bin/ff_dev.mjs status plugin-web-t83a2
```

测试通过标准：`status` 输出含 `designApproved=✓ planValidated=✓ verificationEvidence=✓` 且推进至 finish。

- [ ] **步骤 2：提交流程产物并建 PR（产物随本子项目入库，避免再次丢失）**

```sh
git add docs/process/specs/2026-09-09-web-t83a2-composition-root-design.md docs/process/plans/2026-09-09-web-t83a2-composition-root.md docs/process/instances/plugin-web-t83a2.json docs/process/verifications/plugin-web-t83a2.md
./mgr commit "docs(process): T8.3a-a2流程产物-设计前提修正/计划/实例/验证证据 [sherlock]"
./mgr sync "build(bundle-web-app): T8.3a-a2组合根挂载host-cats-api [sherlock]" --body "T8.3a 第 2 子项目（实例 plugin-web-t83a2，change 工作流）。前提修正：主设计假定仓库缺 web bundle，实现前勘查发现 packages/bundle/web-app/cordis.patch.yml:96-97 已挂载 @flowforge/host-webserver（host/port 由 webStartup 提供，dev 默认 3080），故不新建 bundle，只在该清单 layer 2 增一行 cats-api（inject: [webServer]），并在 web-app 包清单按 host-webserver 同构补 peer+dev 工作区依赖；另为消费方补 cats-routes 的列表端口类型导出。连带口径：网关端口以 web-app 实际监听端口为准（dev 默认 3080），a3 前端代理据此切分，不再设独立 FF_GATEWAY_PORT。验证：bundle 断言扩展（cats-api 行 name 与 inject）17 项全绿、cats-api 11 项不回归、tsc -b 通过、lint 0 errors。""
```

测试通过标准：`./mgr sync` 返回 Gitee PR 链接，PR 标题 ≤191 字符。

---

## 自审记录

- **规格覆盖**：设计文档"架构"三点 → 任务 1（patch 行）、任务 2（依赖）、任务 3（断言/类型/回归）、任务 4（证据+PR）。无遗漏。
- **占位符扫描**：无未决占位标记/"同任务 N"式懒引用；patch 片段、依赖行、断言与导出均给出全文。
- **类型一致性**：行 id `cats-api`、包名 `@flowforge/host-cats-api`、注入 `webServer` 三处一致；端口口径与既有 webserver 行一致。
