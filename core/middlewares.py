import time

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from flowforge.core.tracing import generate_trace_id, get_logger, get_trace_id, set_trace_id

logger = get_logger("flowforge.middlewares")


class TracingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        trace_id = request.headers.get("X-Trace-ID", generate_trace_id())
        set_trace_id(trace_id)
        start = time.time()
        response = await call_next(request)
        elapsed = time.time() - start
        response.headers["X-Trace-ID"] = trace_id
        response.headers["X-Response-Time"] = f"{elapsed:.3f}s"
        return response


class ExceptionHandlerMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        try:
            return await call_next(request)
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Unhandled exception: {e}", exc_info=True)
            return JSONResponse(
                status_code=500,
                content={"detail": "Internal server error", "trace_id": get_trace_id()}
            )
