class FlowForgeError(Exception):
    status_code: int = 500
    detail: str = "Internal flowforge error"

    def __init__(self, detail: str = "", **kwargs):
        super().__init__(detail)
        if detail:
            self.detail = detail


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


class HarnessViolationError(FlowForgeError):
    status_code = 422
    detail = "Harness guardrail violation"


class StepTimeoutError(FlowForgeError):
    status_code = 408
    detail = "Workflow step timed out"


class PartnershipError(FlowForgeError):
    status_code = 422
    detail = "Invalid partnership candidate/path"


class ReliabilityError(FlowForgeError):
    status_code = 503
    detail = "Reliability subsystem invariant violated"


class LLMError(FlowForgeError):
    status_code = 500
    detail = "LLM provider error"


class ForgekinError(FlowForgeError):
    status_code = 500
    detail = "Forgekin subsystem error"
