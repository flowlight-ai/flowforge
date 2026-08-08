"""CookieManager 和 AccountSelector 单元测试.

验证 Cookie 的加密存储、加载、过期检测和多账号轮换选择策略。
"""

import json
import time
from unittest.mock import patch

import pytest

from flowforge.tools.cookie_manager import (
    AccountSelectionStrategy,
    AccountSelector,
    CookieManager,
)


class MockCredentialStore:
    """内存版 CredentialStore mock，用于测试."""

    def __init__(self):
        self._store = {}

    def get_credential(self, key_name):
        return self._store.get(key_name)

    def set_credential(self, key_name, value, backend="env"):
        self._store[key_name] = value

    def delete_credential(self, key_name):
        self._store.pop(key_name, None)

    def list_credentials(self):
        return sorted(self._store.keys())


@pytest.fixture
def mock_store():
    """提供 mock 的 credential store，patch get_credential_store 单例."""
    store = MockCredentialStore()
    with patch(
        "flowforge.tools.cookie_manager.get_credential_store",
        return_value=store,
    ):
        yield store


def _make_cookies(expires=0.0):
    """构造 Playwright 格式的 cookie 列表."""
    return [
        {
            "name": "session_id",
            "value": "abc123",
            "domain": ".example.com",
            "path": "/",
            "expires": expires,
            "httpOnly": True,
            "secure": True,
            "sameSite": "Lax",
        },
        {
            "name": "token",
            "value": "xyz789",
            "domain": ".example.com",
            "path": "/",
            "expires": expires,
            "httpOnly": False,
            "secure": False,
            "sameSite": "Strict",
        },
    ]


# ═══════════════════════════════════════════════════════════════════════
# CookieManager 测试
# ═══════════════════════════════════════════════════════════════════════


class TestCookieManager:
    """CookieManager 核心功能测试."""

    def test_save_and_load_cookies(self, mock_store):
        """保存 cookie 后加载，验证数据一致."""
        manager = CookieManager()
        cookies = _make_cookies(expires=0.0)
        manager.save_cookies(
            platform="toutiao",
            account_id="acc_001",
            cookies=cookies,
            display_name="测试账号",
        )

        loaded = manager.load_cookies("toutiao", "acc_001")

        assert len(loaded) == 2
        assert loaded[0]["name"] == "session_id"
        assert loaded[0]["value"] == "abc123"
        assert loaded[0]["domain"] == ".example.com"
        assert loaded[0]["httpOnly"] is True
        assert loaded[0]["secure"] is True
        assert loaded[1]["name"] == "token"
        assert loaded[1]["value"] == "xyz789"
        assert loaded[1]["sameSite"] == "Strict"

    def test_save_cookies_stores_in_credential_store(self, mock_store):
        """验证 cookie 被写入 credential store（加密存储）."""
        manager = CookieManager()
        manager.save_cookies(
            platform="wechat",
            account_id="acc_002",
            cookies=_make_cookies(),
        )
        key = "cookie_wechat_acc_002"
        assert key in mock_store._store
        stored = json.loads(mock_store._store[key])
        assert len(stored) == 2
        assert stored[0]["name"] == "session_id"

    def test_load_cookies_from_credential_store(self, mock_store):
        """新 manager 实例从 credential store 加载 cookie（内存缓存为空）."""
        manager1 = CookieManager()
        manager1.save_cookies(
            platform="zhihu",
            account_id="acc_003",
            cookies=_make_cookies(),
        )

        # 新实例，内存缓存为空，从 credential store 加载
        manager2 = CookieManager()
        loaded = manager2.load_cookies("zhihu", "acc_003")

        assert len(loaded) == 2
        assert loaded[0]["name"] == "session_id"
        assert loaded[1]["name"] == "token"

    def test_load_cookies_not_found(self, mock_store):
        """加载不存在的 cookie 返回空列表."""
        manager = CookieManager()
        loaded = manager.load_cookies("toutiao", "nonexistent")
        assert loaded == []

    def test_is_expired_not_expired(self, mock_store):
        """expires=0 的 cookie 永不过期."""
        manager = CookieManager()
        manager.save_cookies(
            platform="toutiao",
            account_id="acc_001",
            cookies=_make_cookies(expires=0.0),
        )
        assert manager.is_expired("toutiao", "acc_001") is False

    def test_is_expired_expired(self, mock_store):
        """过期的 cookie 被正确检测为过期."""
        manager = CookieManager()
        past_time = time.time() - 1000
        manager.save_cookies(
            platform="toutiao",
            account_id="acc_expired",
            cookies=_make_cookies(expires=past_time),
        )
        assert manager.is_expired("toutiao", "acc_expired") is True

    def test_is_expired_no_cookies(self, mock_store):
        """无 cookie 的账号视为过期."""
        manager = CookieManager()
        assert manager.is_expired("toutiao", "nonexistent") is True

    def test_list_accounts(self, mock_store):
        """列出某平台下所有账号 ID."""
        manager = CookieManager()
        manager.save_cookies("toutiao", "acc_001", _make_cookies())
        manager.save_cookies("toutiao", "acc_002", _make_cookies())
        manager.save_cookies("wechat", "acc_003", _make_cookies())

        toutiao_accounts = manager.list_accounts("toutiao")
        assert set(toutiao_accounts) == {"acc_001", "acc_002"}

        wechat_accounts = manager.list_accounts("wechat")
        assert wechat_accounts == ["acc_003"]

        empty = manager.list_accounts("nonexistent")
        assert empty == []

    def test_mark_used(self, mock_store):
        """标记使用后计数和时间更新."""
        manager = CookieManager()
        manager.save_cookies("toutiao", "acc_001", _make_cookies())
        account = manager._accounts["toutiao"]["acc_001"]
        original_count = account.use_count
        original_last_used = account.last_used

        time.sleep(0.01)
        manager.mark_used("toutiao", "acc_001")

        assert account.use_count == original_count + 1
        assert account.last_used > original_last_used


# ═══════════════════════════════════════════════════════════════════════
# AccountSelector 测试
# ═══════════════════════════════════════════════════════════════════════


class TestAccountSelector:
    """AccountSelector 多账号选择策略测试."""

    def _setup_accounts(self, manager, platform="toutiao", count=3):
        """创建多个测试账号."""
        for i in range(count):
            manager.save_cookies(
                platform=platform,
                account_id=f"acc_{i:03d}",
                cookies=_make_cookies(expires=0.0),
                display_name=f"账号{i}",
            )
        return manager

    def test_account_selector_round_robin(self, mock_store):
        """轮询策略依次选择每个账号."""
        manager = self._setup_accounts(CookieManager())
        selector = AccountSelector(manager)

        selected = []
        for _ in range(3):
            acc = selector.select_account(
                "toutiao", strategy=AccountSelectionStrategy.ROUND_ROBIN
            )
            selected.append(acc)

        # 前三次应各选一个，不重复
        assert len(set(selected)) == 3
        assert set(selected) == {"acc_000", "acc_001", "acc_002"}

    def test_account_selector_round_robin_wraps(self, mock_store):
        """轮询到末尾后从头开始."""
        manager = self._setup_accounts(CookieManager(), count=2)
        selector = AccountSelector(manager)

        first = selector.select_account(
            "toutiao", strategy=AccountSelectionStrategy.ROUND_ROBIN
        )
        second = selector.select_account(
            "toutiao", strategy=AccountSelectionStrategy.ROUND_ROBIN
        )
        third = selector.select_account(
            "toutiao", strategy=AccountSelectionStrategy.ROUND_ROBIN
        )

        assert first == "acc_000"
        assert second == "acc_001"
        assert third == "acc_000"  # wraps around

    def test_account_selector_least_used(self, mock_store):
        """最少使用策略选择使用次数最少的账号."""
        manager = self._setup_accounts(CookieManager())
        manager._accounts["toutiao"]["acc_000"].use_count = 5
        manager._accounts["toutiao"]["acc_001"].use_count = 1
        manager._accounts["toutiao"]["acc_002"].use_count = 3

        selector = AccountSelector(manager)
        selected = selector.select_account(
            "toutiao", strategy=AccountSelectionStrategy.LEAST_USED
        )

        assert selected == "acc_001"  # use_count 最低

    def test_account_selector_least_used_increments(self, mock_store):
        """最少使用策略选中后计数增加."""
        manager = self._setup_accounts(CookieManager())
        manager._accounts["toutiao"]["acc_000"].use_count = 5
        manager._accounts["toutiao"]["acc_001"].use_count = 1
        manager._accounts["toutiao"]["acc_002"].use_count = 3

        selector = AccountSelector(manager)
        selector.select_account(
            "toutiao", strategy=AccountSelectionStrategy.LEAST_USED
        )

        assert manager._accounts["toutiao"]["acc_001"].use_count == 2

    def test_account_selector_no_accounts(self, mock_store):
        """无可用账号时返回 None."""
        manager = CookieManager()
        selector = AccountSelector(manager)

        result = selector.select_account("toutiao")
        assert result is None

    def test_account_selector_all_expired(self, mock_store):
        """所有账号过期时返回 None."""
        manager = CookieManager()
        past = time.time() - 1000
        manager.save_cookies("toutiao", "acc_001", _make_cookies(expires=past))
        manager.save_cookies("toutiao", "acc_002", _make_cookies(expires=past))

        selector = AccountSelector(manager)
        result = selector.select_account("toutiao")
        assert result is None

    def test_account_selector_manual(self, mock_store):
        """手动策略选择指定账号."""
        manager = self._setup_accounts(CookieManager())
        selector = AccountSelector(manager)

        result = selector.select_account(
            "toutiao",
            strategy=AccountSelectionStrategy.MANUAL,
            manual_account_id="acc_001",
        )
        assert result == "acc_001"

    def test_account_selector_manual_fallback(self, mock_store):
        """手动策略指定账号不存在时回退到第一个可用账号."""
        manager = self._setup_accounts(CookieManager())
        selector = AccountSelector(manager)

        result = selector.select_account(
            "toutiao",
            strategy=AccountSelectionStrategy.MANUAL,
            manual_account_id="nonexistent",
        )
        assert result is not None
        assert result in {"acc_000", "acc_001", "acc_002"}
