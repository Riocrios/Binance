from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ExitPlan:
    stop_loss: float
    take_profit_1: float
    take_profit_2: float
    take_profit_3: float
    break_even_trigger: float
    trailing_stop_distance: float
    risk_reward: float
    partial_close_rules: list[str]
    full_exit_rules: list[str]
    invalidation_condition: str


def build_exit_plan(
    direction: str,
    entry: float,
    atr_val: float,
    support: float,
    resistance: float,
    aggressiveness: str = "BALANCED",
) -> ExitPlan:
    sl_mult = 1.6 if aggressiveness == "CONSERVATIVE" else 1.4
    raw_dist = max(atr_val * sl_mult, entry * 0.0035)

    if direction == "SHORT":
        stop_loss = entry + raw_dist
        if resistance > entry:
            struct_sl = resistance + atr_val * 0.35
            if atr_val * 0.8 <= (struct_sl - entry) <= raw_dist * 1.6:
                stop_loss = struct_sl
        risk_dist = max(abs(stop_loss - entry), entry * 0.002)
        tp1 = entry - risk_dist * 1.2
        tp2 = entry - risk_dist * 2.2
        tp3 = entry - risk_dist * 3.2
        be_trigger = entry - risk_dist * 1.0
        invalidation = f"Candle close above resistance/SL {stop_loss:.6g} invalidates SHORT thesis."
    else:
        stop_loss = entry - raw_dist
        if 0 < support < entry:
            struct_sl = support - atr_val * 0.35
            if atr_val * 0.8 <= (entry - struct_sl) <= raw_dist * 1.6:
                stop_loss = struct_sl
        risk_dist = max(abs(entry - stop_loss), entry * 0.002)
        tp1 = entry + risk_dist * 1.2
        tp2 = entry + risk_dist * 2.2
        tp3 = entry + risk_dist * 3.2
        be_trigger = entry + risk_dist * 1.0
        invalidation = f"Candle close below support/SL {stop_loss:.6g} invalidates LONG thesis."

    rr = round(abs(tp2 - entry) / risk_dist, 2)
    return ExitPlan(
        stop_loss=stop_loss,
        take_profit_1=tp1,
        take_profit_2=tp2,
        take_profit_3=tp3,
        break_even_trigger=be_trigger,
        trailing_stop_distance=atr_val * 1.2,
        risk_reward=rr,
        partial_close_rules=[
            f"Close 40% at TP1 ({tp1:.6g}) and move Stop Loss to Break Even ({entry:.6g}).",
            f"Close 40% at TP2 ({tp2:.6g}) and trail remaining 20% by {atr_val * 1.2:.6g} (1.2x ATR).",
        ],
        full_exit_rules=[
            f"Full exit at TP3 ({tp3:.6g}) or upon momentum exhaustion / trend reversal signal.",
            f"Hard Stop Loss at {stop_loss:.6g}; never move SL further away from entry.",
        ],
        invalidation_condition=invalidation,
    )
