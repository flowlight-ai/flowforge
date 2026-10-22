# EP-CB8 图谱交互（真实拾取 + 项目选择）实施计划

> 执行者必读：使用 subagent-driven-development（④）或 executing-plans（③）逐任务执行；步骤用 checkbox 跟踪。

**目标**：把 graph-ui 的简化二维最近命中替换为真实相机射线投射，并让 web 图谱页支持工程下拉切换。

**架构**：`@flowforge/graph-ui` 仍不静态依赖 three，扩展极窄 `ThreeBinding` 注入面（新增 `Vector2`/`Raycaster`）；`ThreeForceGraphRenderer` 用注入的射线器命中节点 mesh 的 `userData.node`。web 侧 Route Handler 增加 `?list=1` 只读工程列表，浏览器端口 `listHttpProjects()` 拉取，宿主视图持有下拉并把选中工程传入既有 `buildPort(project)` 重装配；`GraphPanel` 在端口变化时先释放旧渲染。

**技术栈**：TypeScript 5.x / ESM、vitest、Next.js 14 App Router、three（仅由 web 注入）、`node:sqlite`（服务端只读）。

**规格**：`docs/process/specs/2026-10-22-plugin-codebase-cb8-interaction-design.md`

## 全局约束

- 不改 `@flowforge/plugin-codebase` 任何源码/契约/测试，只消费其只读查询面。
- graph-ui 包零新增运行依赖；不出现 `import ... from 'three'`。
- `RendererPort` 三方法签名保持不变（`renderGraph` / `onNodeSelect` / `dispose`）。
- 既有 `/codebase-graph/data?project=` 行为与响应形状不变；新增分支必须 `Cache-Control: no-store`。
- 单文件 ≤ 1000 行；提交信息 `type(scope): 描述 [sherlock]`，远程操作只走 `./mgr`。

## 任务 1：graph-ui 真实射线拾取

**文件**：
- 修改：`packages/plugins/graph-ui/src/render/ports.ts`
- 修改：`packages/plugins/graph-ui/src/render/three.ts`
- 测试：`packages/plugins/graph-ui/tests/render.spec.ts`

**接口**：
- 产出：`ThreeBinding.Vector2`（`new (x?: number, y?: number) => unknown`）、`ThreeBinding.Raycaster`（`new () => ThreeRaycaster`）。
- 产出：`ThreeRaycaster.setFromCamera(coords, camera)`、`ThreeRaycaster.intersectObjects(objects, recursive?) → ReadonlyArray<{ object: unknown }>`。
- 消费：既有 `GraphNode`、`LayoutResult`、`RendererPort`。

- [ ] **步骤 1：写失败测试（渲染桩命中 + 坐标归一化）**

```ts
// packages/plugins/graph-ui/tests/render.spec.ts（追加）
it('pointerdown 经射线命中返回真实 GraphNode', () => {
  const listeners: Record<string, EventListener> = {}
  const canvas = {
    clientWidth: 800,
    clientHeight: 500,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 500, right: 800, bottom: 500, x: 0, y: 0, toJSON: () => ({}) }),
    addEventListener: (type: string, cb: EventListener) => { listeners[type] = cb },
    removeEventListener: () => {},
  } as unknown as HTMLElement
  const selected: GraphNode[] = []
  const renderer = new ThreeForceGraphRenderer({ binding: fakeBinding, canvas })
  renderer.renderGraph(sampleData, sampleLayout)
  renderer.onNodeSelect((node) => selected.push(node))
  listeners.pointerdown!({ clientX: 400, clientY: 250 } as PointerEvent)
  expect(selected).toHaveLength(1)
  expect(selected[0]!.id).toBe('cls')
  expect(selected[0]).toBe(sampleData.nodes[2])
})

it('pointer 坐标按画布归一化后送入 setFromCamera', () => {
  // 断言 fake Raycaster 收到 x=0, y=0，且 intersectObjects 收到 3 个 mesh
  expect(fakeRaycast.calls).toEqual([{ x: 0, y: 0, objectCount: 3 }])
})
```

- [ ] **步骤 2：运行测试确认失败**

```sh
npx vitest run packages/plugins/graph-ui/tests/render.spec.ts
```

预期失败：`binding.Raycaster is not a constructor`（渲染器仍在用 `pickNearest`）。

- [ ] **步骤 3：写最小实现**

```ts
// packages/plugins/graph-ui/src/render/ports.ts（追加）
/** 注入式射线器结构面（three Raycaster 的最小成员集）。 */
export interface ThreeRaycaster {
  setFromCamera(coords: unknown, camera: unknown): void
  intersectObjects(objects: readonly unknown[], recursive?: boolean): ReadonlyArray<{ readonly object: unknown }>
}

// ThreeBinding 追加
readonly Vector2: new (x?: number, y?: number) => unknown
readonly Raycaster: new () => ThreeRaycaster
```

```ts
// packages/plugins/graph-ui/src/render/three.ts（替换 pickNearest 相关逻辑）
private nodeMeshes: unknown[] = []

// renderGraph 节点循环内：
;(mesh as { userData?: unknown }).userData = { node }
this.nodeMeshes.push(mesh)

// handlePointerDown：
const rect = this.canvas.getBoundingClientRect()
const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
const y = -((event.clientY - rect.top) / rect.height) * 2 + 1
const pointer = new this.binding.Vector2(x, y)
const raycaster = new this.binding.Raycaster()
raycaster.setFromCamera(pointer, this.camera)
const hit = raycaster.intersectObjects(this.nodeMeshes)[0]
const node = (hit?.object as { userData?: { node?: GraphNode } } | undefined)?.userData?.node
if (node) cb(node)
```

`dispose()` 增加 `this.nodeMeshes = []`；删除 `pickNearest` 方法与其注释。

- [ ] **步骤 4：运行测试确认通过**

```sh
npx vitest run packages/plugins/graph-ui
npx tsc --build packages/plugins/graph-ui/tsconfig.json
npx oxlint packages/plugins/graph-ui
```

预期：全部通过（render.spec 7 例，包级 27 例）；tsc exit 0；oxlint 0 warning。

- [ ] **步骤 5：提交**

```sh
./mgr commit "feat(graph-ui): 真实相机射线拾取替换简化最近命中 [sherlock]"
```

## 任务 2：web 工程列表端点与浏览器端口

**文件**：
- 修改：`web/src/app/codebase-graph/data/route.ts`
- 修改：`web/src/components/codebase/http-codebase-read.ts`

**接口**：
- 产出：`GET /codebase-graph/data?list=1 → { projects: string[] }`。
- 产出：`listHttpProjects(): Promise<string[]>`（失败返回 `[]`）。
- 消费：`CodebaseStore.listProjects()`（返回 `readonly ProjectInfo[]`）。

- [ ] **步骤 1：写失败测试（端点契约断言）**

```ts
// web 侧无 vitest 门禁，用 tsc + dev server 冒烟作为契约验证：
// GET /codebase-graph/data?list=1 → 200, {"projects":["flowforge"]}
// GET /codebase-graph/data?list=1 响应头 Cache-Control: no-store
```

- [ ] **步骤 2：运行确认失败**

```sh
curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/codebase-graph/data?list=1"
```

预期：未实现分支时返回 404/500（现分支把 `list=1` 当 project 名解析）。

- [ ] **步骤 3：写最小实现**

```ts
// route.ts GET 首部
const params = req.nextUrl.searchParams
if (params.get('list') === '1') {
  const projects = openCodebaseStore().listProjects().map((p) => p.name)
  return NextResponse.json({ projects }, { headers: { 'Cache-Control': 'no-store' } })
}
```

```ts
// http-codebase-read.ts 追加
export async function listHttpProjects(): Promise<string[]> {
  try {
    const res = await fetch('/codebase-graph/data?list=1', { cache: 'no-store' })
    if (!res.ok) return []
    const payload = (await res.json()) as { projects?: unknown }
    return Array.isArray(payload.projects) ? payload.projects.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}
```

- [ ] **步骤 4：运行确认通过**

```sh
pnpm --filter web-frontend exec tsc --noEmit
```

预期：exit 0。

- [ ] **步骤 5：提交**

```sh
./mgr commit "feat(web): 图谱数据端点增工程列表分支 [sherlock]"
```

## 任务 3：工程下拉与切换重装配

**文件**：
- 修改：`web/src/components/codebase/CodebaseGraphView.tsx`
- 修改：`web/src/components/graph/GraphPanel.tsx`

**接口**：
- 消费：`listHttpProjects()`、`buildPort(project)`、`GraphPanel { enabled, project, port }`。
- 产出：`CodebaseGraphView` 内 `<select>` 受控组件；切换后 `port` 重建。

- [ ] **步骤 1：写失败测试（渲染断言）**

```ts
// 浏览器 E2E 冒烟（TS 门禁外的行为断言）：
// 1) 打开 /codebase/graph?enabled=1 → 出现 select[data-project-select]
// 2) 选择 flowforge → 面板标题含 flowforge 且节点数 > 0
```

- [ ] **步骤 2：运行确认失败**

```sh
curl -s "http://localhost:3000/codebase/graph?enabled=1" | grep -c "data-project-select"
```

预期：0（当前仅有 URL 参数，无下拉）。

- [ ] **步骤 3：写最小实现**

```tsx
// CodebaseGraphView.tsx
const [projects, setProjects] = useState<string[]>([])
const [selected, setSelected] = useState(project)
useEffect(() => {
  let cancelled = false
  void listHttpProjects().then((list) => {
    if (cancelled || list.length === 0) return
    setProjects(list)
    if (!params.get("project")) setSelected(list[0]!)
  })
  return () => { cancelled = true }
}, [params])
const port = useMemo(() => buildPort(selected), [selected])

// enabled 时：
<select data-project-select value={selected} onChange={(e) => setSelected(e.target.value)}>
  {projects.map((p) => <option key={p} value={p}>{p}</option>)}
</select>
<GraphPanel enabled={enabled} project={selected} port={port} />
```

```tsx
// GraphPanel.tsx 加载 effect：重载前释放旧渲染与旧画布
useEffect(() => {
  if (!active) return
  const host = hostRef.current
  rendererRef.current?.dispose()
  rendererRef.current = null
  while (host?.firstChild) host.removeChild(host.firstChild)
  void load()
}, [active, load])
```

- [ ] **步骤 4：运行确认通过**

```sh
pnpm --filter web-frontend exec tsc --noEmit
```

预期：exit 0；浏览器冒烟下拉可切换、切换后节点数刷新。

- [ ] **步骤 5：提交**

```sh
./mgr sync "feat(web): 图谱页工程下拉与切换重装配 [sherlock]" --body "EP-CB8: 真实射线拾取 + 工程选择"
```

## 任务 4：验证证据与流程收尾

**文件**：
- 修改：`docs/process/verifications/plugin-codebase-cb6.md`（§4 补 EP-CB8 证据）
- 新建：`docs/process/reviews/2026-10-22-plugin-codebase-cb8-interaction.md`
- 新建：`docs/process/verifications/cb8-interaction.md`

**接口**：
- 消费：任务 1-3 的命令输出（exit code / 摘要）。

- [ ] **步骤 1：运行全部门禁（测试通过）并记录输出**

```sh
npx vitest run packages/plugins/graph-ui
npx tsc --build packages/plugins/graph-ui/tsconfig.json
npx oxlint packages/plugins/graph-ui
pnpm --filter web-frontend exec tsc --noEmit
node packages/plugins/dev/bin/ff_doctor.mjs all
```

- [ ] **步骤 2：登记验证证据**

```sh
node packages/plugins/dev/bin/ff_dev.mjs evidence cb8-interaction --command "npx vitest run packages/plugins/graph-ui" --exit 0 --summary "graph-ui 27 tests passed"
node packages/plugins/dev/bin/ff_dev.mjs gate cb8-interaction verify --evidence docs/process/verifications/cb8-interaction.md
```

- [ ] **步骤 3：提交文档**

```sh
./mgr commit "docs(process): EP-CB8 评审与验证证据 [sherlock]"
```
