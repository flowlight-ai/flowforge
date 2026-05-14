import os

import httpx
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("sendgrid_mail")


class SendGridMailTool(BaseTool):
    name = "sendgrid_mail"
    description = "SendGrid 邮件发送工具"
    parameters_schema = {
        "type": "object",
        "required": ["to", "subject", "content"],
        "properties": {
            "to": {"type": "string"},
            "subject": {"type": "string"},
            "content": {"type": "string"},
            "content_type": {"type": "string", "default": "text/plain"},
        },
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        api_key = os.getenv("SENDGRID_API_KEY", "")
        if not api_key:
            return ToolOutput(
                result={"status": "skipped", "reason": "SENDGRID_API_KEY not set"}
            )
        to_email = input.params["to"]
        subject = input.params["subject"]
        content = input.params["content"]
        content_type = input.params.get("content_type", "text/plain")
        from_email = os.getenv("SENDGRID_FROM_EMAIL", "noreply@flowforge.dev")
        payload = {
            "personalizations": [{"to": [{"email": to_email}]}],
            "from": {"email": from_email},
            "subject": subject,
            "content": [{"type": content_type, "value": content}],
        }
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    "https://api.sendgrid.com/v3/mail/send",
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                )
                if resp.status_code in (200, 202):
                    return ToolOutput(result={"status": "sent", "to": to_email})
                return ToolOutput(
                    result={"status": "failed", "error": f"HTTP {resp.status_code}"}
                )
        except Exception as e:
            logger.error(f"SendGrid mail failed: {e}")
            return ToolOutput(result={"status": "failed", "error": str(e)})
