class FlowForgeError(Exception):
    status_code: int = 500
    detail: str = "Internal flowforge error"


class ConfigurationError(FlowForgeError):
    status_code = 400
    detail = "Configuration error"


class ModeNotFoundError(FlowForgeError):
    status_code = 404
    detail = "Mode not found"


class WorkflowRecursionError(FlowForgeError):
    status_code = 400
    detail = "Workflow recursion depth exceeded"


class ConflictError(FlowForgeError):
    status_code = 409
    detail = "Resource conflict"


class ToolNotFoundError(FlowForgeError):
    status_code = 404
    detail = "Tool not found"


class AgentNotFoundError(FlowForgeError):
    status_code = 404
    detail = "Agent not found"


class SandboxError(FlowForgeError):
    status_code = 400
    detail = "Sandbox execution error"


class AllModelsUnavailableError(FlowForgeError):
    status_code = 503
    detail = "All model candidates failed"


class ToolExecutionError(FlowForgeError):
    status_code = 500
    detail = "Tool execution error"


class ConfigError(FlowForgeError):
    status_code = 400
    detail = "Config error"
