from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.exchange.market_data import Kline
from app.utils.indicators import obv


@dataclass
class VolumeReport:
    current_volume: float
    avg_volume_20: float
    avg_volume_50: float
    rvol20: float
    rvol50: float
    is_spike: bool
    buy_sell_ratio: float
    volume_delta: float
    obv_trend: str  # RISING | FALLING | FLAT
    regime: str  # ACCUMULATION | DISTRIBUTION | NEUTRAL


def analyze_volume(closed_klines: list[Kline]) -> VolumeReport:
    if len(closed_klines) < 22:
        return VolumeReport(0.0, 0.0, 0.0, 1.0, 1.0, False, 1.0, 0.0, "FLAT", "NEUTRAL")

    vols = np.array([k.volume for k in closed_klines], dtype=float)
    closes = np.array([k.close for k in closed_klines], dtype=float)
    latest_vol = float(vols[-1])
    hist = vols[:-1]
    avg20 = float(np.mean(hist[-20:])) if len(hist) >= 20 else float(np.mean(hist))
    avg50 = float(np.mean(hist[-50:])) if len(hist) >= 50 else float(np.mean(hist))

    rvol20 = latest_vol / avg20 if avg20 > 0 else 1.0
    rvol50 = latest_vol / avg50 if avg50 > 0 else 1.0
    is_spike = rvol20 >= 1.85 or rvol50 >= 2.0

    buy_sum = 0.0
    sell_sum = 0.0
    for k in closed_klines[-20:]:
        t_buy = (
            min(k.volume, k.taker_buy_base_vol)
            if k.taker_buy_base_vol > 0
            else (k.volume * 0.58 if k.close >= k.open else k.volume * 0.42)
        )
        t_sell = max(0.0, k.volume - t_buy)
        buy_sum += t_buy
        sell_sum += t_sell

    buy_sell_ratio = buy_sum / sell_sum if sell_sum > 0 else (2.0 if buy_sum > 0 else 1.0)
    vol_delta = buy_sum - sell_sum

    obv_arr = obv(closes, vols)
    obv_diff = float(obv_arr[-1] - obv_arr[-10]) if len(obv_arr) >= 10 else 0.0
    obv_trend = "RISING" if obv_diff > 0 else ("FALLING" if obv_diff < 0 else "FLAT")

    if buy_sell_ratio > 1.12 and obv_trend == "RISING":
        regime = "ACCUMULATION"
    elif buy_sell_ratio < 0.88 and obv_trend == "FALLING":
        regime = "DISTRIBUTION"
    else:
        regime = "NEUTRAL"

    return VolumeReport(
        current_volume=latest_vol,
        avg_volume_20=avg20,
        avg_volume_50=avg50,
        rvol20=round(rvol20, 2),
        rvol50=round(rvol50, 2),
        is_spike=is_spike,
        buy_sell_ratio=round(buy_sell_ratio, 2),
        volume_delta=round(vol_delta, 2),
        obv_trend=obv_trend,
        regime=regime,
    )
