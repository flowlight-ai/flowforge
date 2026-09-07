#!/usr/bin/env node
/**
 * ff_codebase — FlowForge 代码智能 CLI（@flowforge/plugin-codebase）。
 *
 * 直跑 TS 源码（tsx/esm loader，无构建依赖）：索引监督进程模式——索引在
 * 独立 CLI 进程内执行，插件/工具侧只读消费 DB。退出码契约：0=成功 /
 * 1=违规（项目不存在）/ 2=用法错误。
 */

import { register } from 'tsx/esm/api'

process.env.FF_CODEBASE_CLI_ENTRY = '1'
register()

await import('../src/cli/main.ts')
