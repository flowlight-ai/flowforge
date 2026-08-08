"""Channel Manager — manages message channel plugins.

Generic framework for registering and dispatching messages to channel plugins.
"""
from flowforge.core.interfaces.plugin import MessageChannelPlugin
from typing import Dict
from flowforge.core.tracing import get_logger

logger = get_logger("channel_manager")


class ChannelManager:
    def __init__(self):
        self._channels: Dict[str, MessageChannelPlugin] = {}

    def register(self, plugin: MessageChannelPlugin):
        self._channels[plugin.name] = plugin

    def get_channel(self, name: str) -> MessageChannelPlugin:
        return self._channels[name]

    def list_channels(self) -> list[str]:
        return list(self._channels.keys())

    async def broadcast_status(self, task_id: str, status: str, meta: dict):
        for name, channel in self._channels.items():
            try:
                await channel.on_task_status_change(task_id, status, meta)
            except Exception as e:
                logger.error(f"推送状态到渠道 {name} 失败: {e}")

    async def handle_incoming_message(self, channel_name: str, raw_message: dict):
        channel = self._channels.get(channel_name)
        if not channel:
            return None
        return await channel.on_message(raw_message)
