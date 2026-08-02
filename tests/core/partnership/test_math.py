"""Tests for the partnership math module (task.md P1-7).

Covers:
- UpperBoundCalculator: multi-candidate argmax, empty input, lower-cost tie-break
- LowerBoundCalculator: multi-gate product × strictest threshold, zero-prob
  collapse, empty gate list
- VarianceAbsorber: high variance + low threshold → collapse, low variance +
  high threshold → stable, absorption ratio split
- TokenLedger: record_entry / get_balance / list_entries / settle
- TokenLedger settle: A→B ×3 (10) + B→A ×1 (5) = A owes B 25

No LLM is involved — these are pure deterministic math tests.
"""

from __future__ import annotations

import pytest

from flowforge.core.errors import PartnershipError

# The partnership math subsystem is specified in docs/decisions/011-partnership-math.md
# but is NOT yet implemented. Skip these spec tests until it lands.
pytest.importorskip(
    "flowforge.core.partnership",
    reason="flowforge.core.partnership not implemented (docs/decisions/011-partnership-math.md) — TODO",
)

from flowforge.core.partnership import (  # noqa: E402
    DEFAULT_ABSORPTION_RATIO,
    AbsorptionResult,
    CandidatePath,
    LowerBoundCalculator,
    LowerBoundResult,
    QualityGate,
    SettlementResult,
    TokenEntry,
    TokenLedger,
    UpperBoundCalculator,
    UpperBoundResult,
    VarianceAbsorber,
)


# --------------------------------------------------------------------------- #
# UpperBoundCalculator
# --------------------------------------------------------------------------- #


def test_upper_bound_picks_highest_net_candidate() -> None:
    calc = UpperBoundCalculator()
    candidates = [
        CandidatePath(path_id="p1", expected_value=100.0, probability=0.5, cost=20.0),
        CandidatePath(path_id="p2", expected_value=80.0, probability=0.8, cost=10.0),
        CandidatePath(path_id="p3", expected_value=60.0, probability=0.9, cost=5.0),
    ]
    # nets: p1=30, p2=54, p3=49 → p2 wins
    result = calc.compute(candidates)

    assert isinstance(result, UpperBoundResult)
    assert result.best_path_id == "p2"
    assert result.upper_bound == pytest.approx(54.0)
    # expected_max = expected_value * probability of the winner
    assert result.expected_max == pytest.approx(80.0 * 0.8)
    assert "p2" in result.explanation


def test_upper_bound_empty_candidates_returns_zero() -> None:
    result = UpperBoundCalculator().compute([])

    assert result.upper_bound == 0.0
    assert result.best_path_id is None
    assert result.expected_max == 0.0
    assert result.explanation != ""


def test_upper_bound_same_expected_picks_lower_cost() -> None:
    calc = UpperBoundCalculator()
    candidates = [
        CandidatePath(path_id="p-high-cost", expected_value=10.0, probability=1.0, cost=5.0),
        CandidatePath(path_id="p-low-cost", expected_value=10.0, probability=1.0, cost=2.0),
    ]
    # Same gross expected (10.0); lower cost → higher net → wins.
    result = calc.compute(candidates)

    assert result.best_path_id == "p-low-cost"
    assert result.upper_bound == pytest.approx(8.0)


def test_upper_bound_rejects_invalid_candidate() -> None:
    with pytest.raises(PartnershipError):
        CandidatePath(path_id="", expected_value=1.0, probability=0.5)
    with pytest.raises(PartnershipError):
        CandidatePath(path_id="p", expected_value=1.0, probability=1.5)
    with pytest.raises(PartnershipError):
        CandidatePath(path_id="p", expected_value=-1.0, probability=0.5)
    with pytest.raises(PartnershipError):
        CandidatePath(path_id="p", expected_value=1.0, probability=0.5, cost=-1.0)


# --------------------------------------------------------------------------- #
# LowerBoundCalculator
# --------------------------------------------------------------------------- #


def test_lower_bound_multi_gate_product_times_strictest_threshold() -> None:
    calc = LowerBoundCalculator()
    gates = [
        QualityGate(gate_id="g1", threshold=0.8, pass_probability=0.9),
        QualityGate(gate_id="g2", threshold=0.7, pass_probability=0.8),
    ]
    # product = 0.9 * 0.8 = 0.72; strictest threshold = min(0.8, 0.7) = 0.7
    # lower_bound = 0.72 * 0.7 = 0.504
    result = calc.compute(gates)

    assert isinstance(result, LowerBoundResult)
    assert result.lower_bound == pytest.approx(0.504)
    assert result.passed_gates == ["g1", "g2"]
    assert result.failed_gates == []


def test_lower_bound_zero_pass_probability_collapses_to_zero() -> None:
    calc = LowerBoundCalculator()
    gates = [
        QualityGate(gate_id="g1", threshold=0.8, pass_probability=0.9),
        QualityGate(gate_id="g2", threshold=0.7, pass_probability=0.0),
    ]
    result = calc.compute(gates)

    assert result.lower_bound == 0.0
    assert result.passed_gates == ["g1"]
    assert result.failed_gates == ["g2"]
    assert "g2" in result.explanation


def test_lower_bound_empty_gate_list_returns_zero() -> None:
    result = LowerBoundCalculator().compute([])

    assert result.lower_bound == 0.0
    assert result.passed_gates == []
    assert result.failed_gates == []


def test_lower_bound_rejects_invalid_gate() -> None:
    with pytest.raises(PartnershipError):
        QualityGate(gate_id="", threshold=0.5, pass_probability=0.5)
    with pytest.raises(PartnershipError):
        QualityGate(gate_id="g", threshold=1.5, pass_probability=0.5)
    with pytest.raises(PartnershipError):
        QualityGate(gate_id="g", threshold=0.5, pass_probability=-0.1)


# --------------------------------------------------------------------------- #
# VarianceAbsorber
# --------------------------------------------------------------------------- #


def test_variance_high_variance_low_threshold_causes_collapse() -> None:
    absorber = VarianceAbsorber(absorption_ratio=0.7)
    # pvariance([10, 100]) = ((10-55)^2 + (100-55)^2) / 2 = 2025.0
    # passed_to_user = 0.3 * 2025 = 607.5 > threshold 100 → collapse
    result = absorber.compute_absorption(
        prices=[10.0, 100.0], user_collapse_threshold=100.0
    )

    assert isinstance(result, AbsorptionResult)
    assert result.passed_to_user == pytest.approx(607.5)
    assert result.user_would_collapse is True
    assert result.recommendation == "increase absorption ratio"


def test_variance_low_variance_high_threshold_stays_stable() -> None:
    absorber = VarianceAbsorber(absorption_ratio=0.7)
    # pvariance([10, 11]) = 0.25; passed = 0.3 * 0.25 = 0.075 < threshold 100
    result = absorber.compute_absorption(
        prices=[10.0, 11.0], user_collapse_threshold=100.0
    )

    assert result.passed_to_user == pytest.approx(0.075)
    assert result.user_would_collapse is False
    assert result.recommendation == "stable"


def test_variance_absorption_ratio_split_is_correct() -> None:
    absorber = VarianceAbsorber(absorption_ratio=0.7)
    # pvariance([10, 20]) = 25.0
    result = absorber.compute_absorption(
        prices=[10.0, 20.0], user_collapse_threshold=1000.0
    )

    assert result.absorbed_variance == pytest.approx(0.7 * 25.0)
    assert result.passed_to_user == pytest.approx(0.3 * 25.0)
    # absorbed + passed must reconstruct the full internal variance
    assert result.absorbed_variance + result.passed_to_user == pytest.approx(25.0)
    assert result.user_would_collapse is False


def test_variance_default_absorption_ratio_is_seventy_percent() -> None:
    assert DEFAULT_ABSORPTION_RATIO == 0.7
    absorber = VarianceAbsorber()
    assert absorber.absorption_ratio == 0.7


def test_variance_rejects_invalid_ratio_and_threshold() -> None:
    with pytest.raises(PartnershipError):
        VarianceAbsorber(absorption_ratio=1.5)
    with pytest.raises(PartnershipError):
        VarianceAbsorber(absorption_ratio=-0.1)
    absorber = VarianceAbsorber()
    with pytest.raises(PartnershipError):
        absorber.compute_absorption(prices=[1.0, 2.0], user_collapse_threshold=-1.0)


def test_variance_single_price_has_zero_variance() -> None:
    # A single observation has no variance → nothing absorbed, no collapse.
    result = VarianceAbsorber(absorption_ratio=0.7).compute_absorption(
        prices=[42.0], user_collapse_threshold=0.0
    )
    assert result.absorbed_variance == 0.0
    assert result.passed_to_user == 0.0
    # 0.0 > 0.0 is False → stable
    assert result.user_would_collapse is False


# --------------------------------------------------------------------------- #
# TokenLedger — record / balance / list
# --------------------------------------------------------------------------- #


def test_token_ledger_record_entry_returns_id() -> None:
    ledger = TokenLedger()
    entry_id = ledger.record_entry(
        TokenEntry(from_partner="A", to_partner="B", amount=10.0, reason="task reward")
    )

    assert isinstance(entry_id, str)
    assert entry_id.startswith("te-")
    assert len(ledger.list_entries()) == 1


def test_token_ledger_get_balance_reflects_direction() -> None:
    ledger = TokenLedger()
    ledger.record_entry(TokenEntry(from_partner="A", to_partner="B", amount=10.0))
    ledger.record_entry(TokenEntry(from_partner="B", to_partner="A", amount=5.0))

    # A: received 5, sent 10 → balance -5 (net debtor)
    # B: received 10, sent 5 → balance +5 (net creditor)
    assert ledger.get_balance("A") == pytest.approx(-5.0)
    assert ledger.get_balance("B") == pytest.approx(5.0)


def test_token_ledger_list_entries_filters_by_partner() -> None:
    ledger = TokenLedger()
    ledger.record_entry(TokenEntry(from_partner="A", to_partner="B", amount=10.0))
    ledger.record_entry(TokenEntry(from_partner="B", to_partner="A", amount=5.0))
    ledger.record_entry(TokenEntry(from_partner="A", to_partner="C", amount=3.0))

    assert len(ledger.list_entries()) == 3
    # A is involved in all three (A→B, B→A, A→C)
    assert len(ledger.list_entries("A")) == 3
    # B is involved in two (A→B, B→A)
    assert len(ledger.list_entries("B")) == 2
    # C is involved in one (A→C)
    assert len(ledger.list_entries("C")) == 1
    # Unknown partner → no entries
    assert ledger.list_entries("Z") == []


def test_token_entry_rejects_invalid_input() -> None:
    with pytest.raises(PartnershipError):
        TokenEntry(from_partner="", to_partner="B", amount=1.0)
    with pytest.raises(PartnershipError):
        TokenEntry(from_partner="A", to_partner="A", amount=1.0)
    with pytest.raises(PartnershipError):
        TokenEntry(from_partner="A", to_partner="B", amount=-1.0)


# --------------------------------------------------------------------------- #
# TokenLedger — settle
# --------------------------------------------------------------------------- #


def test_token_ledger_settle_net_amount_a_owes_b_twenty_five() -> None:
    """A→B three times 10 + B→A once 5 → A owes B net 25."""
    ledger = TokenLedger()
    for _ in range(3):
        ledger.record_entry(TokenEntry(from_partner="A", to_partner="B", amount=10.0))
    ledger.record_entry(TokenEntry(from_partner="B", to_partner="A", amount=5.0))

    result = ledger.settle("A", "B")

    assert isinstance(result, SettlementResult)
    assert result.from_partner == "A"
    assert result.to_partner == "B"
    # net = (10+10+10) - 5 = 25
    assert result.net_amount == pytest.approx(25.0)
    # all four entries between A and B were cleared
    assert len(result.settled_entries) == 4


def test_token_ledger_settle_marks_entries_as_settled_and_is_idempotent() -> None:
    ledger = TokenLedger()
    ledger.record_entry(TokenEntry(from_partner="A", to_partner="B", amount=10.0))
    ledger.record_entry(TokenEntry(from_partner="B", to_partner="A", amount=3.0))

    first = ledger.settle("A", "B")
    assert first.net_amount == pytest.approx(7.0)
    assert len(first.settled_entries) == 2
    # Every entry is now settled.
    assert all(e.settled for e in ledger.list_entries())

    # Re-settling finds nothing left → net 0, no entries cleared.
    second = ledger.settle("A", "B")
    assert second.net_amount == 0.0
    assert second.settled_entries == []


def test_token_ledger_settle_only_clears_pair_not_others() -> None:
    ledger = TokenLedger()
    ledger.record_entry(TokenEntry(from_partner="A", to_partner="B", amount=10.0))
    ledger.record_entry(TokenEntry(from_partner="A", to_partner="C", amount=4.0))

    result = ledger.settle("A", "B")

    assert result.net_amount == pytest.approx(10.0)
    assert len(result.settled_entries) == 1
    # The A→C entry must remain unsettled.
    a_to_c = [e for e in ledger.list_entries("C") if e.from_partner == "A"][0]
    assert a_to_c.settled is False


def test_token_ledger_settle_rejects_invalid_partners() -> None:
    ledger = TokenLedger()
    with pytest.raises(PartnershipError):
        ledger.settle("", "B")
    with pytest.raises(PartnershipError):
        ledger.settle("A", "A")


def test_token_ledger_get_balance_rejects_empty_partner() -> None:
    with pytest.raises(PartnershipError):
        TokenLedger().get_balance("")
