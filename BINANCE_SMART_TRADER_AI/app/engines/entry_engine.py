from __future__ import annotations

from dataclasses import dataclass


@dataclass
class EntryAssessment:
    state: str
    late_entry_blocked: bool
    notes: list[str]


def evaluate_entry_state(
    direction: str,
    active_score: int,
    min_score: int,
    price: float,
    ema21: float,
    atr_val: float,
    bias_15m: str,
    bias_5m: str,
    data_stale: bool,
) -> EntryAssessment:
    if data_stale:
        return EntryAssessment("INVALIDATED", False, ["Market data stale or missing; entry invalidated."])

    if atr_val > 0 and abs(price - ema21) > atr_val * 2.4 and direction != "WAIT":
        return EntryAssessment(
            "WAIT",
            True,
            ["Price extended > 2.4x ATR from EMA21; avoiding late chase entry."],
        )

    if direction != "WAIT":
        aligned = bias_15m == direction and bias_5m == direction
        state = "SIGNAL ACTIVE" if (active_score >= 76 and aligned) else "ENTRY READY"
        return EntryAssessment(state, False, [f"All entry conditions validated ({state})."])

    if active_score >= min_score - 6:
        return EntryAssessment("WAITING CONFIRMATION", False, ["Watchlist candidate awaiting multi-factor confirmation."])
    if active_score >= 52:
        return EntryAssessment("WATCHLIST", False, ["Developing setup on watchlist."])
    return EntryAssessment("SCANNING", False, ["Scanning market for confluence."])
