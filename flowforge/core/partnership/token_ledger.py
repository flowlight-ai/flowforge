"""Token Ledger — partnership settlement accounting.

Tracks token debts between partners. Each entry records a directional transfer
(``from_partner`` → ``to_partner``) for some reason. Settlement computes the
net amount one partner owes another across all unsettled entries between them
and marks those entries as settled.

Formula (task.md P1-7 / ADR-011):

    net_amount(A→B) = Σ(amount where from=A, to=B)
                    - Σ(amount where from=B, to=A)

A positive ``net_amount`` means A has paid B that much net (A's net payable to
B). A negative ``net_amount`` means B has paid A ``|net_amount|`` net.

Balance convention for ``get_balance``:

    balance(P) = Σ(received by P) - Σ(sent by P)

Positive = P is a net creditor (owed tokens); negative = P is a net debtor.

This module is LLM-free, deterministic, and depends only on
flowforge.core (errors, tracing).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from flowforge.core.errors import PartnershipError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.partnership.token_ledger")


@dataclass
class TokenEntry:
    """One directional token transfer between two partners.

    Attributes:
        from_partner: partner paying tokens.
        to_partner: partner receiving tokens.
        amount: non-negative token amount.
        reason: human-readable reason for the transfer.
        entry_id: stable identifier (auto-generated if absent).
        created_at: timestamp (auto-generated if absent).
        settled: True once a settlement has cleared this entry.
    """

    from_partner: str
    to_partner: str
    amount: float
    reason: str = ""
    entry_id: str = field(default_factory=lambda: f"te-{uuid.uuid4().hex[:12]}")
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    settled: bool = False

    def __post_init__(self) -> None:
        if not self.from_partner:
            raise PartnershipError("from_partner must not be empty")
        if not self.to_partner:
            raise PartnershipError("to_partner must not be empty")
        if self.from_partner == self.to_partner:
            raise PartnershipError("from_partner and to_partner must differ")
        if self.amount < 0.0:
            raise PartnershipError(f"amount must be >= 0.0, got {self.amount}")


@dataclass(frozen=True)
class SettlementResult:
    """Output of TokenLedger.settle()."""

    from_partner: str
    to_partner: str
    net_amount: float
    settled_entries: list[str]


class TokenLedger:
    """Append-only ledger of token transfers between partners.

    Entries are recorded with ``record_entry`` and queried with
    ``list_entries`` or ``get_balance``. ``settle(partner_a, partner_b)``
    computes the net amount partner_a owes partner_b across all unsettled
    entries between them, marks those entries as settled, and returns the
    settlement result.
    """

    def __init__(self) -> None:
        self._entries: list[TokenEntry] = []

    def record_entry(self, entry: TokenEntry) -> str:
        """Record a token transfer entry. Returns the entry_id."""
        self._entries.append(entry)
        logger.info(
            f"partnership: token_entry recorded id={entry.entry_id} "
            f"{entry.from_partner}->{entry.to_partner} "
            f"amount={entry.amount:.4f}"
        )
        return entry.entry_id

    def get_balance(self, partner_id: str) -> float:
        """Net token balance for a partner.

        Positive = partner is owed tokens (received more than sent).
        Negative = partner owes tokens (sent more than received).
        """
        if not partner_id:
            raise PartnershipError("partner_id must not be empty")
        received = sum(
            e.amount for e in self._entries if e.to_partner == partner_id
        )
        sent = sum(
            e.amount for e in self._entries if e.from_partner == partner_id
        )
        balance = received - sent
        logger.debug(
            f"partnership: balance partner={partner_id} net={balance:.4f}"
        )
        return balance

    def list_entries(self, partner_id: str | None = None) -> list[TokenEntry]:
        """List entries, optionally filtered to a single partner (as from or to)."""
        if partner_id is None:
            return list(self._entries)
        return [
            e
            for e in self._entries
            if e.from_partner == partner_id or e.to_partner == partner_id
        ]

    def settle(self, partner_a: str, partner_b: str) -> SettlementResult:
        """Settle all unsettled entries between partner_a and partner_b.

        Returns a ``SettlementResult`` with ``from_partner=partner_a``,
        ``to_partner=partner_b``, ``net_amount = Σ(A→B) - Σ(B→A)``, and the
        ids of the entries that were cleared. A positive ``net_amount`` means
        A has paid B that much net; a negative one means B has paid A
        ``|net_amount|`` net.
        """
        if not partner_a or not partner_b:
            raise PartnershipError("partner ids must not be empty")
        if partner_a == partner_b:
            raise PartnershipError("cannot settle a partner against itself")

        a_to_b = 0.0
        b_to_a = 0.0
        settled_ids: list[str] = []
        for e in self._entries:
            if e.settled:
                continue
            if e.from_partner == partner_a and e.to_partner == partner_b:
                a_to_b += e.amount
                e.settled = True
                settled_ids.append(e.entry_id)
            elif e.from_partner == partner_b and e.to_partner == partner_a:
                b_to_a += e.amount
                e.settled = True
                settled_ids.append(e.entry_id)

        net = a_to_b - b_to_a
        logger.info(
            f"partnership: settle {partner_a}<->{partner_b} "
            f"net={net:.4f} settled_entries={len(settled_ids)}"
        )
        return SettlementResult(
            from_partner=partner_a,
            to_partner=partner_b,
            net_amount=net,
            settled_entries=settled_ids,
        )
