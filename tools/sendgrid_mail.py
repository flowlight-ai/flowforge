import os
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("sendgrid_mail")


class SendGridMailTool(BaseTool):
    name = "sendgrid_mail"
    description = "SendGrid 邮件发送：通过 SendGrid API 发送邮件"
    parameters_schema = {
        "type": "object",
        "required": ["to", "subject", "content"],
        "properties": {
            "to": {"type": "string", "description": "收件人邮箱"},
            "subject": {"type": "string", "description": "邮件主题"},
            "content": {"type": "string", "description": "邮件内容"},
            "content_type": {"type": "string", "default": "text/plain", "description": "内容类型"},
        },
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        to = input.params["to"]
        subject = input.params["subject"]
        content = input.params["content"]
        content_type = input.params.get("content_type", "text/plain")

        api_key = os.getenv("SENDGRID_API_KEY", "")
        from_email = os.getenv("SENDGRID_FROM_EMAIL", "noreply@flowforge.dev")

        if not api_key:
            return ToolOutput(
                result={"success": False, "error": "SENDGRID_API_KEY 未配置"},
                error="SENDGRID_API_KEY 未配置",
            )

        try:
            import httpx

            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    "https://api.sendgrid.com/v3/mail/send",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "personalizations": [{"to": [{"email": to}]}],
                        "from": {"email": from_email},
                        "subject": subject,
                        "content": [{"type": content_type, "value": content}],
                    },
                )

            if resp.status_code in (200, 202):
                logger.info(f"Email sent to {to}: {subject}")
                return ToolOutput(result={"success": True, "to": to})
            else:
                error_msg = resp.text[:500]
                logger.error(f"SendGrid error: {resp.status_code} {error_msg}")
                return ToolOutput(result={"success": False, "error": error_msg})
        except Exception as e:
            logger.error(f"SendGrid mail failed: {e}")
            return ToolOutput(result={"success": False, "error": str(e)})
