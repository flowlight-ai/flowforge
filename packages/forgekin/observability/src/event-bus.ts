/**
 * @flowforge/forgekin-observability — T7.12 事件总线：EventBus + EventBusBridge。
 *
 * TS 重写自 `events/event_bus.py` + `core/event_bridge.py`：
 *   - EventBus：内存发布订阅（subscribe/unsubscribe/respond/emit/request +
 *     "*" 通配 + filter 过滤 + 请求响应模式 + async 回调不阻塞发射方）
 *   - EventBusBridge：跨项目事件桥（订阅指定事件类型并双向转发，payload 加
 *     `_source`/`_bridged` 标记）
 */

/** 事件记录（对齐 Python emit 构造的 {type, payload, task_id, timestamp}）。 */
export interface EventRecord {
  type: string;
  payload: Record<string, unknown>;
  task_id: string;
  timestamp: string;
}

/** 事件回调：同步或异步皆可。 */
export type EventHandler = (event: EventRecord) => unknown | Promise<unknown>;

/** 事件过滤谓词。 */
export type EventFilter = (event: EventRecord) => boolean;

interface Subscriber {
  callback: EventHandler;
  filter: EventFilter | null;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * 内存发布订阅事件总线。
 *
 * 增强特性（移植自 Python 原版）：
 * - 请求响应模式：request() 发送事件并等待单个响应者 respond() 返回值
 * - 事件过滤：subscribe(type, cb, filter) 仅当 filter(event) 为真时调用
 * - 域事件命名：domain.action（如 task.completed / tool.start / plugin.loaded）
 */
export class EventBus {
  private readonly subscribers = new Map<string, Subscriber[]>();
  private readonly pendingRequests = new Map<string, PendingRequest>();

  /**
   * 注册回调（event_type 为 "*" 时接收所有事件）。
   *
   * @param callback 接受单个 event 参数的调用（可为 async）。
   * @param filter 可选谓词，仅 filter(event) 为真时调用。
   */
  subscribe(
    event_type: string,
    callback: EventHandler,
    filter: EventFilter | null = null,
  ): void {
    const list = this.subscribers.get(event_type) ?? [];
    list.push({ callback, filter });
    this.subscribers.set(event_type, list);
  }

  /**
   * 移除回调（按引用匹配）。
   *
   * @returns 是否移除了至少一个。
   */
  unsubscribe(event_type: string, callback: EventHandler): boolean {
    const list = this.subscribers.get(event_type);
    if (list === undefined) return false;
    const before = list.length;
    const remaining = list.filter((s) => s.callback !== callback);
    this.subscribers.set(event_type, remaining);
    return remaining.length < before;
  }

  /**
   * 注册请求响应处理器（request-response 模式的响应方）。
   */
  respond(event_type: string, handler: EventHandler): void {
    this.subscribe(event_type, handler);
  }

  /**
   * 发射事件：构造事件记录并派发给特定类型 + "*" 订阅者。
   *
   * async 回调以 fire-and-forget 方式调度（不阻塞发射方，对齐
   * Python asyncio.ensure_future 语义）。
   */
  emit(task_id: string, event_type: string, payload: Record<string, unknown>): void {
    const event: EventRecord = {
      type: event_type,
      payload,
      task_id,
      timestamp: new Date().toISOString(),
    };
    this.dispatch(event_type, event);
    this.dispatch('*', event);
  }

  /**
   * 请求响应模式：发送请求并等待单个响应者返回值。
   *
   * @param event_type 事件类型。
   * @param payload 请求负载。
   * @param timeout 超时秒数（缺省 30）。
   * @param task_id 可选任务 id。
   * @returns 响应处理器的返回值。
   * @throws Error 超时无响应时。
   */
  async request(
    event_type: string,
    payload: Record<string, unknown>,
    timeout: number = 30,
    task_id: string = '',
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(event_type);
        reject(new Error(`EventBus request timeout: ${event_type}`));
      }, timeout * 1000);
      this.pendingRequests.set(event_type, { resolve, reject, timer });
      this.emit(task_id, event_type, payload);
    });
  }

  /** 当前订阅总数（测试/审计用）。 */
  get subscriber_count(): number {
    let total = 0;
    for (const list of this.subscribers.values()) total += list.length;
    return total;
  }

  private dispatch(event_type: string, event: EventRecord): void {
    const list = this.subscribers.get(event_type) ?? [];
    for (const { callback, filter } of list) {
      if (filter !== null && !filter(event)) continue;
      try {
        const result = callback(event);
        if (isPromiseLike(result)) {
          void result.then(
            (value) => this.resolvePending(event_type, value),
            (err: unknown) => {
              console.error(`Event callback error for ${event_type}:`, err);
            },
          );
        } else {
          this.resolvePending(event_type, result);
        }
      } catch (err) {
        console.error(`Event callback error for ${event_type}:`, err);
      }
    }
  }

  private resolvePending(event_type: string, value: unknown): void {
    const pending = this.pendingRequests.get(event_type);
    if (pending === undefined || value === undefined) return;
    this.pendingRequests.delete(event_type);
    clearTimeout(pending.timer);
    pending.resolve(value);
  }
}

/** 默认桥接事件类型（对齐 Python DEFAULT_BRIDGED_EVENTS）。 */
export const DEFAULT_BRIDGED_EVENTS: ReadonlySet<string> = new Set([
  'task.created',
  'task.completed',
  'task.failed',
  'task.cancelled',
  'model.health_changed',
  'model.failover',
  'workflow.stage_enter',
  'workflow.stage_done',
]);

/**
 * 跨项目事件桥 — 订阅指定事件类型并双向转发。
 *
 * 对齐 Python EventBusBridge：事件从一端总线转发到另一端时，
 * payload 附加 `_source`（flowforge / peer）与 `_bridged: true` 标记。
 */
export class EventBusBridge {
  private forwarding: boolean = false;
  private readonly bridgedTypes: Set<string>;

  constructor(
    private readonly ffBus: EventBus,
    private readonly peerBus: EventBus | null = null,
    bridgedTypes?: Iterable<string>,
  ) {
    this.bridgedTypes = new Set(bridgedTypes ?? DEFAULT_BRIDGED_EVENTS);
  }

  /** 开始桥接（幂等）。 */
  start(): void {
    if (this.forwarding) return;
    this.forwarding = true;
    for (const event_type of this.bridgedTypes) {
      this.ffBus.subscribe(event_type, this.makeFfToPeerHandler(event_type));
      if (this.peerBus !== null) {
        this.peerBus.subscribe(event_type, this.makePeerToFfHandler(event_type));
      }
    }
  }

  /**
   * 停止桥接（事件总线不支持批量退订，通过标志位阻止转发）。
   */
  stop(): void {
    this.forwarding = false;
  }

  /** 运行时新增桥接类型（幂等）。 */
  add_bridged_type(event_type: string): void {
    if (this.bridgedTypes.has(event_type)) return;
    this.bridgedTypes.add(event_type);
    this.ffBus.subscribe(event_type, this.makeFfToPeerHandler(event_type));
    if (this.peerBus !== null) {
      this.peerBus.subscribe(event_type, this.makePeerToFfHandler(event_type));
    }
  }

  /** 当前桥接的事件类型集合（拷贝）。 */
  get bridged_types(): Set<string> {
    return new Set(this.bridgedTypes);
  }

  /** 桥接是否处于激活状态。 */
  get is_running(): boolean {
    return this.forwarding;
  }

  private makeFfToPeerHandler(event_type: string): EventHandler {
    return (event: EventRecord): void => {
      if (!this.forwarding || this.peerBus === null) return;
      // 防回声：已标记 bridged 的事件不再回传，避免双向桥无限循环
      if (event.payload['_bridged'] === true) return;
      this.peerBus.emit(event.task_id, event_type, {
        ...event.payload,
        _source: 'flowforge',
        _bridged: true,
      });
    };
  }

  private makePeerToFfHandler(event_type: string): EventHandler {
    return (event: EventRecord): void => {
      if (!this.forwarding) return;
      // 防回声：已标记 bridged 的事件不再回传，避免双向桥无限循环
      if (event.payload['_bridged'] === true) return;
      this.ffBus.emit(event.task_id, event_type, {
        ...event.payload,
        _source: 'peer',
        _bridged: true,
      });
    };
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}
