from __future__ import annotations

from dataclasses import dataclass


@dataclass
class RiskEvaluation:
    approved: bool
    rejection_reasons: list[str]
    risk_amount_usd: float
    stop_distance: float
    stop_distance_pct: float
    position_size_qty: float
    notional_value_usd: float
    required_margin_usd: float
    entry_fee_usd: float
    exit_fee_usd: float
    slippage_usd: float
    funding_usd: float
    total_cost_usd: float
    net_profit_tp1_usd: float
    net_profit_tp2_usd: float
    net_max_loss_usd: float
    effective_rr: float


def evaluate_risk(
    direction: str,
    entry: float,
    stop_loss: float,
    take_profit_1: float,
    take_profit_2: float,
    spread_pct: float,
    open_positions_count: int,
    daily_loss_usd: float,
    risk_cfg: dict,
) -> RiskEvaluation:
    reasons: list[str] = []
    if direction == "WAIT":
        reasons.append("Direction is WAIT; no trade setup ready.")

    stop_dist = abs(entry - stop_loss)
    stop_dist_pct = (stop_dist / entry) * 100.0 if entry > 0 else 0.0
    if entry <= 0 or stop_dist <= 0:
        reasons.append("Invalid entry price or stop loss distance.")
    if direction == "LONG" and stop_loss >= entry:
        reasons.append("LONG stop loss must be below entry.")
    if direction == "SHORT" and stop_loss <= entry:
        reasons.append("SHORT stop loss must be above entry.")

    balance = float(risk_cfg.get("virtual_balance", 10000.0))
    risk_pct = float(risk_cfg.get("risk_per_trade_pct", 1.0))
    leverage = float(risk_cfg.get("leverage", 5))
    fee_pct = float(risk_cfg.get("taker_fee_pct", 0.05))
    slip_pct = float(risk_cfg.get("max_slippage_pct", 0.08))
    fund_pct = float(risk_cfg.get("funding_rate_pct_8h", 0.01))
    min_rr = float(risk_cfg.get("min_risk_reward", 1.8))
    max_spread = float(risk_cfg.get("max_spread_pct", 0.15))
    max_open = int(risk_cfg.get("max_open_positions", 4))
    max_daily_pct = float(risk_cfg.get("max_daily_loss_pct", 4.0))

    risk_amt = balance * (risk_pct / 100.0)
    qty = risk_amt / stop_dist if stop_dist > 0 else 0.0
    notional = qty * entry
    margin = notional / leverage if leverage > 0 else notional

    entry_fee = notional * (fee_pct / 100.0)
    exit_fee = notional * (fee_pct / 100.0)
    slip_usd = notional * (slip_pct / 100.0)
    fund_usd = notional * (abs(fund_pct) / 100.0)
    total_cost = entry_fee + exit_fee + slip_usd + fund_usd

    net_tp1 = qty * abs(take_profit_1 - entry) - total_cost
    net_tp2 = qty * abs(take_profit_2 - entry) - total_cost
    net_loss = risk_amt + total_cost
    eff_rr = max(0.0, net_tp2 / net_loss) if net_loss > 0 else 0.0

    if eff_rr < min_rr:
        reasons.append(f"Net R:R ({eff_rr:.2f}) is below minimum {min_rr:.2f}.")
    if spread_pct > max_spread:
        reasons.append(f"Spread ({spread_pct:.3f}%) exceeds max {max_spread:.3f}%.")
    if open_positions_count >= max_open:
        reasons.append(f"Max open positions ({max_open}) reached.")
    if abs(min(0.0, daily_loss_usd)) >= balance * (max_daily_pct / 100.0):
        reasons.append("Maximum daily loss limit reached.")
    if margin > balance * 0.95:
        reasons.append("Required margin exceeds 95% of virtual balance.")

    return RiskEvaluation(
        approved=len(reasons) == 0,
        rejection_reasons=reasons,
        risk_amount_usd=round(risk_amt, 2),
        stop_distance=stop_dist,
        stop_distance_pct=round(stop_dist_pct, 3),
        position_size_qty=qty,
        notional_value_usd=round(notional, 2),
        required_margin_usd=round(margin, 2),
        entry_fee_usd=round(entry_fee, 2),
        exit_fee_usd=round(exit_fee, 2),
        slippage_usd=round(slip_usd, 2),
        funding_usd=round(fund_usd, 2),
        total_cost_usd=round(total_cost, 2),
        net_profit_tp1_usd=round(net_tp1, 2),
        net_profit_tp2_usd=round(net_tp2, 2),
        net_max_loss_usd=round(net_loss, 2),
        effective_rr=round(eff_rr, 2),
    )
