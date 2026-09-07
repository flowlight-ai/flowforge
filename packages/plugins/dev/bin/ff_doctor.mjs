#!/usr/bin/env node
/**
 * ff_doctor — FlowForge 流程遵从度检查 CLI（@flowforge/plugin-dev）。
 *
 * 直跑 TS 源码（tsx/esm loader）：plan/state/docs/all 四模式，供 CI
 * （ts-ci.yml L4 硬拦截）与本地（mgr L3 前置校验）调用。
 * 退出码契约：0=合规 / 1=违规 / 2=用法错误。
 */

import { register } from 'tsx/esm/api'

process.env.FF_DOCTOR_CLI_ENTRY = '1'
register()

await import('../src/cli/doctor.ts')
