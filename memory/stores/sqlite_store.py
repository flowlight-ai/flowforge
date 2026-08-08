from sqlalchemy import create_engine, Column, String, Integer, Text
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from datetime import datetime, timezone
import uuid
from flowforge.core.config import system_config

class Base(DeclarativeBase):
    pass

class TaskModel(Base):
    __tablename__ = "tasks"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    persona = Column(String, nullable=False)
    mode = Column(String, nullable=False)
    interaction_mode = Column(String, default="standard")
    status = Column(String, default="pending")
    trace_id = Column(String, nullable=True)
    state_json = Column(Text, nullable=True)
    created_at = Column(String, default=lambda: datetime.now(timezone.utc).isoformat())
    completed_at = Column(String, nullable=True)

class AuditLogModel(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(String, default=lambda: datetime.now(timezone.utc).isoformat())
    level = Column(String, nullable=False)
    task_id = Column(String, nullable=True)
    step_name = Column(String, nullable=True)
    agent_name = Column(String, nullable=True)
    action = Column(String, nullable=True)
    detail = Column(Text, nullable=True)
    trace_id = Column(String, nullable=True)

class ModelHealthModel(Base):
    __tablename__ = "model_health"
    model_key = Column(String, primary_key=True)
    status = Column(String, nullable=False)
    last_check = Column(String, nullable=True)
    error_count = Column(Integer, default=0)
    disabled_until = Column(String, nullable=True)
    reason = Column(String, nullable=True)

engine = create_engine(system_config.db_url, connect_args={"check_same_thread": False})

def init_db():
    Base.metadata.create_all(engine)

def get_session():
    Session = sessionmaker(bind=engine)
    return Session()
