import pytest
import asyncio
import tempfile
import time
from flowforge.memory.mailbox import Mailbox


@pytest.fixture
def mailbox():
    path = tempfile.mktemp(suffix=".db")
    m = Mailbox(path)
    yield m
    m._repo.conn.close()


@pytest.mark.asyncio
async def test_send_and_receive(mailbox):
    await mailbox.send("agent1", "agent2", "Hello", "World")
    msgs = await mailbox.receive("agent2", unread_only=True)
    assert len(msgs) == 1
    assert msgs[0]["subject"] == "Hello"


@pytest.mark.asyncio
async def test_receive_marks_read(mailbox):
    await mailbox.send("a", "b", "Test", "Body")
    msgs = await mailbox.receive("b", unread_only=True)
    assert len(msgs) == 1
    msgs2 = await mailbox.receive("b", unread_only=True)
    assert len(msgs2) == 0


@pytest.mark.asyncio
async def test_priority_ordering(mailbox):
    await mailbox.send("a", "b", "Normal", "body", priority="normal")
    await mailbox.send("a", "b", "Critical", "body", priority="critical")
    await mailbox.send("a", "b", "High", "body", priority="high")
    msgs = await mailbox.receive("b", unread_only=False, limit=10)
    assert msgs[0]["priority"] == "critical"
    assert msgs[1]["priority"] == "high"


@pytest.mark.asyncio
async def test_filter_by_priority(mailbox):
    await mailbox.send("a", "b", "Normal", "body", priority="normal")
    await mailbox.send("a", "b", "Critical", "body", priority="critical")
    msgs = await mailbox.receive("b", priority="critical", unread_only=False)
    assert len(msgs) == 1
    assert msgs[0]["priority"] == "critical"


@pytest.mark.asyncio
async def test_filter_by_sender(mailbox):
    await mailbox.send("alice", "bob", "From Alice", "body")
    await mailbox.send("charlie", "bob", "From Charlie", "body")
    msgs = await mailbox.receive("bob", sender="alice", unread_only=False)
    assert len(msgs) == 1
    assert msgs[0]["sender"] == "alice"


@pytest.mark.asyncio
async def test_filter_by_subject(mailbox):
    await mailbox.send("a", "b", "Bug Report", "body")
    await mailbox.send("a", "b", "Feature Request", "body")
    msgs = await mailbox.receive("b", subject_contains="Bug", unread_only=False)
    assert len(msgs) == 1
    assert "Bug" in msgs[0]["subject"]


@pytest.mark.asyncio
async def test_message_expiry(mailbox):
    await mailbox.send("a", "b", "Expiring", "body", ttl_seconds=1)
    await asyncio.sleep(1.5)
    msgs = await mailbox.receive("b", unread_only=True)
    assert len(msgs) == 0


@pytest.mark.asyncio
async def test_get_stats(mailbox):
    await mailbox.send("a", "b", "Msg1", "body")
    await mailbox.send("a", "b", "Msg2", "body")
    stats = await mailbox.get_stats("b")
    assert stats["unread"] == 2
