# AGENTS.md — Cordis 内核（移植副本）

本目录是 [Cordis](https://github.com/cordiverse/cordis) 内核的改名移植副本，包名为 `@flowforge/cordis`。它之上注册着 `packages/*` 的全部插件，是 FlowForge 的插件骨架。全局规则见根 `AGENTS.md`，vendor 级规则见 `vendor/AGENTS.md`。

**规则：** 不要随意修改 `vendor/cordis/src/`。任何对上游的偏离必须记录到 `vendor/README.md` 的「Local modifications」章节；自定义逻辑优先复制到 `packages/` 再改。

**规则：** Cordis 的核心心智模型——`new Context()` 创建根依赖容器；`ctx.plugin()` 启动插件并返回 `Fiber`；`inject` 声明该插件运行前必须存在的服务；通过 `ctx.effect()` / `ctx.on()` 注册的副作用、事件监听器与服务，会在所属 `Fiber` 卸载时自动清理（LIFO / RAII）。

**规则：** 写插件时通过 `declare module 'cordis'` 扩展 `Context` 接口与 `Events` 接口；新增能力用 `Service` 子类 + `ctx.provide(Service)`，不要用全局单例或隐式依赖。

**规则：** 依赖解析是代理（proxy）驱动的：`ctx.foo` 读取已注册的服务；可选服务用 `ctx.get('foo')`，不要在插件体里硬编码服务查找顺序。

入门走读：专家版 [`docs/refactor/vendor-walkthrough.md`](../../docs/refactor/vendor-walkthrough.md)，小白版 [`docs/refactor/vendor-walkthrough-beginner.md`](../../docs/refactor/vendor-walkthrough-beginner.md)，可运行 demo [`docs/refactor/vendor-demo.ts`](../../docs/refactor/vendor-demo.ts)。
