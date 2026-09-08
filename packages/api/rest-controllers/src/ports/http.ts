/**
 * HTTP processor seam — framework-agnostic.
 *
 * Controllers register route handlers against abstract request/response shapes.
 * Contract tests invoke `handle()` directly; the host binds `routes()` to a real
 * HTTP framework in EP2 (mapping HttpResponse → reply.status/header/send).
 */

export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}

export interface HttpResponse {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

export type RouteHandler = (req: HttpRequest) => HttpResponse | Promise<HttpResponse>;

/** Colon-prefixed path segments are captured into `params` (e.g. `:sessionId`). */
export type RoutePattern = string;

export interface RouteEntry {
  method: string;
  pattern: RoutePattern;
  handler: RouteHandler;
}

/**
 * Pure in-memory router: matches method + pattern, captures params, decodes a
 * query string from the URL. No framework coupling.
 */
export class RouteRegistrar {
  private readonly entries: RouteEntry[] = [];

  get(pattern: RoutePattern, handler: RouteHandler): void {
    this.entries.push({ method: 'GET', pattern, handler });
  }
  post(pattern: RoutePattern, handler: RouteHandler): void {
    this.entries.push({ method: 'POST', pattern, handler });
  }
  put(pattern: RoutePattern, handler: RouteHandler): void {
    this.entries.push({ method: 'PUT', pattern, handler });
  }
  patch(pattern: RoutePattern, handler: RouteHandler): void {
    this.entries.push({ method: 'PATCH', pattern, handler });
  }
  delete(pattern: RoutePattern, handler: RouteHandler): void {
    this.entries.push({ method: 'DELETE', pattern, handler });
  }
  /** Register a concrete entry (used by composite controllers). */
  register(entry: RouteEntry): void {
    this.entries.push(entry);
  }

  routes(): RouteEntry[] {
    return [...this.entries];
  }

  private decodeQuery(url: string, method: string): { pathname: string; query: Record<string, string> } {
    const qIndex = url.indexOf('?');
    const pathname = (qIndex === -1 ? url : url.slice(0, qIndex)) || '/';
    const query: Record<string, string> = {};
    if (qIndex !== -1) {
      const qs = url.slice(qIndex + 1);
      if (qs) {
        for (const pair of qs.split('&')) {
          if (!pair) continue;
          const eq = pair.indexOf('=');
          const key = eq === -1 ? pair : pair.slice(0, eq);
          const value = eq === -1 ? '' : pair.slice(eq + 1);
          try {
            query[decodeURIComponent(key)] = decodeURIComponent(value);
          } catch {
            query[key] = value;
          }
        }
      }
    }
    void method;
    return { pathname, query };
  }

  match(req: HttpRequest): { handler: RouteHandler; params: Record<string, string>; query: Record<string, string> } | null {
    const { pathname, query } = this.decodeQuery(req.url, req.method);
    for (const entry of this.entries) {
      if (entry.method !== req.method) continue;
      const params = matchPattern(entry.pattern, pathname);
      if (!params) continue;
      return {
        handler: entry.handler,
        params,
        query: { ...query, ...(req.query ?? {}) },
      };
    }
    return null;
  }

  /** Resolve a request synchronously-throwing to a 404 unless matched. */
  private static notFound(): HttpResponse {
    return { status: 404, body: { error: 'Not found' } };
  }

  async handle(req: HttpRequest): Promise<HttpResponse> {
    const matched = this.match(req);
    if (!matched) return RouteRegistrar.notFound();
    const augmented: HttpRequest = {
      ...req,
      params: matched.params,
      query: matched.query,
    };
    return matched.handler(augmented);
  }
}

/** Match a `/api/sessions/:sessionId` style pattern; returns captured params or null. */
export function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  const parts = pattern.split('/').filter(Boolean);
  const path = pathname.split('/').filter(Boolean);
  if (parts.length !== path.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i] ?? '';
    const seg = path[i] ?? '';
    if (part.startsWith(':')) {
      params[part.slice(1)] = decodeURIComponent(seg);
    } else if (part !== seg) {
      return null;
    }
  }
  return params;
}

/**
 * Base class every controller extends. Exposes `routes()` for host binding and
 * `handle()` for contract tests.
 */
export class RestControllerBase {
  protected readonly registrar = new RouteRegistrar();

  get(pattern: RoutePattern, handler: RouteHandler): void {
    this.registrar.get(pattern, handler);
  }
  post(pattern: RoutePattern, handler: RouteHandler): void {
    this.registrar.post(pattern, handler);
  }
  put(pattern: RoutePattern, handler: RouteHandler): void {
    this.registrar.put(pattern, handler);
  }
  patch(pattern: RoutePattern, handler: RouteHandler): void {
    this.registrar.patch(pattern, handler);
  }
  delete(pattern: RoutePattern, handler: RouteHandler): void {
    this.registrar.delete(pattern, handler);
  }

  routes(): RouteEntry[] {
    return this.registrar.routes();
  }

  handle(req: HttpRequest): Promise<HttpResponse> {
    return this.registrar.handle(req);
  }
}