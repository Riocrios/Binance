from __future__ import annotations

import numpy as np


def sma(values: np.ndarray, period: int) -> np.ndarray:
    out = np.full(len(values), np.nan, dtype=float)
    if period <= 0 or len(values) < period:
        return out
    csum = np.cumsum(np.insert(values, 0, 0.0))
    out[period - 1 :] = (csum[period:] - csum[:-period]) / period
    return out


def ema(values: np.ndarray, period: int) -> np.ndarray:
    out = np.full(len(values), np.nan, dtype=float)
    if period <= 0 or len(values) < period:
        return out
    out[period - 1] = float(np.mean(values[:period]))
    k = 2.0 / (period + 1.0)
    for i in range(period, len(values)):
        out[i] = values[i] * k + out[i - 1] * (1.0 - k)
    return out


def rsi(closes: np.ndarray, period: int = 14) -> np.ndarray:
    out = np.full(len(closes), np.nan, dtype=float)
    if len(closes) <= period:
        return out
    deltas = np.diff(closes)
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)
    avg_gain = float(np.mean(gains[:period]))
    avg_loss = float(np.mean(losses[:period]))
    out[period] = 100.0 if avg_loss == 0 else 100.0 - (100.0 / (1.0 + avg_gain / avg_loss))
    for i in range(period + 1, len(closes)):
        avg_gain = (avg_gain * (period - 1) + gains[i - 1]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i - 1]) / period
        if avg_loss == 0:
            out[i] = 100.0
        else:
            rs = avg_gain / avg_loss
            out[i] = 100.0 - (100.0 / (1.0 + rs))
    return out


def macd(
    closes: np.ndarray, fast: int = 12, slow: int = 26, signal: int = 9
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    ema_fast = ema(closes, fast)
    ema_slow = ema(closes, slow)
    macd_line = ema_fast - ema_slow
    sig_line = np.full(len(closes), np.nan, dtype=float)
    valid_mask = ~np.isnan(macd_line)
    if np.sum(valid_mask) >= signal:
        valid_vals = macd_line[valid_mask]
        valid_sig = ema(valid_vals, signal)
        sig_line[valid_mask] = valid_sig
    hist = macd_line - sig_line
    return macd_line, sig_line, hist


def stoch_rsi(
    closes: np.ndarray, rsi_period: int = 14, stoch_period: int = 14, k_smooth: int = 3, d_smooth: int = 3
) -> tuple[float, float]:
    r = rsi(closes, rsi_period)
    valid = r[~np.isnan(r)]
    if len(valid) < stoch_period + k_smooth + d_smooth:
        return 50.0, 50.0
    raw = []
    for i in range(stoch_period - 1, len(valid)):
        win = valid[i - stoch_period + 1 : i + 1]
        lo, hi = float(np.min(win)), float(np.max(win))
        raw.append(50.0 if hi == lo else ((valid[i] - lo) / (hi - lo)) * 100.0)
    k_arr = sma(np.array(raw, dtype=float), k_smooth)
    k_valid = k_arr[~np.isnan(k_arr)]
    d_arr = sma(k_valid, d_smooth)
    d_valid = d_arr[~np.isnan(d_arr)]
    return (
        float(k_valid[-1]) if len(k_valid) else 50.0,
        float(d_valid[-1]) if len(d_valid) else 50.0,
    )


def roc(closes: np.ndarray, period: int = 10) -> np.ndarray:
    out = np.full(len(closes), np.nan, dtype=float)
    if len(closes) <= period:
        return out
    prev = closes[:-period]
    curr = closes[period:]
    out[period:] = np.where(prev != 0, ((curr - prev) / prev) * 100.0, 0.0)
    return out


def atr(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14) -> np.ndarray:
    n = len(closes)
    out = np.full(n, np.nan, dtype=float)
    if n < period + 1:
        return out
    tr = np.zeros(n, dtype=float)
    tr[0] = highs[0] - lows[0]
    for i in range(1, n):
        tr[i] = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
    prev_atr = float(np.mean(tr[1 : period + 1]))
    out[period] = prev_atr
    for i in range(period + 1, n):
        prev_atr = (prev_atr * (period - 1) + tr[i]) / period
        out[i] = prev_atr
    return out


def bollinger_bands(
    closes: np.ndarray, period: int = 20, mult: float = 2.0
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    mid = sma(closes, period)
    upper = np.full(len(closes), np.nan, dtype=float)
    lower = np.full(len(closes), np.nan, dtype=float)
    bw = np.full(len(closes), np.nan, dtype=float)
    for i in range(period - 1, len(closes)):
        std = float(np.std(closes[i - period + 1 : i + 1]))
        upper[i] = mid[i] + mult * std
        lower[i] = mid[i] - mult * std
        bw[i] = ((upper[i] - lower[i]) / mid[i]) * 100.0 if mid[i] else 0.0
    return upper, mid, lower, bw


def obv(closes: np.ndarray, volumes: np.ndarray) -> np.ndarray:
    out = np.zeros(len(closes), dtype=float)
    for i in range(1, len(closes)):
        if closes[i] > closes[i - 1]:
            out[i] = out[i - 1] + volumes[i]
        elif closes[i] < closes[i - 1]:
            out[i] = out[i - 1] - volumes[i]
        else:
            out[i] = out[i - 1]
    return out


def detect_divergence(closes: np.ndarray, ind: np.ndarray, lookback: int = 18) -> str:
    if len(closes) < lookback + 5:
        return "NONE"
    c_win = closes[-lookback:]
    i_win = ind[-lookback:]
    if np.any(np.isnan(i_win)):
        return "NONE"
    mid = lookback // 2
    if np.min(c_win[mid:]) < np.min(c_win[:mid]) * 0.997 and np.min(i_win[mid:]) > np.min(i_win[:mid]) * 1.03:
        return "BULLISH"
    if np.max(c_win[mid:]) > np.max(c_win[:mid]) * 1.003 and np.max(i_win[mid:]) < np.max(i_win[:mid]) * 0.97:
        return "BEARISH"
    return "NONE"
