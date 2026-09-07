#!/usr/bin/env node
/**
 * ff_dev — FlowForge 软件工程化流程 CLI（@flowforge/plugin-dev）。
 *
 * 直跑 TS 源码（tsx/esm loader，无构建依赖）：任何 AI 工具或脚本在仓库内
 * 即可执行七阶段流程生命周期。退出码契约：0=成功 / 1=门禁拒绝 / 2=用法错误。
 */

import { register } from 'tsx/esm/api'

process.env.FF_DEV_CLI_ENTRY = '1'
register()

await import('../src/cli/main.ts')
