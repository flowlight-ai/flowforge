"""Durable State Surfaces — Harness 第 1 层：感知现实。

对应 roleagent.md §3.2 Harness 七层中的"感知现实"层（F008）。
解决开放环境失败模式 1：感知失败（agent 不知道现实发生了什么）。

核心机制：
    把跨 session、跨 agent、跨时间持续存在的"现实状态"通过统一接口暴露。
    agent 不再依赖 KV cache（瞬时）或 model weights（厂商控制），
    而是通过 DurableStateSurface 读写"第三层状态"（roleagent.md §1.2）。

半衰期标记（roleagent.md §1.3）：
    - DurableState 数据模型 → Built-to-Persist（复利型数据资产）
    - DurableStateSurface 抽象接口 → Built-to-Persist（架构契约）
    - SqliteDurableState / GitDurableState → Built-to-Persist（基础设施）

设计依据：
    - F008-durable-state-surfaces.md
    - ADR 007 §1（Harness 工程路径）
    - roleagent.md §1.2（三层状态）+ §3.1（感知失败）+ §3.2（七层）

铁律遵守：
    - 铁律 3：抽象类定义依赖契约，不直接实例化；具体实现由 DI 容器注入
    - 铁律 5：路径通过配置注入，不硬编码
    - 编程红线 9：使用组合（Pydantic 字段）而非继承表达数据模型
    - 编程红线 11：无硬编码提示词

License: MIT
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import sqlite3
import subprocess
import time
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("harness_v7.durable_state")


# ──────────────────────────────────────────────────────────────────────────────
# 数据模型
# ──────────────────────────────────────────────────────────────────────────────


class DurableState(BaseModel):
    """Durable State 单条记录 —— Built-to-Persist。

    对应 roleagent.md §1.2 现实状态层（跨 session 持续）。
    每条记录代表一个 key 的版本化快照，包含 last_writer 用于审计追责。

    Attributes:
        state_id: 记录唯一 ID（uuid4 生成）。
        key: 状态键（业务语义标识，如 "task:123:status"）。
        value: 状态值（任意可 JSON 序列化的数据）。
        version: 乐观锁版本号（每次 write 自增）。
        last_writer: 最后写入者标识（agent_id / operator_id）。
        created_at: 创建时间 ISO 8601。
        updated_at: 最后更新时间 ISO 8601。
    """

    state_id: str = Field(
        default_factory=lambda: f"ds-{uuid.uuid4().hex[:12]}",
        description="记录唯一 ID",
    )
    key: str = Field(..., description="状态键")
    value: Any = Field(..., description="状态值（JSON 可序列化）")
    version: int = Field(default=1, ge=1, description="乐观锁版本号")
    last_writer: str = Field(..., description="最后写入者标识")
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="创建时间 ISO 8601",
    )
    updated_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="最后更新时间 ISO 8601",
    )


# ──────────────────────────────────────────────────────────────────────────────
# 抽象接口
# ──────────────────────────────────────────────────────────────────────────────


class DurableStateSurface(ABC):
    """Durable State Surface 抽象接口 —— Built-to-Persist。

    roleagent.md §3.2 第一层"感知现实"的统一读写接口。
    所有具体后端（SQLite / Git / 文件系统 / 数据库）必须实现此接口。

    关键不变量：
        1. read 不存在时返回 None（不抛异常）
        2. write 自动版本自增（乐观锁）
        3. delete 返回是否删除成功（不存在返回 False）
        4. 所有操作 async，适配 IO-bound 场景
    """

    @abstractmethod
    async def read(self, key: str) -> Optional[Any]:
        """读取指定 key 的当前值。

        Args:
            key: 状态键。

        Returns:
            状态值；不存在时返回 None。
        """
        raise NotImplementedError

    @abstractmethod
    async def write(self, key: str, value: Any, writer: str) -> DurableState:
        """写入状态（自动版本自增）。

        Args:
            key: 状态键。
            value: 状态值（JSON 可序列化）。
            writer: 写入者标识（agent_id / operator_id）。

        Returns:
            写入后的 DurableState 记录。
        """
        raise NotImplementedError

    @abstractmethod
    async def delete(self, key: str) -> bool:
        """删除指定 key。

        Args:
            key: 状态键。

        Returns:
            True 表示删除成功；False 表示 key 不存在。
        """
        raise NotImplementedError


# ──────────────────────────────────────────────────────────────────────────────
# SQLite 实现
# ──────────────────────────────────────────────────────────────────────────────


class SqliteDurableState(DurableStateSurface):
    """SQLite 后端 DurableState 实现 —— Built-to-Persist。

    使用 SQLite 作为持久状态后端，单文件部署、零运维成本。
    适合开发期 / 小规模生产环境。

    设计要点：
        - WAL 模式提升并发读性能
        - 乐观锁通过 version 字段实现（write 时 +1）
        - JSON 序列化存储任意结构化数据
        - 路径由 DI 容器注入（铁律 5）

    Attributes:
        db_path: SQLite 数据库绝对路径。
        table_name: 状态表名。
        wal_mode: 是否启用 WAL 模式。
    """

    def __init__(
        self,
        db_path: str | Path,
        table_name: str = "durable_state",
        wal_mode: bool = True,
    ) -> None:
        self.db_path = Path(db_path)
        self.table_name = table_name
        self.wal_mode = wal_mode
        # 确保父目录存在
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        # 简单连接锁，避免并发写入冲突
        self._lock = asyncio.Lock()
        # 初始化 schema
        self._init_schema()
        logger.info(
            "SqliteDurableState initialized",
            db_path=str(self.db_path),
            table_name=self.table_name,
            wal_mode=self.wal_mode,
        )

    def _get_conn(self) -> sqlite3.Connection:
        """获取 SQLite 连接（每次调用新建，避免线程问题）。"""
        conn = sqlite3.connect(str(self.db_path), timeout=30.0)
        conn.row_factory = sqlite3.Row
        if self.wal_mode:
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("PRAGMA synchronous=NORMAL;")
        return conn

    def _init_schema(self) -> None:
        """初始化表结构（幂等）。"""
        conn = self._get_conn()
        try:
            conn.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {self.table_name} (
                    key TEXT PRIMARY KEY,
                    state_id TEXT NOT NULL,
                    value_json TEXT NOT NULL,
                    version INTEGER NOT NULL DEFAULT 1,
                    last_writer TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                f"CREATE INDEX IF NOT EXISTS idx_{self.table_name}_writer "
                f"ON {self.table_name}(last_writer);"
            )
            conn.commit()
        finally:
            conn.close()

    @staticmethod
    def _row_to_state(row: sqlite3.Row) -> DurableState:
        """将 SQLite 行映射为 DurableState 模型。"""
        import json as _json

        return DurableState(
            state_id=row["state_id"],
            key=row["key"],
            value=_json.loads(row["value_json"]),
            version=row["version"],
            last_writer=row["last_writer"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    async def read(self, key: str) -> Optional[Any]:
        """读取指定 key 的当前值。"""
        # SQLite 操作放线程池避免阻塞事件循环
        def _read_sync() -> Optional[DurableState]:
            conn = self._get_conn()
            try:
                cur = conn.execute(
                    f"SELECT * FROM {self.table_name} WHERE key = ?;",
                    (key,),
                )
                row = cur.fetchone()
                return self._row_to_state(row) if row is not None else None
            finally:
                conn.close()

        async with self._lock:
            state = await asyncio.to_thread(_read_sync)
        if state is None:
            logger.debug("DurableState read miss", key=key)
            return None
        logger.debug(
            "DurableState read hit",
            key=key,
            version=state.version,
            last_writer=state.last_writer,
        )
        return state.value

    async def write(self, key: str, value: Any, writer: str) -> DurableState:
        """写入状态（upsert + 版本自增）。"""
        value_json = json.dumps(value, ensure_ascii=False, default=str)

        def _write_sync() -> DurableState:
            conn = self._get_conn()
            try:
                cur = conn.execute(
                    f"SELECT * FROM {self.table_name} WHERE key = ?;",
                    (key,),
                )
                existing = cur.fetchone()
                now = datetime.now(timezone.utc).isoformat()
                if existing is None:
                    state = DurableState(
                        key=key,
                        value=value,
                        version=1,
                        last_writer=writer,
                        created_at=now,
                        updated_at=now,
                    )
                    conn.execute(
                        f"""
                        INSERT INTO {self.table_name}
                        (key, state_id, value_json, version, last_writer,
                         created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?);
                        """,
                        (
                            state.key,
                            state.state_id,
                            value_json,
                            state.version,
                            state.last_writer,
                            state.created_at,
                            state.updated_at,
                        ),
                    )
                else:
                    old_state = self._row_to_state(existing)
                    state = DurableState(
                        state_id=old_state.state_id,
                        key=key,
                        value=value,
                        version=old_state.version + 1,
                        last_writer=writer,
                        created_at=old_state.created_at,
                        updated_at=now,
                    )
                    conn.execute(
                        f"""
                        UPDATE {self.table_name}
                        SET value_json = ?, version = ?, last_writer = ?,
                            updated_at = ?
                        WHERE key = ?;
                        """,
                        (
                            value_json,
                            state.version,
                            state.last_writer,
                            state.updated_at,
                            key,
                        ),
                    )
                conn.commit()
                return state
            finally:
                conn.close()

        async with self._lock:
            state = await asyncio.to_thread(_write_sync)
        logger.info(
            "DurableState written",
            key=key,
            version=state.version,
            writer=writer,
        )
        return state

    async def delete(self, key: str) -> bool:
        """删除指定 key。"""

        def _delete_sync() -> int:
            conn = self._get_conn()
            try:
                cur = conn.execute(
                    f"DELETE FROM {self.table_name} WHERE key = ?;",
                    (key,),
                )
                conn.commit()
                return cur.rowcount
            finally:
                conn.close()

        async with self._lock:
            rowcount = await asyncio.to_thread(_delete_sync)
        deleted = rowcount > 0
        if deleted:
            logger.info("DurableState deleted", key=key)
        else:
            logger.debug("DurableState delete miss", key=key)
        return deleted


# ──────────────────────────────────────────────────────────────────────────────
# Git 实现
# ──────────────────────────────────────────────────────────────────────────────


class GitDurableState(DurableStateSurface):
    """Git 后端 DurableState 实现 —— Built-to-Persist。

    使用 Git 仓库作为持久状态后端，天然支持版本审计 / 回滚 / diff。
    适合需要完整操作历史审计的场景。

    设计要点：
        - 每个 key 对应一个 JSON 文件
        - 每次 write 产生一个 git commit（便于审计追溯）
        - 路径与作者信息由 DI 容器注入（铁律 5）
        - subprocess 调用 git CLI，无 Python git 依赖

    Attributes:
        repo_path: Git 仓库根目录绝对路径。
        branch: 工作分支名。
        author_name: 提交者署名。
        author_email: 提交者邮箱。
    """

    def __init__(
        self,
        repo_path: str | Path,
        branch: str = "main",
        author_name: str = "flowforge-harness-v7",
        author_email: str = "harness-v7@flowforge.local",
    ) -> None:
        self.repo_path = Path(repo_path)
        self.branch = branch
        self.author_name = author_name
        self.author_email = author_email
        self._lock = asyncio.Lock()
        # 初始化 git 仓库（幂等）
        self._init_repo()

    def _init_repo(self) -> None:
        """初始化 Git 仓库（已存在则跳过）。"""
        self.repo_path.mkdir(parents=True, exist_ok=True)
        git_dir = self.repo_path / ".git"
        if not git_dir.exists():
            self._run_git(["init", "-b", self.branch])
            # 配置作者信息
            self._run_git(["config", "user.name", self.author_name])
            self._run_git(["config", "user.email", self.author_email])
            # 初始提交（空仓库也需要一个 commit 作为基线）
            readme = self.repo_path / "README.md"
            readme.write_text(
                f"# Durable State Repository\n\n"
                f"Auto-initialized by GitDurableState (harness_v7).\n",
                encoding="utf-8",
            )
            self._run_git(["add", "README.md"])
            self._run_git(
                [
                    "commit",
                    "-m",
                    "chore: initialize durable state repository",
                ]
            )
        logger.info(
            "GitDurableState initialized",
            repo_path=str(self.repo_path),
            branch=self.branch,
        )

    def _run_git(self, args: list[str]) -> str:
        """执行 git 命令，返回 stdout。

        Args:
            args: git 命令参数列表（不含 "git" 前缀）。

        Returns:
            stdout 输出（已 strip）。

        Raises:
            RuntimeError: git 命令返回非零退出码。
        """
        cmd = ["git"] + args
        try:
            result = subprocess.run(
                cmd,
                cwd=str(self.repo_path),
                capture_output=True,
                text=True,
                timeout=30.0,
                check=False,
            )
        except FileNotFoundError as exc:
            raise RuntimeError(
                "git executable not found; please install git CLI"
            ) from exc
        if result.returncode != 0:
            raise RuntimeError(
                f"git {' '.join(args)} failed (rc={result.returncode}): "
                f"{result.stderr.strip()}"
            )
        return result.stdout.strip()

    def _key_to_path(self, key: str) -> Path:
        """将 state key 映射到文件路径。

        使用 sha1 哈希避免 key 中包含非法文件名字符。
        """
        safe = hashlib.sha1(key.encode("utf-8")).hexdigest()[:24]
        return self.repo_path / f"{safe}.json"

    async def read(self, key: str) -> Optional[Any]:
        """读取指定 key 的当前值。"""
        path = self._key_to_path(key)

        def _read_sync() -> Optional[Any]:
            if not path.exists():
                return None
            try:
                text = path.read_text(encoding="utf-8")
                data = json.loads(text)
                return data.get("value")
            except (OSError, json.JSONDecodeError) as exc:
                logger.warning(
                    "GitDurableState read failed",
                    key=key,
                    path=str(path),
                    error=str(exc),
                )
                return None

        value = await asyncio.to_thread(_read_sync)
        if value is None:
            logger.debug("GitDurableState read miss", key=key)
        else:
            logger.debug("GitDurableState read hit", key=key)
        return value

    async def write(self, key: str, value: Any, writer: str) -> DurableState:
        """写入状态并提交到 git。"""
        path = self._key_to_path(key)
        now = datetime.now(timezone.utc).isoformat()

        def _write_sync() -> DurableState:
            # 读取旧版本以计算 version
            old_version = 0
            old_created_at = now
            if path.exists():
                try:
                    old_data = json.loads(path.read_text(encoding="utf-8"))
                    old_version = int(old_data.get("version", 0))
                    old_created_at = old_data.get("created_at", now)
                except (OSError, json.JSONDecodeError):
                    pass

            state = DurableState(
                key=key,
                value=value,
                version=old_version + 1,
                last_writer=writer,
                created_at=old_created_at,
                updated_at=now,
            )
            path.write_text(
                state.model_dump_json(indent=2),
                encoding="utf-8",
            )
            # git add + commit
            self._run_git(["add", path.name])
            self._run_git(
                [
                    "commit",
                    "-m",
                    f"chore(durable_state): write key={key} "
                    f"v={state.version} by={writer}",
                ]
            )
            return state

        async with self._lock:
            state = await asyncio.to_thread(_write_sync)
        logger.info(
            "GitDurableState written",
            key=key,
            version=state.version,
            writer=writer,
        )
        return state

    async def delete(self, key: str) -> bool:
        """删除指定 key 并提交到 git。"""
        path = self._key_to_path(key)

        def _delete_sync() -> bool:
            if not path.exists():
                return False
            self._run_git(["rm", path.name])
            self._run_git(
                [
                    "commit",
                    "-m",
                    f"chore(durable_state): delete key={key}",
                ]
            )
            return True

        async with self._lock:
            try:
                deleted = await asyncio.to_thread(_delete_sync)
            except RuntimeError as exc:
                logger.warning(
                    "GitDurableState delete failed",
                    key=key,
                    error=str(exc),
                )
                return False
        if deleted:
            logger.info("GitDurableState deleted", key=key)
        return deleted


__all__ = [
    "DurableState",
    "DurableStateSurface",
    "SqliteDurableState",
    "GitDurableState",
]
