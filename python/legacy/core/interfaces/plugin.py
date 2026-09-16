from abc import ABC, abstractmethod


class MessageChannelPlugin(ABC):
    name: str = "base"
    description: str = ""

    @abstractmethod
    async def on_message(self, raw_message: dict) -> dict:
        ...

    @abstractmethod
    async def send_message(self, recipient: str, content: str) -> bool:
        ...

    @abstractmethod
    async def on_task_status_change(self, task_id: str, status: str, meta: dict) -> bool:
        return True

    @property
    @abstractmethod
    def supported_actions(self) -> list[str]:
        return ['pass', 'reject']

    @abstractmethod
    async def health_check(self) -> bool:
        ...
