from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.exchange.market_data import Kline
from app.utils.indicators import detect_divergence, macd, roc, rsi, stoch_rsi


@dataclass
class MomentumReport:
    strength: str  # WEAK | MODERATE | STRONG | EXTREME
    rsi14: float
    macd_line: float
    macd_signal: float
    macd_hist: float
    stoch_rsi_k: float
    stoch_rsi_d: float
    roc10: float
    rsi_divergence: str
    macd_divergence: str
    exhaustion_warning: str | None


def analyze_momentum(closed_klines: list[Kline], rvol20: float = 1.0) -> MomentumReport:
    closes = np.array([k.close for k in closed_klines], dtype=float)
    rsi_arr = rsi(closes, 14)
    macd_l, macd_s, macd_h = macd(closes, 12, 26, 9)
    sk, sd = stoch_rsi(closes)
    roc_arr = roc(closes, 10)

    r_val = float(rsi_arr[-1]) if not np.isnan(rsi_arr[-1]) else 50.0
    ml_val = float(macd_l[-1]) if not np.isnan(macd_l[-1]) else 0.0
    ms_val = float(macd_s[-1]) if not np.isnan(macd_s[-1]) else 0.0
    mh_val = float(macd_h[-1]) if not np.isnan(macd_h[-1]) else 0.0
    roc_val = float(roc_arr[-1]) if not np.isnan(roc_arr[-1]) else 0.0

    rsi_div = detect_divergence(closes, rsi_arr, 18)
    macd_div = detect_divergence(closes, macd_h, 18)

    abs_roc = abs(roc_val)
    if abs_roc >= 2.2 or rvol20 >= 2.3:
        strength = "EXTREME"
    elif abs_roc >= 1.1 or abs(r_val - 50.0) >= 16.0:
        strength = "STRONG"
    elif abs_roc >= 0.45 or abs(r_val - 50.0) >= 8.0:
        strength = "MODERATE"
    else:
        strength = "WEAK"

    exhaustion_warning = None
    if r_val > 76.0 or (rsi_div == "BEARISH" and r_val > 62.0):
        exhaustion_warning = "Bullish momentum exhaustion risk (overbought RSI or bearish divergence)."
    elif r_val < 24.0 or (rsi_div == "BULLISH" and r_val < 38.0):
        exhaustion_warning = "Bearish momentum exhaustion risk (oversold RSI or bullish divergence)."

    return MomentumReport(
        strength=strength,
        rsi14=round(r_val, 2),
        macd_line=round(ml_val, 6),
        macd_signal=round(ms_val, 6),
        macd_hist=round(mh_val, 6),
        stoch_rsi_k=round(sk, 1),
        stoch_rsi_d=round(sd, 1),
        roc10=round(roc_val, 2),
        rsi_divergence=rsi_div,
        macd_divergence=macd_div,
        exhaustion_warning=exhaustion_warning,
    )
