/**
 * BaseModeExecutor — mode execution pipeline and registry.
 *
 * Maps flowforge Python legacy core/base_mode_executor.py (F25):
 * run = prepare → onEnter → executeCore → onExit → postprocess.
 * TaskContext is kept generic so host packages can plug in their own
 * context type without a hard dependency.
 */

export type ModeContext = Record<string, unknown>
export type ModeResult = Record<string, unknown>

export abstract class BaseModeExecutor<
  Ctx extends ModeContext = ModeContext,
  Result extends ModeResult = ModeResult,
> {
  abstract readonly modeName: string
  readonly capabilities: string[] = []

  protected async prepare(ctx: Ctx): Promise<Ctx> {
    return ctx
  }

  protected abstract executeCore(ctx: Ctx): Promise<Result>

  protected async onEnter(_ctx: Ctx): Promise<void> {
    /* hook */
  }

  protected async onExit(_ctx: Ctx, result: Result): Promise<Result> {
    return result
  }

  protected async postprocess(_ctx: Ctx, result: Result): Promise<Result> {
    return result
  }

  /** Fixed pipeline: prepare → onEnter → executeCore → onExit → postprocess. */
  async run(ctx: Ctx): Promise<Result> {
    const prepared = await this.prepare(ctx)
    await this.onEnter(prepared)
    let result = await this.executeCore(prepared)
    result = await this.onExit(prepared, result)
    return this.postprocess(prepared, result)
  }
}

export class ModeRegistry {
  private readonly executors = new Map<string, BaseModeExecutor>()

  /** Register an executor by its modeName. Re-registering overwrites. */
  register(executor: BaseModeExecutor): void {
    this.executors.set(executor.modeName, executor)
  }

  get(modeName: string): BaseModeExecutor | undefined {
    return this.executors.get(modeName)
  }

  has(modeName: string): boolean {
    return this.executors.has(modeName)
  }

  unregister(modeName: string): boolean {
    return this.executors.delete(modeName)
  }

  listModes(): string[] {
    return [...this.executors.keys()]
  }
}
