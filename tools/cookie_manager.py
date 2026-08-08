"""Cookie 管理器 — 多平台登录态加密存储与多账号轮换.

提供 Playwright 发布场景下的 Cookie 生命周期管理：
- 加密存储（通过 CredentialStore）
- 多账号选择（round_robin / least_used / manual）
- 过期检测与刷新
"""

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from flowforge.core.credential_store import get_credential_store
from flowforge.core.tracing import get_logger

logger = get_logger("tools.cookie_manager")


class AccountSelectionStrategy(str, Enum):
    """账号选择策略."""

    ROUND_ROBIN = "round_robin"
    LEAST_USED = "least_used"
    MANUAL = "manual"


@dataclass
class CookieEntry:
    """单条 Cookie 记录."""

    name: str
    value: str
    domain: str
    path: str = "/"
    expires: float = 0.0
    http_only: bool = False
    secure: bool = False
    same_site: str = "Lax"

    def is_expired(self) -> bool:
        """检查 Cookie 是否过期."""
        if self.expires == 0:
            return False
        return time.time() > self.expires


@dataclass
class AccountInfo:
    """账号信息."""

    account_id: str
    platform: str
    display_name: str = ""
    last_used: float = 0.0
    use_count: int = 0
    cookies: list[CookieEntry] = field(default_factory=list)

    def is_valid(self) -> bool:
        """检查账号 Cookie 是否全部有效."""
        return all(not c.is_expired() for c in self.cookies)


class CookieManager:
    """Cookie 管理器 — 加密存储、加载、过期检测、多账号轮换.

    通过 FlowForge CredentialStore 进行加密存储，
    支持多平台多账号管理。
    """

    def __init__(self):
        self._credential_store = get_credential_store()
        self._accounts: dict[str, dict[str, AccountInfo]] = {}  # platform -> account_id -> info
        self._rr_index: dict[str, int] = {}  # round robin counter per platform

    def _credential_key(self, platform: str, account_id: str) -> str:
        """生成 CredentialStore 中的 key."""
        return f"cookie_{platform}_{account_id}"

    def save_cookies(
        self,
        platform: str,
        account_id: str,
        cookies: list[dict[str, Any]],
        display_name: str = "",
    ) -> None:
        """保存 Cookie 到加密存储.

        Args:
            platform: 平台名（toutiao/wechat/baijiahao/zhihu）
            account_id: 账号 ID
            cookies: Playwright 格式的 Cookie 列表
            display_name: 账号显示名
        """
        storage_key = self._credential_key(platform, account_id)
        logger.debug(
            f"save_cookies: enter platform={platform} account_id={account_id} "
            f"incoming_cookie_count={len(cookies)} storage_key={storage_key} "
            f"display_name={display_name!r}"
        )
        cookie_entries = [
            CookieEntry(
                name=c.get("name", ""),
                value=c.get("value", ""),
                domain=c.get("domain", ""),
                path=c.get("path", "/"),
                expires=c.get("expires", 0.0),
                http_only=c.get("httpOnly", False),
                secure=c.get("secure", False),
                same_site=c.get("sameSite", "Lax"),
            )
            for c in cookies
        ]

        account = AccountInfo(
            account_id=account_id,
            platform=platform,
            display_name=display_name or account_id,
            last_used=time.time(),
            cookies=cookie_entries,
        )

        # 存入内存索引
        if platform not in self._accounts:
            self._accounts[platform] = {}
        self._accounts[platform][account_id] = account

        # 加密存储到 CredentialStore
        import json

        serialized = json.dumps(
            [
                {
                    "name": c.name,
                    "value": c.value,
                    "domain": c.domain,
                    "path": c.path,
                    "expires": c.expires,
                    "httpOnly": c.http_only,
                    "secure": c.secure,
                    "sameSite": c.same_site,
                }
                for c in cookie_entries
            ]
        )
        self._credential_store.set_credential(
            self._credential_key(platform, account_id), serialized
        )

        logger.info(
            f"CookieManager: 保存 {platform}/{account_id} "
            f"({len(cookie_entries)} 条 cookie)"
        )
        logger.debug(
            f"save_cookies: exit platform={platform} account_id={account_id} "
            f"stored_cookie_count={len(cookie_entries)} storage_key={storage_key} "
            f"persisted=True"
        )

    def load_cookies(
        self, platform: str, account_id: str
    ) -> list[dict[str, Any]]:
        """从加密存储加载 Cookie.

        Returns:
            Playwright 格式的 Cookie 列表
        """
        import json

        logger.debug(
            f"load_cookies: enter platform={platform} account_id={account_id}"
        )

        # 先查内存缓存
        if platform in self._accounts and account_id in self._accounts[platform]:
            account = self._accounts[platform][account_id]
            if account.is_valid():
                cached_cookies = [
                    {
                        "name": c.name,
                        "value": c.value,
                        "domain": c.domain,
                        "path": c.path,
                        "expires": c.expires,
                        "httpOnly": c.http_only,
                        "secure": c.secure,
                        "sameSite": c.same_site,
                    }
                    for c in account.cookies
                ]
                logger.debug(
                    f"load_cookies: cache_hit platform={platform} "
                    f"account_id={account_id} cookie_count={len(cached_cookies)}"
                )
                return cached_cookies
            else:
                logger.debug(
                    f"load_cookies: cache_miss_invalid platform={platform} "
                    f"account_id={account_id} (cached cookies expired)"
                )
        else:
            logger.debug(
                f"load_cookies: cache_miss_absent platform={platform} "
                f"account_id={account_id} (not in memory cache)"
            )

        # 从 CredentialStore 加载
        serialized = self._credential_store.get_credential(
            self._credential_key(platform, account_id)
        )
        if not serialized:
            logger.warning(f"CookieManager: {platform}/{account_id} 无存储的 cookie")
            return []

        try:
            cookies = json.loads(serialized)
            logger.info(
                f"CookieManager: 加载 {platform}/{account_id} "
                f"({len(cookies)} 条 cookie)"
            )
            logger.debug(
                f"load_cookies: loaded_from_store platform={platform} "
                f"account_id={account_id} cookie_count={len(cookies)}"
            )
            return cookies
        except Exception as e:
            logger.error(f"CookieManager: 解析 cookie 失败: {e}")
            return []

    def is_expired(self, platform: str, account_id: str) -> bool:
        """检查账号 Cookie 是否过期."""
        logger.debug(
            f"is_expired: enter platform={platform} account_id={account_id}"
        )
        if platform in self._accounts and account_id in self._accounts[platform]:
            expired = not self._accounts[platform][account_id].is_valid()
            logger.debug(
                f"is_expired: result platform={platform} account_id={account_id} "
                f"expired={expired} source=memory_cache"
            )
            return expired

        cookies = self.load_cookies(platform, account_id)
        if not cookies:
            logger.debug(
                f"is_expired: result platform={platform} account_id={account_id} "
                f"expired=True source=no_cookies"
            )
            return True

        now = time.time()
        expired = any(c.get("expires", 0) > 0 and now > c["expires"] for c in cookies)
        logger.debug(
            f"is_expired: result platform={platform} account_id={account_id} "
            f"expired={expired} source=stored_cookies cookie_count={len(cookies)}"
        )
        return expired

    def list_accounts(self, platform: str) -> list[str]:
        """列出某平台的所有账号 ID."""
        if platform in self._accounts:
            accounts = list(self._accounts[platform].keys())
            logger.debug(
                f"list_accounts: platform={platform} account_count={len(accounts)} "
                f"account_ids={accounts}"
            )
            return accounts
        logger.debug(
            f"list_accounts: platform={platform} account_count=0 (platform not registered)"
        )
        return []

    def mark_used(self, platform: str, account_id: str) -> None:
        """标记账号已使用（更新使用计数和时间）."""
        if platform in self._accounts and account_id in self._accounts[platform]:
            account = self._accounts[platform][account_id]
            account.last_used = time.time()
            account.use_count += 1
            logger.debug(
                f"mark_used: platform={platform} account_id={account_id} "
                f"new_use_count={account.use_count} new_last_used={account.last_used}"
            )
        else:
            logger.debug(
                f"mark_used: no-op platform={platform} account_id={account_id} "
                f"(account not in memory cache)"
            )


class AccountSelector:
    """多账号选择器 — 支持 round_robin / least_used / manual 策略."""

    def __init__(self, cookie_manager: CookieManager):
        self._cookie_manager = cookie_manager

    def select_account(
        self,
        platform: str,
        strategy: AccountSelectionStrategy = AccountSelectionStrategy.ROUND_ROBIN,
        manual_account_id: str | None = None,
    ) -> str | None:
        """选择一个可用账号.

        Args:
            platform: 平台名
            strategy: 选择策略
            manual_account_id: manual 策略下指定的账号 ID

        Returns:
            选中的账号 ID，无可用账号时返回 None
        """
        logger.debug(
            f"select_account: enter platform={platform} strategy={strategy.value} "
            f"manual_account_id={manual_account_id!r}"
        )
        accounts = self._cookie_manager.list_accounts(platform)
        if not accounts:
            logger.warning(f"AccountSelector: {platform} 无可用账号")
            logger.debug(
                f"select_account: return None platform={platform} "
                f"reason=no_accounts_available"
            )
            return None

        # 过滤掉过期的账号
        valid = [a for a in accounts if not self._cookie_manager.is_expired(platform, a)]
        logger.debug(
            f"select_account: filter platform={platform} "
            f"total_accounts={len(accounts)} valid_accounts={len(valid)} "
            f"valid_ids={valid}"
        )
        if not valid:
            logger.warning(f"AccountSelector: {platform} 所有账号已过期")
            logger.debug(
                f"select_account: return None platform={platform} "
                f"reason=all_expired"
            )
            return None

        if strategy == AccountSelectionStrategy.MANUAL:
            if manual_account_id and manual_account_id in valid:
                logger.info(
                    f"select_account: selected platform={platform} "
                    f"strategy=manual account_id={manual_account_id} "
                    f"reason=manual_match"
                )
                return manual_account_id
            logger.info(
                f"select_account: selected platform={platform} "
                f"strategy=manual account_id={valid[0]} "
                f"reason=manual_fallback_first (requested={manual_account_id!r} not in valid)"
            )
            return valid[0]

        if strategy == AccountSelectionStrategy.ROUND_ROBIN:
            rr_key = platform
            idx = self._cookie_manager._rr_index.get(rr_key, 0)
            selected = valid[idx % len(valid)]
            self._cookie_manager._rr_index[rr_key] = idx + 1
            self._cookie_manager.mark_used(platform, selected)
            logger.info(
                f"select_account: selected platform={platform} "
                f"strategy=round_robin account_id={selected} "
                f"reason=rr_index_{idx}_of_{len(valid)}"
            )
            return selected

        if strategy == AccountSelectionStrategy.LEAST_USED:
            # 选择使用次数最少的
            least = min(
                valid,
                key=lambda a: self._cookie_manager._accounts.get(platform, {})
                .get(a, AccountInfo(account_id=a, platform=platform))
                .use_count,
            )
            self._cookie_manager.mark_used(platform, least)
            least_count = (
                self._cookie_manager._accounts.get(platform, {})
                .get(least, AccountInfo(account_id=least, platform=platform))
                .use_count
            )
            logger.info(
                f"select_account: selected platform={platform} "
                f"strategy=least_used account_id={least} "
                f"reason=min_use_count={least_count}"
            )
            return least

        logger.info(
            f"select_account: selected platform={platform} "
            f"strategy=unknown account_id={valid[0]} reason=fallback_first"
        )
        return valid[0]
