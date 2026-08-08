import os

import httpx

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("wechat_publisher")


class WeChatPublisherTool(BaseTool):
    name = "publish_wechat"
    description = "微信公众号文章发布工具"
    parameters_schema = {
        "type": "object",
        "required": ["title", "content"],
        "properties": {
            "title": {"type": "string"},
            "content": {"type": "string"},
            "thumb_media_id": {"type": "string"},
            "digest": {"type": "string"},
        },
    }

    async def _get_access_token(self) -> str:
        app_id = os.getenv("WECHAT_APP_ID", "")
        app_secret = os.getenv("WECHAT_APP_SECRET", "")
        if not app_id or not app_secret:
            return ""
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid={app_id}&secret={app_secret}"
            )
            data = resp.json()
            return data.get("access_token", "")

    async def execute(self, input: ToolInput) -> ToolOutput:
        title = input.params["title"]
        content = input.params["content"]
        thumb_media_id = input.params.get("thumb_media_id", "")
        digest = input.params.get("digest", content[:54])
        access_token = await self._get_access_token()
        if not access_token:
            return ToolOutput(
                result={
                    "url": "",
                    "status": "skipped",
                    "reason": "WeChat credentials not configured",
                }
            )
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                draft_resp = await client.post(
                    f"https://api.weixin.qq.com/cgi-bin/draft/add?access_token={access_token}",
                    json={
                        "articles": [
                            {
                                "title": title,
                                "content": content,
                                "thumb_media_id": thumb_media_id,
                                "digest": digest,
                            }
                        ]
                    },
                )
                draft_data = draft_resp.json()
                media_id = draft_data.get("media_id", "")
                if not media_id:
                    return ToolOutput(
                        result={
                            "url": "",
                            "status": "failed",
                            "error": draft_data.get("errmsg", "Unknown error"),
                        }
                    )
                return ToolOutput(
                    result={
                        "url": f"https://mp.weixin.qq.com/draft/{media_id}",
                        "media_id": media_id,
                        "status": "draft_saved",
                    }
                )
        except Exception as e:
            logger.error(f"WeChat publish failed: {e}")
            return ToolOutput(result={"url": "", "status": "failed", "error": str(e)})
