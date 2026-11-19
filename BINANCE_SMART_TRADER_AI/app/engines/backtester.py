from __future__ import annotations

from dataclasses import dataclass

from app.engines.signal_engine import generate_signal_report
from app.exchange.market_data import Kline


@dataclass
class BacktestTrade:
    entry_time: int
    exit_time: int
    direction: str
    entry_price: float
    exit_price: float
    pnl_usd: float
    r_multiple: float
    exit_reason: str
    segment: str


@dataclass
class BacktestMetrics:
    trades: int
    wins: int
    losses: int
    win_rate_pct: float
    net_pnl_usd: float
    profit_factor: float
    max_drawdown_pct: float
    average_r: float


@dataclass
class BacktestResult:
    symbol: str
    timeframe: str
    candles_analyzed: int
    in_sample: BacktestMetrics
    out_of_sample: BacktestMetrics
    overall: BacktestMetrics
    equity_curve: list[tuple[int, float]]
    trades: list[BacktestTrade]


def _metrics(trades: list[BacktestTrade], start_eq: float) -> BacktestMetrics:
    if not trades:
        return BacktestMetrics(0, 0, 0, 0.0, 0.0, 0.0, 0.0, 0.0)
    wins = sum(1 for t in trades if t.pnl_usd > 0)
    losses = len(trades) - wins
    g_win = sum(t.pnl_usd for t in trades if t.pnl_usd > 0)
    g_loss = abs(sum(t.pnl_usd for t in trades if t.pnl_usd <= 0))
    eq = start_eq
    peak = start_eq
    max_dd = 0.0
    for t in trades:
        eq += t.pnl_usd
        peak = max(peak, eq)
        dd = ((peak - eq) / peak) * 100.0 if peak > 0 else 0.0
        max_dd = max(max_dd, dd)
    pf = g_win / g_loss if g_loss > 0 else (99.0 if g_win > 0 else 0.0)
    return BacktestMetrics(
        trades=len(trades),
        wins=wins,
        losses=losses,
        win_rate_pct=round((wins / len(trades)) * 100.0, 2),
        net_pnl_usd=round(eq - start_eq, 2),
        profit_factor=round(pf, 2),
        max_drawdown_pct=round(max_dd, 2),
        average_r=round(sum(t.r_multiple for t in trades) / len(trades), 2),
    )


def run_walk_forward_backtest(
    symbol: str,
    timeframe: str,
    market_mode: str,
    klines: list[Kline],
    initial_balance: float = 10000.0,
    risk_per_trade_pct: float = 1.0,
    commission_pct: float = 0.05,
    slippage_pct: float = 0.05,
    min_score: int = 65,
    min_rr: float = 1.8,
    aggressiveness: str = "BALANCED",
) -> BacktestResult:
    warmup = 70
    split_idx = int(warmup + (len(klines) - warmup) * 0.6)
    equity = initial_balance
    eq_curve: list[tuple[int, float]] = []
    trades: list[BacktestTrade] = []
    active = None
    slip = slippage_pct / 100.0
    fee = commission_pct / 100.0

    for i in range(warmup, len(klines) - 1):
        bar = klines[i]
        next_bar = klines[i + 1]
        segment = "IN_SAMPLE" if i < split_idx else "OUT_OF_SAMPLE"

        if active is not None:
            exit_px = None
            reason = None
            if active["dir"] == "LONG":
                if bar.low <= active["sl"]:
                    exit_px = active["sl"] * (1.0 - slip)
                    reason = "Stop Loss Hit"
                elif bar.high >= active["tp"]:
                    exit_px = active["tp"] * (1.0 - slip)
                    reason = "Take Profit 2 Hit"
            else:
                if bar.high >= active["sl"]:
                    exit_px = active["sl"] * (1.0 + slip)
                    reason = "Stop Loss Hit"
                elif bar.low <= active["tp"]:
                    exit_px = active["tp"] * (1.0 + slip)
                    reason = "Take Profit 2 Hit"

            if exit_px is not None:
                raw_pnl = (
                    (exit_px - active["entry"]) * active["qty"]
                    if active["dir"] == "LONG"
                    else (active["entry"] - exit_px) * active["qty"]
                )
                exit_fee = exit_px * active["qty"] * fee
                net_pnl = raw_pnl - active["entry_fee"] - exit_fee
                risk_usd = abs(active["entry"] - active["sl"]) * active["qty"]
                r_mult = net_pnl / risk_usd if risk_usd > 0 else 0.0
                equity += net_pnl
                trades.append(
                    BacktestTrade(
                        entry_time=active["entry_time"],
                        exit_time=bar.close_time,
                        direction=active["dir"],
                        entry_price=active["entry"],
                        exit_price=exit_px,
                        pnl_usd=round(net_pnl, 2),
                        r_multiple=round(r_mult, 2),
                        exit_reason=str(reason),
                        segment=active["segment"],
                    )
                )
                active = None

        if active is None and equity > 10.0:
            causal = klines[max(0, i - 200) : i + 1] + [bar]
            rep = generate_signal_report(
                symbol=symbol,
                market_mode=market_mode,
                primary_klines=causal,
                tf_klines={timeframe: causal},
                order_book=None,
                live_price=bar.close,
                last_updated_sec=bar.close_time / 1000.0,
                aggressiveness=aggressiveness,
                min_risk_reward=min_rr,
                max_stale_sec=1e12,
            )
            if rep.direction != "WAIT" and rep.active_score >= min_score and rep.risk_reward >= min_rr:
                fill = next_bar.open * (1.0 + slip) if rep.direction == "LONG" else next_bar.open * (1.0 - slip)
                sl_dist = abs(rep.entry - rep.stop_loss)
                tp_dist = abs(rep.take_profit_2 - rep.entry)
                sl = fill - sl_dist if rep.direction == "LONG" else fill + sl_dist
                tp = fill + tp_dist if rep.direction == "LONG" else fill - tp_dist
                qty = (equity * (risk_per_trade_pct / 100.0)) / sl_dist if sl_dist > 0 else 0.0
                if qty > 0:
                    active = {
                        "dir": rep.direction,
                        "entry": fill,
                        "entry_time": next_bar.open_time,
                        "sl": sl,
                        "tp": tp,
                        "qty": qty,
                        "entry_fee": fill * qty * fee,
                        "segment": segment,
                    }

        eq_curve.append((bar.close_time, round(equity, 2)))

    in_trades = [t for t in trades if t.segment == "IN_SAMPLE"]
    oos_trades = [t for t in trades if t.segment == "OUT_OF_SAMPLE"]
    in_m = _metrics(in_trades, initial_balance)
    oos_m = _metrics(oos_trades, initial_balance + in_m.net_pnl_usd)
    return BacktestResult(
        symbol=symbol,
        timeframe=timeframe,
        candles_analyzed=len(klines),
        in_sample=in_m,
        out_of_sample=oos_m,
        overall=_metrics(trades, initial_balance),
        equity_curve=eq_curve,
        trades=trades,
    )
