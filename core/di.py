"""DI 容器 — 依赖注入、生命周期管理、自动依赖解析

支持三种生命周期：
- SINGLETON: 全局唯一实例（默认）
- TRANSIENT: 每次解析创建新实例
- SCOPED: 作用域内唯一实例

自动依赖解析：通过构造函数签名自动注入依赖。
依赖图验证：启动时检测循环依赖。
"""

from __future__ import annotations

import inspect
import logging
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Set, Tuple, Type

logger = logging.getLogger(__name__)


class ServiceLifetime(str, Enum):
    """服务生命周期"""
    SINGLETON = "singleton"
    TRANSIENT = "transient"
    SCOPED = "scoped"


class _Registration:
    """内部注册信息"""

    __slots__ = ("factory", "lifetime", "dependencies", "registered_type")

    def __init__(
        self,
        factory: Callable,
        lifetime: ServiceLifetime,
        dependencies: Optional[List[str]] = None,
        registered_type: Optional[Type] = None,
    ):
        self.factory = factory
        self.lifetime = lifetime
        self.dependencies = dependencies
        self.registered_type = registered_type


class Scope:
    """作用域 — 管理 scoped 实例的生命周期

    用法:
        scope = container.create_scope()
        svc = scope.resolve(SomeService)
        scope.dispose()  # 清理 scoped 实例
    """

    def __init__(self, container: DIContainer):
        self._container = container
        self._scoped_instances: Dict[str, Any] = {}
        self._disposed = False

    def resolve(self, name_or_type: Any) -> Any:
        """在作用域内解析服务，scoped 服务在作用域内单例"""
        if self._disposed:
            raise RuntimeError("Scope has been disposed")
        return self._container._resolve_internal(name_or_type, scope=self)

    def get(self, name_or_type: Any) -> Any:
        """安全获取，未注册返回 None"""
        try:
            return self.resolve(name_or_type)
        except (KeyError, TypeError):
            return None

    def dispose(self) -> None:
        """清理作用域内的 scoped 实例"""
        self._scoped_instances.clear()
        self._disposed = True

    def __enter__(self) -> Scope:
        return self

    def __exit__(self, *args: Any) -> None:
        self.dispose()


class DIContainer:
    """依赖注入容器

    支持：
    - 字符串名称注册/解析（向后兼容）
    - 类型注册/自动依赖解析
    - 三种生命周期：SINGLETON / TRANSIENT / SCOPED
    - 依赖图验证（循环检测）
    - 作用域管理
    """

    def __init__(self):
        # 名称注册表（向后兼容）
        self._registry: Dict[str, _Registration] = {}
        # 类型注册表（自动依赖解析）
        self._type_registry: Dict[Type, _Registration] = {}
        # 单例缓存（名称键）
        self._instances: Dict[str, Any] = {}
        # 单例缓存（类型键）
        self._type_instances: Dict[Type, Any] = {}
        # Agent 名称集合
        self._agent_keys: set = set()

    # ─── 向后兼容的名称注册 API ───

    def register_singleton(self, name: str, factory: Callable) -> None:
        """注册单例服务（字符串名称，向后兼容）"""
        self._registry[name] = _Registration(
            factory=factory,
            lifetime=ServiceLifetime.SINGLETON,
        )

    def register_agent(self, name: str, factory: Callable) -> None:
        """注册 Agent 工厂（字符串名称，向后兼容）"""
        self._registry[name] = _Registration(
            factory=factory,
            lifetime=ServiceLifetime.SINGLETON,
        )
        self._agent_keys.add(name)

    def register_instance(self, name: str, instance: Any) -> None:
        """注册已创建的实例（向后兼容）"""
        self._instances[name] = instance
        # 同时写入注册表，标记为单例
        self._registry[name] = _Registration(
            factory=lambda: instance,
            lifetime=ServiceLifetime.SINGLETON,
        )

    # ─── 增强的注册 API ───

    def register(
        self,
        factory: Callable,
        lifetime: ServiceLifetime = ServiceLifetime.SINGLETON,
        dependencies: Optional[List[str]] = None,
        name: Optional[str] = None,
    ) -> None:
        """通用注册方法

        Args:
            factory: 工厂函数或类本身
            lifetime: 生命周期
            dependencies: 显式依赖名称列表（可选，不指定则自动解析）
            name: 注册名称（可选，不指定则从 factory 推断）
        """
        # 推断注册键
        if name is not None:
            reg_name = name
            reg_type = factory if inspect.isclass(factory) else None
        elif inspect.isclass(factory):
            reg_type = factory
            reg_name = factory.__name__
        else:
            reg_type = None
            reg_name = getattr(factory, "__name__", str(id(factory)))

        reg = _Registration(
            factory=factory,
            lifetime=lifetime,
            dependencies=dependencies,
            registered_type=reg_type,
        )

        self._registry[reg_name] = reg
        if reg_type is not None:
            self._type_registry[reg_type] = reg

    def register_scoped(self, cls: Type, factory: Optional[Callable] = None) -> None:
        """注册 scoped 服务

        Args:
            cls: 服务类型（同时作为注册键）
            factory: 工厂函数，不指定则使用 cls 本身
        """
        factory = factory or cls
        reg = _Registration(
            factory=factory,
            lifetime=ServiceLifetime.SCOPED,
            registered_type=cls,
        )
        self._registry[cls.__name__] = reg
        self._type_registry[cls] = reg

    def register_transient(self, cls: Type, factory: Optional[Callable] = None) -> None:
        """注册瞬态服务

        Args:
            cls: 服务类型（同时作为注册键）
            factory: 工厂函数，不指定则使用 cls 本身
        """
        factory = factory or cls
        reg = _Registration(
            factory=factory,
            lifetime=ServiceLifetime.TRANSIENT,
            registered_type=cls,
        )
        self._registry[cls.__name__] = reg
        self._type_registry[cls] = reg

    # ─── 解析 API ───

    def resolve(self, name_or_type: Any) -> Any:
        """解析服务

        支持字符串名称（向后兼容）和类型（自动依赖解析）
        """
        return self._resolve_internal(name_or_type, scope=None)

    def get(self, name_or_type: Any) -> Any:
        """安全获取，未注册返回 None"""
        try:
            return self.resolve(name_or_type)
        except (KeyError, TypeError):
            return None

    def _resolve_internal(self, name_or_type: Any, scope: Optional[Scope] = None) -> Any:
        """内部解析实现

        Args:
            name_or_type: 字符串名称或类型
            scope: 当前作用域（scoped 服务需要）
        """
        # 1. 字符串名称解析（向后兼容）
        if isinstance(name_or_type, str):
            return self._resolve_by_name(name_or_type, scope)

        # 2. 类型解析（自动依赖解析）
        if isinstance(name_or_type, type):
            return self._resolve_by_type(name_or_type, scope)

        raise TypeError(f"Invalid resolve key: {name_or_type!r}, expected str or type")

    def _resolve_by_name(self, name: str, scope: Optional[Scope] = None) -> Any:
        """按名称解析"""
        # 已有实例直接返回（单例）
        if name in self._instances:
            return self._instances[name]

        if name not in self._registry:
            raise KeyError(f"Dependency '{name}' not registered")

        reg = self._registry[name]

        if reg.lifetime == ServiceLifetime.SINGLETON:
            instance = self._invoke_factory(reg, scope)
            self._instances[name] = instance
            return instance
        elif reg.lifetime == ServiceLifetime.TRANSIENT:
            return self._invoke_factory(reg, scope)
        elif reg.lifetime == ServiceLifetime.SCOPED:
            if scope is None:
                raise RuntimeError(
                    f"Cannot resolve scoped service '{name}' without a scope. "
                    "Use container.create_scope() first."
                )
            if name in scope._scoped_instances:
                return scope._scoped_instances[name]
            instance = self._invoke_factory(reg, scope)
            scope._scoped_instances[name] = instance
            return instance

        raise ValueError(f"Unknown lifetime: {reg.lifetime}")

    def _resolve_by_type(self, cls: Type, scope: Optional[Scope] = None) -> Any:
        """按类型解析（自动依赖解析）"""
        # 已有实例直接返回
        if cls in self._type_instances:
            return self._type_instances[cls]

        if cls not in self._type_registry:
            raise KeyError(f"Type {cls.__name__} not registered in container")

        reg = self._type_registry[cls]

        if reg.lifetime == ServiceLifetime.SINGLETON:
            instance = self._invoke_factory(reg, scope)
            self._type_instances[cls] = instance
            return instance
        elif reg.lifetime == ServiceLifetime.TRANSIENT:
            return self._invoke_factory(reg, scope)
        elif reg.lifetime == ServiceLifetime.SCOPED:
            if scope is None:
                raise RuntimeError(
                    f"Cannot resolve scoped service {cls.__name__} without a scope. "
                    "Use container.create_scope() first."
                )
            if cls in scope._scoped_instances:
                return scope._scoped_instances[cls]
            instance = self._invoke_factory(reg, scope)
            scope._scoped_instances[cls] = instance
            return instance

        raise ValueError(f"Unknown lifetime: {reg.lifetime}")

    def _invoke_factory(self, reg: _Registration, scope: Optional[Scope] = None) -> Any:
        """调用工厂函数，支持自动依赖注入"""
        # 如果有显式依赖列表，按名称解析
        if reg.dependencies is not None:
            kwargs = {}
            for dep_name in reg.dependencies:
                kwargs[dep_name] = self._resolve_internal(dep_name, scope)
            return reg.factory(**kwargs)

        # 自动依赖解析：检查构造函数参数
        factory = reg.factory
        if not inspect.isclass(factory):
            # 工厂函数，直接调用
            return factory()

        params = self._get_constructor_params(factory)
        if not params:
            return factory()

        kwargs = {}
        for param_name, param_type in params:
            try:
                kwargs[param_name] = self._resolve_param(param_name, param_type, scope)
            except (KeyError, TypeError):
                # 无法解析的参数跳过，让默认值生效
                pass

        return factory(**kwargs)

    # ─── 自动依赖解析 ───

    def _get_constructor_params(self, cls: Type) -> List[Tuple[str, Optional[Type]]]:
        """获取构造函数参数列表

        Returns:
            [(param_name, param_type), ...] 不含 self 和有默认值的参数
        """
        try:
            sig = inspect.signature(cls.__init__)
        except (ValueError, TypeError):
            return []

        params = []
        for name, param in sig.parameters.items():
            if name == "self":
                continue
            # 跳过有默认值的参数（可选依赖）
            if param.default is not inspect.Parameter.empty:
                continue
            # 跳过 *args / **kwargs
            if param.kind in (
                inspect.Parameter.VAR_POSITIONAL,
                inspect.Parameter.VAR_KEYWORD,
            ):
                continue

            param_type = param.annotation if param.annotation is not inspect.Parameter.empty else None
            params.append((name, param_type))

        return params

    def _resolve_param(
        self, param_name: str, param_type: Optional[Type], scope: Optional[Scope] = None
    ) -> Any:
        """解析单个参数

        优先按类型解析，回退到按名称解析
        """
        # 优先按类型解析
        if param_type is not None and isinstance(param_type, type) and param_type in self._type_registry:
            return self._resolve_internal(param_type, scope)

        # 回退到按名称解析
        if param_name in self._registry:
            return self._resolve_internal(param_name, scope)

        raise KeyError(f"Cannot resolve parameter '{param_name}' of type {param_type}")

    # ─── 依赖图验证 ───

    def validate_dependencies(self) -> List[str]:
        """验证依赖图无循环

        Returns:
            错误列表，空列表表示无问题
        """
        graph = self._build_dependency_graph()
        return self._detect_cycle(graph)

    def _build_dependency_graph(self) -> Dict[str, Set[str]]:
        """构建依赖图

        Returns:
            {name: {dep1, dep2, ...}} 邻接表
        """
        graph: Dict[str, Set[str]] = {}

        for name, reg in self._registry.items():
            deps = set()
            if reg.dependencies is not None:
                deps.update(reg.dependencies)
            elif reg.registered_type is not None:
                # 自动解析构造函数参数
                params = self._get_constructor_params(reg.registered_type)
                for param_name, param_type in params:
                    if param_type is not None and isinstance(param_type, type) and param_type in self._type_registry:
                        deps.add(param_type.__name__)
                    elif param_name in self._registry:
                        deps.add(param_name)
            graph[name] = deps

        return graph

    def _detect_cycle(self, graph: Dict[str, Set[str]]) -> List[str]:
        """检测循环依赖（DFS 三色标记法）

        Returns:
            循环依赖描述列表
        """
        WHITE, GRAY, BLACK = 0, 1, 2
        color: Dict[str, int] = {node: WHITE for node in graph}
        errors: List[str] = []
        path: List[str] = []

        def dfs(node: str) -> None:
            color[node] = GRAY
            path.append(node)
            for dep in graph.get(node, set()):
                if dep not in color:
                    # 依赖不在图中，跳过
                    continue
                if color[dep] == GRAY:
                    # 发现环
                    cycle_start = path.index(dep)
                    cycle = path[cycle_start:] + [dep]
                    errors.append(f"Circular dependency: {' -> '.join(cycle)}")
                elif color[dep] == WHITE:
                    dfs(dep)
            path.pop()
            color[node] = BLACK

        for node in graph:
            if color[node] == WHITE:
                dfs(node)

        return errors

    # ─── Scoped 生命周期 ───

    def create_scope(self) -> Scope:
        """创建作用域

        用法:
            with container.create_scope() as scope:
                svc = scope.resolve(SomeService)
        """
        return Scope(self)

    # ─── 向后兼容 API ───

    def resolve_all_agents(self) -> Dict[str, Any]:
        """解析所有已注册的 Agent"""
        return {k: self.resolve(k) for k in self._agent_keys}
