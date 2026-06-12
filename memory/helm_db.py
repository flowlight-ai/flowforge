"""HelmDatabase — Helm 模式 SQLite 数据库管理器

管理 plans（计划）和 attachments（附件）两张表，
提供完整的 CRUD 操作，支持 WAL 日志、外键约束和自动迁移。
"""

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.memory.helm_db")


class HelmDatabase:
    """Helm 模式数据库管理器，管理 plans 和 attachments 表。"""

    # ── Plan 状态 ──
    PLAN_PENDING = "pending"
    PLAN_CONFIRMED = "confirmed"
    PLAN_EXECUTING = "executing"
    PLAN_COMPLETED = "completed"
    PLAN_REJECTED = "rejected"
    PLAN_CANCELLED = "cancelled"

    # ── Attachment 状态 ──
    ATT_UPLOADED = "uploaded"
    ATT_PROCESSING = "processing"
    ATT_READY = "ready"
    ATT_FAILED = "failed"
    ATT_DELETED = "deleted"

    # ── Attachment 文件类型 ──
    ATT_TYPE_IMAGE = "image"
    ATT_TYPE_TEXT = "text"
    ATT_TYPE_CODE = "code"
    ATT_TYPE_PDF = "pdf"
    ATT_TYPE_JSON = "json"
    ATT_TYPE_OTHER = "other"

    def __init__(self, db_path: str = "data/helm.db") -> None:
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._db_path = db_path
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self._migrate()
        logger.info(f"HelmDatabase initialized: {db_path}")

    # ──────────────────────────── 迁移 ────────────────────────────

    def _migrate(self) -> None:
        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS plans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                steps_json TEXT NOT NULL DEFAULT '[]',
                status TEXT NOT NULL DEFAULT 'pending',
                current_step INTEGER NOT NULL DEFAULT 0,
                total_steps INTEGER NOT NULL DEFAULT 0,
                edited_steps TEXT,
                results_json TEXT,
                persona TEXT,
                mode TEXT,
                created_at TEXT NOT NULL,
                confirmed_at TEXT,
                started_at TEXT,
                completed_at TEXT,
                completion_status TEXT,
                error_message TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_plans_task_id ON plans(task_id);
            CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
            CREATE INDEX IF NOT EXISTS idx_plans_created_at ON plans(created_at);

            CREATE TABLE IF NOT EXISTS attachments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL,
                file_name TEXT NOT NULL,
                file_size INTEGER NOT NULL DEFAULT 0,
                file_type TEXT NOT NULL DEFAULT 'other',
                mime_type TEXT,
                extension TEXT,
                storage_path TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'uploaded',
                uploaded_at TEXT NOT NULL,
                last_accessed_at TEXT,
                error_message TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_attachments_task_id ON attachments(task_id);
            CREATE INDEX IF NOT EXISTS idx_attachments_status ON attachments(status);
            CREATE INDEX IF NOT EXISTS idx_attachments_uploaded_at ON attachments(uploaded_at);

            CREATE TABLE IF NOT EXISTS loops (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                template_name TEXT NOT NULL,
                phase TEXT NOT NULL DEFAULT 'planning',
                attempt INTEGER NOT NULL DEFAULT 0,
                max_retries INTEGER NOT NULL DEFAULT 3,
                state_json TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_loops_task_id ON loops(task_id);
            CREATE INDEX IF NOT EXISTS idx_loops_phase ON loops(phase);

            CREATE TABLE IF NOT EXISTS loop_iterations (
                id TEXT PRIMARY KEY,
                loop_id TEXT NOT NULL,
                attempt INTEGER NOT NULL,
                plan_json TEXT,
                result_json TEXT,
                verdict_json TEXT,
                reflection_json TEXT,
                started_at TEXT NOT NULL,
                completed_at TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_iterations_loop_id ON loop_iterations(loop_id);
        """)
        self.conn.commit()

        # Dynamic plan fields — ALTER TABLE doesn't support IF NOT EXISTS in SQLite
        for col, coldef in [
            ("plan_version", "INTEGER NOT NULL DEFAULT 1"),
            ("steps_status", "TEXT"),
            ("step_results", "TEXT"),
            ("conversation_context", "TEXT"),
            ("last_updated_at", "TEXT"),
            ("update_reasoning", "TEXT"),
        ]:
            try:
                self.conn.execute(f"ALTER TABLE plans ADD COLUMN {col} {coldef}")
            except sqlite3.OperationalError:
                pass  # Column already exists
        self.conn.commit()

        # Loop Engine tables
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS loops (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                template_name TEXT NOT NULL,
                phase TEXT NOT NULL DEFAULT 'planning',
                attempt INTEGER NOT NULL DEFAULT 0,
                max_retries INTEGER NOT NULL DEFAULT 3,
                state_json TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS loop_iterations (
                id TEXT PRIMARY KEY,
                loop_id TEXT NOT NULL REFERENCES loops(id),
                attempt INTEGER NOT NULL,
                plan_json TEXT,
                result_json TEXT,
                verdict_json TEXT,
                reflection_json TEXT,
                started_at TEXT NOT NULL,
                completed_at TEXT
            )
        """)
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_loops_task_id ON loops(task_id)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_loops_phase ON loops(phase)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_iterations_loop_id ON loop_iterations(loop_id)")
        self.conn.commit()

    # ──────────────────────────── Plan CRUD ────────────────────────────

    def create_plan(
        self,
        task_id: str,
        title: str,
        steps: list[dict[str, Any]],
        *,
        description: Optional[str] = None,
        persona: Optional[str] = None,
        mode: Optional[str] = None,
    ) -> int:
        """创建计划，返回自增 id。"""
        now = datetime.now(timezone.utc).isoformat()
        cursor = self.conn.execute(
            """
            INSERT INTO plans
                (task_id, title, description, steps_json, status, total_steps, persona, mode, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_id,
                title,
                description,
                json.dumps(steps, ensure_ascii=False),
                self.PLAN_PENDING,
                len(steps),
                persona,
                mode,
                now,
            ),
        )
        self.conn.commit()
        plan_id = cursor.lastrowid
        logger.info(f"Plan created: id={plan_id}, task_id={task_id}, title={title}")
        return plan_id

    def get_plan(self, plan_id: int) -> Optional[dict[str, Any]]:
        """按 id 获取计划，返回字典或 None。"""
        row = self.conn.execute(
            "SELECT * FROM plans WHERE id = ?",
            (plan_id,),
        ).fetchone()
        if row is None:
            return None
        return self._plan_row_to_dict(row)

    def get_plan_by_task(self, task_id: str) -> Optional[dict[str, Any]]:
        """按 task_id 获取最新一条计划。"""
        row = self.conn.execute(
            "SELECT * FROM plans WHERE task_id = ? ORDER BY created_at DESC LIMIT 1",
            (task_id,),
        ).fetchone()
        if row is None:
            return None
        return self._plan_row_to_dict(row)

    def update_plan_status(
        self,
        plan_id: int,
        status: str,
        *,
        current_step: Optional[int] = None,
        edited_steps: Optional[list[dict[str, Any]]] = None,
        results: Optional[list[dict[str, Any]]] = None,
        completion_status: Optional[str] = None,
        error_message: Optional[str] = None,
    ) -> bool:
        """更新计划状态及关联字段，返回是否成功。"""
        now = datetime.now(timezone.utc).isoformat()
        sets: list[str] = ["status = ?"]
        params: list[Any] = [status]

        if current_step is not None:
            sets.append("current_step = ?")
            params.append(current_step)
        if edited_steps is not None:
            sets.append("edited_steps = ?")
            params.append(json.dumps(edited_steps, ensure_ascii=False))
        if results is not None:
            sets.append("results_json = ?")
            params.append(json.dumps(results, ensure_ascii=False))
        if completion_status is not None:
            sets.append("completion_status = ?")
            params.append(completion_status)
        if error_message is not None:
            sets.append("error_message = ?")
            params.append(error_message)

        # 根据状态自动填充时间戳
        if status == self.PLAN_CONFIRMED:
            sets.append("confirmed_at = ?")
            params.append(now)
        elif status == self.PLAN_EXECUTING:
            sets.append("started_at = ?")
            params.append(now)
        elif status in (self.PLAN_COMPLETED, self.PLAN_REJECTED, self.PLAN_CANCELLED):
            sets.append("completed_at = ?")
            params.append(now)

        params.append(plan_id)
        cursor = self.conn.execute(
            f"UPDATE plans SET {', '.join(sets)} WHERE id = ?",
            params,
        )
        self.conn.commit()
        success = cursor.rowcount > 0
        if success:
            logger.info(f"Plan status updated: id={plan_id}, status={status}")
        else:
            logger.warning(f"Plan status update failed: id={plan_id}")
        return success

    def list_plans_by_task(self, task_id: str) -> list[dict[str, Any]]:
        """按 task_id 列出所有计划，按创建时间升序。"""
        rows = self.conn.execute(
            "SELECT * FROM plans WHERE task_id = ? ORDER BY created_at ASC",
            (task_id,),
        ).fetchall()
        return [self._plan_row_to_dict(row) for row in rows]

    # ──────────────────────────── Attachment CRUD ────────────────────────────

    def create_attachment(
        self,
        task_id: str,
        file_name: str,
        file_size: int,
        file_type: str,
        storage_path: str,
        *,
        mime_type: Optional[str] = None,
        extension: Optional[str] = None,
    ) -> int:
        """创建附件记录，返回自增 id。"""
        now = datetime.now(timezone.utc).isoformat()
        cursor = self.conn.execute(
            """
            INSERT INTO attachments
                (task_id, file_name, file_size, file_type, mime_type, extension,
                 storage_path, status, uploaded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_id,
                file_name,
                file_size,
                file_type,
                mime_type,
                extension,
                storage_path,
                self.ATT_UPLOADED,
                now,
            ),
        )
        self.conn.commit()
        att_id = cursor.lastrowid
        logger.info(f"Attachment created: id={att_id}, task_id={task_id}, file={file_name}")
        return att_id

    def get_attachment(self, attachment_id: int) -> Optional[dict[str, Any]]:
        """按 id 获取附件，返回字典或 None。"""
        row = self.conn.execute(
            "SELECT * FROM attachments WHERE id = ?",
            (attachment_id,),
        ).fetchone()
        if row is None:
            return None
        return self._attachment_row_to_dict(row)

    def list_attachments_by_task(self, task_id: str) -> list[dict[str, Any]]:
        """按 task_id 列出所有未删除附件，按上传时间升序。"""
        rows = self.conn.execute(
            "SELECT * FROM attachments WHERE task_id = ? AND status != ? ORDER BY uploaded_at ASC",
            (task_id, self.ATT_DELETED),
        ).fetchall()
        return [self._attachment_row_to_dict(row) for row in rows]

    def update_attachment_status(
        self,
        attachment_id: int,
        status: str,
        *,
        error_message: Optional[str] = None,
    ) -> bool:
        """更新附件状态，返回是否成功。"""
        sets: list[str] = ["status = ?"]
        params: list[Any] = [status]

        if error_message is not None:
            sets.append("error_message = ?")
            params.append(error_message)

        params.append(attachment_id)
        cursor = self.conn.execute(
            f"UPDATE attachments SET {', '.join(sets)} WHERE id = ?",
            params,
        )
        self.conn.commit()
        success = cursor.rowcount > 0
        if success:
            logger.info(f"Attachment status updated: id={attachment_id}, status={status}")
        else:
            logger.warning(f"Attachment status update failed: id={attachment_id}")
        return success

    def mark_accessed(self, attachment_id: int) -> bool:
        """更新附件最后访问时间。"""
        now = datetime.now(timezone.utc).isoformat()
        cursor = self.conn.execute(
            "UPDATE attachments SET last_accessed_at = ? WHERE id = ?",
            (now, attachment_id),
        )
        self.conn.commit()
        success = cursor.rowcount > 0
        if success:
            logger.debug(f"Attachment accessed: id={attachment_id}")
        return success

    def delete_attachment(self, attachment_id: int) -> bool:
        """软删除附件（状态置为 deleted）。"""
        return self.update_attachment_status(attachment_id, self.ATT_DELETED)

    # ──────────────────────────── 动态计划更新 ────────────────────────────

    def update_plan_incremental(
        self,
        plan_id: int,
        delta: Any,
        expected_version: int,
    ) -> Optional[dict[str, Any]]:
        """增量更新计划，使用乐观并发控制。

        Args:
            plan_id: 计划 ID
            delta: 增量更新数据（PlanDelta 实例）
            expected_version: 期望的当前版本号

        Returns:
            更新后的计划字典，版本冲突返回 None
        """
        plan = self.get_plan(plan_id)
        if plan is None:
            return None
        if plan.get("plan_version", 1) != expected_version:
            logger.warning(f"Plan version conflict: expected={expected_version}, actual={plan.get('plan_version', 1)}")
            return None

        steps: list[dict] = plan["steps_json"]
        steps_status: dict[str, str] = json.loads(plan.get("steps_status") or "{}")

        # 1. 标记完成
        for idx in delta.steps_completed:
            if 0 <= idx < len(steps):
                steps_status[str(idx)] = "completed"

        # 2. 修改现有步骤
        for idx, mod_step in delta.steps_modified.items():
            if 0 <= idx < len(steps):
                if mod_step.name:
                    steps[idx]["name"] = mod_step.name
                if mod_step.task:
                    steps[idx]["task"] = mod_step.task
                if mod_step.agent and mod_step.agent != "executor":
                    steps[idx]["agent"] = mod_step.agent

        # 3. 移除步骤（从后往前删，避免索引偏移）
        for idx in sorted(delta.steps_removed, reverse=True):
            if 0 <= idx < len(steps):
                steps.pop(idx)
                # 重建 steps_status
                new_status = {}
                for k, v in steps_status.items():
                    ki = int(k)
                    if ki < idx:
                        new_status[str(ki)] = v
                    elif ki > idx:
                        new_status[str(ki - 1)] = v
                steps_status = new_status

        # 4. 添加新步骤
        for new_step in delta.steps_added:
            step_dict = new_step.model_dump(exclude_none=True)
            step_dict.pop("status", None)  # status 由 steps_status 管理
            step_dict.pop("result_summary", None)
            new_idx = len(steps)
            steps.append(step_dict)
            steps_status[str(new_idx)] = "pending"

        # 5. 更新标题/描述
        title = delta.title_updated or plan["title"]
        description = delta.description_updated or plan.get("description", "")

        now = datetime.now(timezone.utc).isoformat()
        new_version = expected_version + 1

        self.conn.execute(
            """UPDATE plans SET
                steps_json = ?, steps_status = ?, total_steps = ?,
                title = ?, description = ?,
                plan_version = ?, last_updated_at = ?, update_reasoning = ?
            WHERE id = ? AND plan_version = ?""",
            (
                json.dumps(steps, ensure_ascii=False),
                json.dumps(steps_status, ensure_ascii=False),
                len(steps),
                title, description,
                new_version, now, delta.reasoning,
                plan_id, expected_version,
            ),
        )
        self.conn.commit()

        return self.get_plan(plan_id)

    def update_step_status(
        self,
        plan_id: int,
        step_index: int,
        status: str,
        result_summary: str | None = None,
    ) -> bool:
        """更新单个步骤的状态。"""
        plan = self.get_plan(plan_id)
        if plan is None:
            return False

        steps_status: dict[str, str] = json.loads(plan.get("steps_status") or "{}")
        steps_status[str(step_index)] = status

        sets = ["steps_status = ?"]
        params: list[Any] = [json.dumps(steps_status, ensure_ascii=False)]

        if result_summary is not None:
            step_results: dict[str, str] = json.loads(plan.get("step_results") or "{}")
            step_results[str(step_index)] = result_summary
            sets.append("step_results = ?")
            params.append(json.dumps(step_results, ensure_ascii=False))

        # 如果步骤正在运行，更新计划状态为 executing
        if status == "running" and plan["status"] == "confirmed":
            sets.append("status = ?")
            params.append(self.PLAN_EXECUTING)
            sets.append("started_at = ?")
            params.append(datetime.now(timezone.utc).isoformat())

        # 检查是否所有步骤都已完成
        if status in ("completed", "failed", "skipped"):
            all_done = all(
                steps_status.get(str(i), "pending") in ("completed", "failed", "skipped")
                for i in range(plan["total_steps"])
            )
            if all_done:
                sets.append("status = ?")
                params.append(self.PLAN_COMPLETED)
                sets.append("completed_at = ?")
                params.append(datetime.now(timezone.utc).isoformat())

        params.append(plan_id)
        self.conn.execute(
            f"UPDATE plans SET {', '.join(sets)} WHERE id = ?",
            params,
        )
        self.conn.commit()
        return True

    def update_conversation_context(self, plan_id: int, context: list[dict[str, str]]) -> None:
        """Update the conversation context for a plan."""
        # Keep only last 20 messages
        context = context[-20:]
        self.conn.execute(
            "UPDATE plans SET conversation_context = ? WHERE id = ?",
            (json.dumps(context, ensure_ascii=False), plan_id),
        )
        self.conn.commit()

    # ──────────────────────────── Loop Engine CRUD ────────────────────────────

    def create_loop(self, task_id: str, template_name: str, max_retries: int = 3) -> str:
        """创建 Loop 实例，返回 loop_id。"""
        import uuid
        loop_id = f"loop-{uuid.uuid4().hex[:12]}"
        now = datetime.now(timezone.utc).isoformat()
        self.conn.execute(
            """INSERT INTO loops (id, task_id, template_name, max_retries, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (loop_id, task_id, template_name, max_retries, now, now),
        )
        self.conn.commit()
        logger.info(f"Loop created: id={loop_id}, task_id={task_id}, template={template_name}")
        return loop_id

    def get_loop(self, loop_id: str) -> Optional[dict[str, Any]]:
        """按 id 获取 Loop 实例，返回字典或 None。"""
        row = self.conn.execute("SELECT * FROM loops WHERE id = ?", (loop_id,)).fetchone()
        if row is None:
            return None
        return {
            "id": row[0],
            "task_id": row[1],
            "template_name": row[2],
            "phase": row[3],
            "attempt": row[4],
            "max_retries": row[5],
            "state_json": json.loads(row[6]) if row[6] else None,
            "created_at": row[7],
            "updated_at": row[8],
        }

    def get_loops_by_task(self, task_id: str) -> list[dict[str, Any]]:
        """按 task_id 获取所有 Loop 实例。"""
        rows = self.conn.execute(
            "SELECT * FROM loops WHERE task_id = ? ORDER BY created_at DESC",
            (task_id,),
        ).fetchall()
        return [
            {
                "id": row[0],
                "task_id": row[1],
                "template_name": row[2],
                "phase": row[3],
                "attempt": row[4],
                "max_retries": row[5],
                "state_json": json.loads(row[6]) if row[6] else None,
                "created_at": row[7],
                "updated_at": row[8],
            }
            for row in rows
        ]

    def update_loop_state(self, loop_id: str, state_json: str, phase: str, attempt: int) -> bool:
        """更新 Loop 状态，返回是否成功。"""
        now = datetime.now(timezone.utc).isoformat()
        cursor = self.conn.execute(
            "UPDATE loops SET state_json = ?, phase = ?, attempt = ?, updated_at = ? WHERE id = ?",
            (state_json, phase, attempt, now, loop_id),
        )
        self.conn.commit()
        success = cursor.rowcount > 0
        if success:
            logger.info(f"Loop state updated: id={loop_id}, phase={phase}, attempt={attempt}")
        else:
            logger.warning(f"Loop state update failed: id={loop_id}")
        return success

    def create_loop_iteration(
        self,
        loop_id: str,
        attempt: int,
        plan_json: str | None = None,
        result_json: str | None = None,
        verdict_json: str | None = None,
        reflection_json: str | None = None,
    ) -> str:
        """创建 Loop 迭代记录，返回迭代 id。"""
        import uuid
        iter_id = f"iter-{uuid.uuid4().hex[:12]}"
        now = datetime.now(timezone.utc).isoformat()
        self.conn.execute(
            """INSERT INTO loop_iterations
               (id, loop_id, attempt, plan_json, result_json, verdict_json, reflection_json, started_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (iter_id, loop_id, attempt, plan_json, result_json, verdict_json, reflection_json, now),
        )
        self.conn.commit()
        logger.info(f"Loop iteration created: id={iter_id}, loop_id={loop_id}, attempt={attempt}")
        return iter_id

    def get_loop_iterations(self, loop_id: str) -> list[dict[str, Any]]:
        """获取 Loop 的所有迭代记录。"""
        rows = self.conn.execute(
            "SELECT * FROM loop_iterations WHERE loop_id = ? ORDER BY attempt ASC",
            (loop_id,),
        ).fetchall()
        return [
            {
                "id": row[0],
                "loop_id": row[1],
                "attempt": row[2],
                "plan_json": json.loads(row[3]) if row[3] else None,
                "result_json": json.loads(row[4]) if row[4] else None,
                "verdict_json": json.loads(row[5]) if row[5] else None,
                "reflection_json": json.loads(row[6]) if row[6] else None,
                "started_at": row[7],
                "completed_at": row[8],
            }
            for row in rows
        ]

    # ──────────────────────────── 行转字典 ────────────────────────────

    @staticmethod
    def _plan_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row[0],
            "task_id": row[1],
            "title": row[2],
            "description": row[3],
            "steps_json": json.loads(row[4]) if row[4] else [],
            "status": row[5],
            "current_step": row[6],
            "total_steps": row[7],
            "edited_steps": json.loads(row[8]) if row[8] else None,
            "results_json": json.loads(row[9]) if row[9] else None,
            "persona": row[10],
            "mode": row[11],
            "created_at": row[12],
            "confirmed_at": row[13],
            "started_at": row[14],
            "completed_at": row[15],
            "completion_status": row[16],
            "error_message": row[17],
            # Dynamic plan fields
            "plan_version": row[18] if len(row) > 18 else 1,
            "steps_status": json.loads(row[19]) if len(row) > 19 and row[19] else None,
            "step_results": json.loads(row[20]) if len(row) > 20 and row[20] else None,
            "conversation_context": json.loads(row[21]) if len(row) > 21 and row[21] else None,
            "last_updated_at": row[22] if len(row) > 22 else None,
            "update_reasoning": row[23] if len(row) > 23 else None,
        }

    @staticmethod
    def _attachment_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row[0],
            "task_id": row[1],
            "file_name": row[2],
            "file_size": row[3],
            "file_type": row[4],
            "mime_type": row[5],
            "extension": row[6],
            "storage_path": row[7],
            "status": row[8],
            "uploaded_at": row[9],
            "last_accessed_at": row[10],
            "error_message": row[11],
        }


# ── 模块级单例 ──

_helm_db: HelmDatabase | None = None


def get_helm_db() -> HelmDatabase:
    """获取 HelmDatabase 单例实例。"""
    global _helm_db
    if _helm_db is None:
        _helm_db = HelmDatabase()
    return _helm_db
