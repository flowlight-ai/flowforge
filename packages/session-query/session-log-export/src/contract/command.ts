/**
 * 命令处理结果的本地契型。
 *
 * 移植自 dsh `@deepseek-ai/dsh-commands` 的 `CommandResult`；本包不依赖任何
 * dsh 运行时代码，只在包内重建受支持的最小判别联合，供 `HostContextPort`
 * 的命令处理器与契约测试使用。
 */

/** 一条命令的执行结果：成功携带面向用户的话术，失败携带错误话术。 */
export type CommandResult =
  | { readonly kind: 'success'; readonly text: string }
  | { readonly kind: 'error'; readonly text: string }