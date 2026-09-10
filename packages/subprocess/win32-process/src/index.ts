/** Node-native Win32-first process lifecycle primitives for the FlowForge host. */

export { Win32Error } from './errors.ts'
export { buildCommandLine, quoteArg } from './quote.ts'
export {
  isWindows,
  spawnProcess,
  terminateProcess,
  treeKill,
  waitForProcessExit,
} from './process.ts'
export type {
  SpawnProcessOptions,
  TreeKillResult,
} from './process.ts'