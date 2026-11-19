from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np

from app.engines.entry_engine import evaluate_entry_state
from app.engines.exit_engine import ExitPlan, build_exit_plan
from app.engines.momentum_engine import MomentumReport, analyze_momentum
from app.engines.volume_analyzer import VolumeReport, analyze_volume
from app.exchange.market_data import Kline, OrderBookSnapshot
from app.utils.indicators import atr, bollinger_bands, ema, macd, obv, roc, rsi, stoch_rsi


@dataclass
class TimeframeBias:
    timeframe: str
    direction: str
    ema_alignment: str
    rsi: float
    macd_hist: float


@dataclass
class SignalReport:
    symbol: str
    market_mode: str
    timestamp_ms: int
    price: float
    direction: str  # LONG | SHORT | WAIT
    long_score: int
    short_score: int
    active_score: int
    entry_state: str
    entry: float
    stop_loss: float
    take_profit_1: float
    take_profit_2: float
    take_profit_3: float
    risk_reward: float
    reasons: list[str]
    warnings: list[str]
    invalidation: str
    breakdown: dict[str, int]
    timeframe_biases: list[TimeframeBias]
    momentum: MomentumReport
    volume: VolumeReport
    exit_plan: ExitPlan
    support: float
    resistance: float
    structure_pattern: str
    late_entry_blocked: bool
    data_stale: bool


def _clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> int:
    return int(round(max(lo, min(hi, v))))


def _detect_structure(klines: list[Kline], pivot: int = 3) -> tuple[str, str, float, float]:
    highs = [k.high for k in klines]
    lows = [k.low for k in klines]
    swing_h: list[float] = []
    swing_l: list[float] = []
    for i in range(pivot, len(klines) - pivot):
        if all(highs[i] > highs[j] for j in range(i - pivot, i + pivot + 1) if j != i):
            swing_h.append(highs[i])
        if all(lows[i] < lows[j] for j in range(i - pivot, i + pivot + 1) if j != i):
            swing_l.append(lows[i])

    pattern = "RANGING"
    if len(swing_h) >= 2 and len(swing_l) >= 2:
        if swing_h[-1] > swing_h[-2] and swing_l[-1] > swing_l[-2]:
            pattern = "HH/HL"
        elif swing_h[-1] < swing_h[-2] and swing_l[-1] < swing_l[-2]:
            pattern = "LH/LL"

    support = swing_l[-1] if swing_l else min(lows[-25:])
    resistance = swing_h[-1] if swing_h else max(highs[-25:])
    last_c = klines[-1].close
    bos = "BULLISH" if last_c > resistance else ("BEARISH" if last_c < support else "NONE")
    return pattern, bos, support, resistance


def analyze_timeframe_bias(tf: str, klines: list[Kline]) -> TimeframeBias:
    closed = klines[:-1] if len(klines) > 2 else klines
    closes = np.array([k.close for k in closed], dtype=float)
    e9 = ema(closes, 9)[-1]
    e21 = ema(closes, 21)[-1]
    e50 = ema(closes, 50)[-1]
    r_val = rsi(closes, 14)[-1]
    _, _, mh = macd(closes)
    mh_val = float(mh[-1]) if not np.isnan(mh[-1]) else 0.0
    r_num = float(r_val) if not np.isnan(r_val) else 50.0

    if not np.isnan(e9) and not np.isnan(e21) and not np.isnan(e50):
        if e9 > e21 > e50:
            align = "BULLISH"
        elif e9 < e21 < e50:
            align = "BEARISH"
        else:
            align = "MIXED"
    else:
        align = "MIXED"

    direction = "WAIT"
    if align == "BULLISH" and r_num > 50 and mh_val >= 0:
        direction = "LONG"
    elif align == "BEARISH" and r_num < 50 and mh_val <= 0:
        direction = "SHORT"
    elif not np.isnan(e9) and not np.isnan(e21):
        if e9 > e21 and r_num > 54 and mh_val > 0:
            direction = "LONG"
        elif e9 < e21 and r_num < 46 and mh_val < 0:
            direction = "SHORT"

    return TimeframeBias(tf, direction, align, round(r_num, 2), round(mh_val, 6))


def generate_signal_report(
    symbol: str,
    market_mode: str,
    primary_klines: list[Kline],
    tf_klines: dict[str, list[Kline]],
    order_book: OrderBookSnapshot | None,
    live_price: float,
    last_updated_sec: float,
    weights: dict[str, int] | None = None,
    aggressiveness: str = "BALANCED",
    min_risk_reward: float = 1.8,
    max_spread_pct: float = 0.15,
    max_stale_sec: float = 45.0,
) -> SignalReport:
    now_sec = time.time()
    w = weights or {"trend": 25, "momentum": 20, "volume": 20, "structure": 15, "order_flow": 10, "volatility": 10}
    closed = primary_klines[:-1] if len(primary_klines) > 30 else primary_klines
    data_stale = len(closed) < 60 or (now_sec - last_updated_sec) > max_stale_sec or live_price <= 0

    closes = np.array([k.close for k in closed], dtype=float)
    highs = np.array([k.high for k in closed], dtype=float)
    lows = np.array([k.low for k in closed], dtype=float)
    ref_price = live_price if live_price > 0 else float(closes[-1])

    e9 = float(ema(closes, 9)[-1]) if len(closes) >= 9 else ref_price
    e21 = float(ema(closes, 21)[-1]) if len(closes) >= 21 else ref_price
    e50 = float(ema(closes, 50)[-1]) if len(closes) >= 50 else ref_price
    e200_arr = ema(closes, 200)
    e200 = float(e200_arr[-1]) if not np.isnan(e200_arr[-1]) else e50

    atr_arr = atr(highs, lows, closes, 14)
    cur_atr = float(atr_arr[-1]) if not np.isnan(atr_arr[-1]) else ref_price * 0.01
    bb_u, bb_m, bb_l, bb_bw = bollinger_bands(closes, 20, 2.0)
    cur_bw = float(bb_bw[-1]) if not np.isnan(bb_bw[-1]) else 2.0
    prev_bw = float(bb_bw[-6]) if len(bb_bw) >= 6 and not np.isnan(bb_bw[-6]) else cur_bw

    vol_rep = analyze_volume(closed)
    mom_rep = analyze_momentum(closed, vol_rep.rvol20)
    pattern, bos, support, resistance = _detect_structure(closed)

    tf_order = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"]
    tf_biases = [analyze_timeframe_bias(tf, tf_klines[tf]) for tf in tf_order if len(tf_klines.get(tf, [])) >= 35]
    b4h = next((b for b in tf_biases if b.timeframe == "4h"), None)
    b1h = next((b for b in tf_biases if b.timeframe == "1h"), None)
    b15m = next((b for b in tf_biases if b.timeframe == "15m"), None)
    b5m = next((b for b in tf_biases if b.timeframe == "5m"), None)

    # 1. Trend
    t_long, t_short = 0.0, 0.0
    if e9 > e21:
        t_long += 25
    elif e9 < e21:
        t_short += 25
    if e21 > e50:
        t_long += 25
    elif e21 < e50:
        t_short += 25
    if ref_price > e200:
        t_long += 20
    elif ref_price < e200:
        t_short += 20
    if b4h and b4h.direction == "LONG":
        t_long += 15
    elif b4h and b4h.direction == "SHORT":
        t_short += 15
    if b1h and b1h.direction == "LONG":
        t_long += 15
    elif b1h and b1h.direction == "SHORT":
        t_short += 15

    # 2. Momentum
    m_long, m_short = 0.0, 0.0
    if 52 <= mom_rep.rsi14 <= 72:
        m_long += 35
    elif mom_rep.rsi14 > 72:
        m_long += 12
    if 28 <= mom_rep.rsi14 <= 48:
        m_short += 35
    elif mom_rep.rsi14 < 28:
        m_short += 12
    if mom_rep.macd_line > mom_rep.macd_signal and mom_rep.macd_hist > 0:
        m_long += 30
    elif mom_rep.macd_line < mom_rep.macd_signal and mom_rep.macd_hist < 0:
        m_short += 30
    if mom_rep.stoch_rsi_k > mom_rep.stoch_rsi_d and mom_rep.stoch_rsi_k < 80:
        m_long += 15
    if mom_rep.stoch_rsi_k < mom_rep.stoch_rsi_d and mom_rep.stoch_rsi_k > 20:
        m_short += 15
    if mom_rep.roc10 > 0.25:
        m_long += 10
    if mom_rep.roc10 < -0.25:
        m_short += 10
    if mom_rep.rsi_divergence == "BULLISH" or mom_rep.macd_divergence == "BULLISH":
        m_long += 15
    if mom_rep.rsi_divergence == "BEARISH" or mom_rep.macd_divergence == "BEARISH":
        m_short += 15

    # 3. Volume
    v_long, v_short = 0.0, 0.0
    if vol_rep.rvol20 >= 1.2:
        if vol_rep.buy_sell_ratio >= 1.1:
            v_long += 35
        if vol_rep.buy_sell_ratio <= 0.9:
            v_short += 35
    if vol_rep.is_spike:
        if closed[-1].close > closed[-1].open:
            v_long += 25
        elif closed[-1].close < closed[-1].open:
            v_short += 25
    if vol_rep.volume_delta > 0:
        v_long += 20
    elif vol_rep.volume_delta < 0:
        v_short += 20
    if vol_rep.obv_trend == "RISING":
        v_long += 20
    elif vol_rep.obv_trend == "FALLING":
        v_short += 20

    # 4. Structure
    s_long, s_short = 20.0, 20.0
    if pattern == "HH/HL":
        s_long += 40
        s_short -= 10
    elif pattern == "LH/LL":
        s_short += 40
        s_long -= 10
    if bos == "BULLISH":
        s_long += 30
    elif bos == "BEARISH":
        s_short += 30

    # 5. Order Flow
    of_long, of_short = 35.0, 35.0
    if order_book:
        imb = order_book.imbalance_ratio
        if imb > 0.12:
            of_long += min(45.0, imb * 90.0)
        elif imb < -0.12:
            of_short += min(45.0, abs(imb) * 90.0)
    if vol_rep.buy_sell_ratio > 1.25:
        of_long += 20
    if vol_rep.buy_sell_ratio < 0.8:
        of_short += 20

    # 6. Volatility
    vol_long, vol_short = 45.0, 45.0
    atr_pct = (cur_atr / ref_price) * 100.0 if ref_price > 0 else 0.0
    if 0.25 <= atr_pct <= 4.5:
        vol_long += 25
        vol_short += 25
    if cur_bw > prev_bw * 1.08 and not np.isnan(bb_m[-1]):
        if ref_price > float(bb_m[-1]):
            vol_long += 25
        else:
            vol_short += 25

    breakdown = {
        "trend_long": _clamp(t_long), "trend_short": _clamp(t_short),
        "momentum_long": _clamp(m_long), "momentum_short": _clamp(m_short),
        "volume_long": _clamp(v_long), "volume_short": _clamp(v_short),
        "structure_long": _clamp(s_long), "structure_short": _clamp(s_short),
        "order_flow_long": _clamp(of_long), "order_flow_short": _clamp(of_short),
        "volatility_long": _clamp(vol_long), "volatility_short": _clamp(vol_short),
    }

    w_sum = sum(w.values()) or 100
    long_score = _clamp(
        (breakdown["trend_long"] * w["trend"]
         + breakdown["momentum_long"] * w["momentum"]
         + breakdown["volume_long"] * w["volume"]
         + breakdown["structure_long"] * w["structure"]
         + breakdown["order_flow_long"] * w["order_flow"]
         + breakdown["volatility_long"] * w["volatility"]) / w_sum
    )
    short_score = _clamp(
        (breakdown["trend_short"] * w["trend"]
         + breakdown["momentum_short"] * w["momentum"]
         + breakdown["volume_short"] * w["volume"]
         + breakdown["structure_short"] * w["structure"]
         + breakdown["order_flow_short"] * w["order_flow"]
         + breakdown["volatility_short"] * w["volatility"]) / w_sum
    )

    thresholds = {"CONSERVATIVE": (72, 18), "BALANCED": (65, 14), "AGGRESSIVE": (58, 10)}
    min_sc, min_gap = thresholds.get(aggressiveness, (65, 14))

    direction = "WAIT"
    warnings: list[str] = []
    if data_stale:
        warnings.append("Market data stale or insufficient closed candles; signals blocked.")
    else:
        if long_score >= min_sc and (long_score - short_score) >= min_gap:
            direction = "LONG"
        elif short_score >= min_sc and (short_score - long_score) >= min_gap:
            direction = "SHORT"

    if direction == "LONG" and b4h and b1h and b4h.direction == "SHORT" and b1h.direction == "SHORT":
        if aggressiveness != "AGGRESSIVE":
            direction = "WAIT"
            warnings.append("4h and 1h remain bearish; counter-trend LONG vetoed.")
    if direction == "SHORT" and b4h and b1h and b4h.direction == "LONG" and b1h.direction == "LONG":
        if aggressiveness != "AGGRESSIVE":
            direction = "WAIT"
            warnings.append("4h and 1h remain bullish; counter-trend SHORT vetoed.")

    if order_book and order_book.spread_pct > max_spread_pct:
        direction = "WAIT"
        warnings.append(f"Spread {order_book.spread_pct:.3f}% exceeds limit {max_spread_pct:.3f}%.")

    active_score = long_score if direction == "LONG" else (short_score if direction == "SHORT" else max(long_score, short_score))
    entry_assess = evaluate_entry_state(
        direction=direction,
        active_score=active_score,
        min_score=min_sc,
        price=ref_price,
        ema21=e21,
        atr_val=cur_atr,
        bias_15m=b15m.direction if b15m else "WAIT",
        bias_5m=b5m.direction if b5m else "WAIT",
        data_stale=data_stale,
    )
    if entry_assess.late_entry_blocked:
        direction = "WAIT"
        warnings.extend(entry_assess.notes)

    exit_plan = build_exit_plan(direction, ref_price, cur_atr, support, resistance, aggressiveness)
    if direction != "WAIT" and exit_plan.risk_reward < min_risk_reward:
        warnings.append(f"Risk/Reward {exit_plan.risk_reward:.2f} below min {min_risk_reward:.2f}.")
        direction = "WAIT"

    reasons: list[str] = []
    if direction == "LONG":
        if e9 > e21:
            reasons.append("EMA 9 is above EMA 21.")
        if mom_rep.rsi14 > 50:
            reasons.append(f"RSI(14) at {mom_rep.rsi14} confirms bullish momentum.")
        if vol_rep.rvol20 >= 1.15:
            reasons.append(f"Relative volume {vol_rep.rvol20}x exceeds 20-bar average.")
        if vol_rep.buy_sell_ratio > 1.05:
            reasons.append(f"Buyers dominate aggressive volume ({vol_rep.buy_sell_ratio}x).")
        if bos == "BULLISH" or pattern == "HH/HL":
            reasons.append("Bullish market structure / break of local resistance.")
    elif direction == "SHORT":
        if e9 < e21:
            reasons.append("EMA 9 is below EMA 21.")
        if mom_rep.rsi14 < 50:
            reasons.append(f"RSI(14) at {mom_rep.rsi14} confirms bearish momentum.")
        if vol_rep.rvol20 >= 1.15:
            reasons.append(f"Volume expansion ({vol_rep.rvol20}x) supports downside move.")
        if vol_rep.buy_sell_ratio < 0.95:
            reasons.append(f"Sellers dominate market flow ({vol_rep.buy_sell_ratio}x).")
        if bos == "BEARISH" or pattern == "LH/LL":
            reasons.append("Bearish market structure / break of local support.")
    else:
        reasons.append("Multi-factor confluence below threshold; system advises WAIT.")
        if warnings:
            reasons.append(warnings[0])

    return SignalReport(
        symbol=symbol,
        market_mode=market_mode,
        timestamp_ms=int(now_sec * 1000),
        price=ref_price,
        direction=direction,
        long_score=long_score,
        short_score=short_score,
        active_score=active_score,
        entry_state=entry_assess.state,
        entry=ref_price,
        stop_loss=exit_plan.stop_loss,
        take_profit_1=exit_plan.take_profit_1,
        take_profit_2=exit_plan.take_profit_2,
        take_profit_3=exit_plan.take_profit_3,
        risk_reward=exit_plan.risk_reward,
        reasons=reasons,
        warnings=warnings,
        invalidation=exit_plan.invalidation_condition,
        breakdown=breakdown,
        timeframe_biases=tf_biases,
        momentum=mom_rep,
        volume=vol_rep,
        exit_plan=exit_plan,
        support=support,
        resistance=resistance,
        structure_pattern=pattern,
        late_entry_blocked=entry_assess.late_entry_blocked,
        data_stale=data_stale,
    )
