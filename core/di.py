from typing import Any, Callable, Dict


class DIContainer:
    def __init__(self):
        self._registry: Dict[str, Callable] = {}
        self._instances: Dict[str, Any] = {}
        self._agent_keys: set = set()

    def register_singleton(self, name: str, factory: Callable) -> None:
        self._registry[name] = factory

    def register_agent(self, name: str, factory: Callable) -> None:
        self._registry[name] = factory
        self._agent_keys.add(name)

    def register_instance(self, name: str, instance: Any) -> None:
        self._instances[name] = instance

    def resolve(self, name: str) -> Any:
        if name in self._instances:
            return self._instances[name]
        if name not in self._registry:
            raise KeyError(f"Dependency '{name}' not registered")
        factory = self._registry[name]
        instance = factory()
        self._instances[name] = instance
        return instance

    def get(self, name: str) -> Any:
        if name in self._instances:
            return self._instances[name]
        if name in self._registry:
            return self.resolve(name)
        return None

    def resolve_all_agents(self) -> Dict[str, Any]:
        return {k: self.resolve(k) for k in self._agent_keys}
