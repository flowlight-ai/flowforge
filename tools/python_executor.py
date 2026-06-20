import sys
import os
import multiprocessing
import tempfile
import io
import contextlib
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput


class PythonExecutorTool(BaseTool):
    name = "python_executor"
    description = "在隔离沙箱中执行Python代码"
    parameters_schema = {
        "type": "object",
        "required": ["code"],
        "properties": {
            "code": {"type": "string", "description": "要执行的Python代码"},
            "timeout": {"type": "integer", "default": 10, "description": "执行超时秒数"},
            "max_memory_mb": {"type": "integer", "default": 64, "description": "最大内存限制（MB）"},
        }
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        code = input.params["code"]
        timeout = input.params.get("timeout", 10)
        max_memory = input.params.get("max_memory_mb", 64)

        queue = multiprocessing.Queue()
        process = multiprocessing.Process(
            target=self._run_in_subprocess,
            args=(code, queue, max_memory)
        )
        process.start()
        process.join(timeout)
        if process.is_alive():
            process.terminate()
            process.join()
            return ToolOutput(result={"stdout": "", "stderr": "Code execution timed out"}, error="timeout")

        if not queue.empty():
            result = queue.get()
            return ToolOutput(result=result)
        return ToolOutput(result={"stdout": "", "stderr": "Execution failed"}, error="execution_error")

    def _run_in_subprocess(self, code, queue, max_memory):
        try:
            if sys.platform != "win32":
                import resource
                resource.setrlimit(resource.RLIMIT_AS,
                                   (max_memory * 1024 * 1024, max_memory * 1024 * 1024))
            else:
                try:
                    import psutil
                    process = psutil.Process()
                    process.memory_limit(max_memory * 1024 * 1024)
                except ImportError:
                    pass

            with tempfile.TemporaryDirectory() as tmpdir:
                os.chdir(tmpdir)
                safe_builtins = dict(__builtins__.__dict__)
                for dangerous in ['__import__', 'open', 'eval', 'exec', 'compile', 'input']:
                    safe_builtins.pop(dangerous, None)
                restricted_globals = {
                    '__builtins__': safe_builtins,
                    '__name__': '__main__',
                }
                output = io.StringIO()
                with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                    exec(compile(code, '<sandbox>', 'exec'), restricted_globals)
                queue.put({"stdout": output.getvalue(), "stderr": ""})
        except Exception as e:
            queue.put({"stdout": "", "stderr": str(e)})
