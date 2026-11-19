from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = BASE_DIR / "config.json"
DATA_DIR = BASE_DIR / "data"
LOGS_DIR = BASE_DIR / "logs"
CACHE_DIR = BASE_DIR / "cache"
ASSETS_DIR = BASE_DIR / "assets"

for _d in (DATA_DIR, LOGS_DIR, CACHE_DIR, ASSETS_DIR):
    _d.mkdir(parents=True, exist_ok=True)

DEFAULT_CONFIG: dict[str, Any] = {
    "app": {
        "name": "BINANCE SMART TRADER AI",
        "version": "1.0.0",
        "trading_mode": "ANALYSIS_ONLY",
        "auto_trading_enabled": False,
        "refresh_interval_sec": 8,
        "max_stale_data_sec": 45,
    },
    "market": {
        "default_mode": "FUTURES",
        "default_symbol": "BTCUSDT",
        "default_timeframe": "15m",
        "max_scanned_pairs": 35,
    },
    "scanner": {
        "min_volume_24h_usd": 25000000,
        "max_spread_pct": 0.15,
        "min_volatility_pct": 0.8,
        "exclude_stablecoins": True,
        "aggressiveness": "BALANCED",
    },
    "weights": {
        "trend": 25,
        "momentum": 20,
        "volume": 20,
        "structure": 15,
        "order_flow": 10,
        "volatility": 10,
    },
    "risk": {
        "virtual_balance": 10000.0,
        "risk_per_trade_pct": 1.0,
        "max_daily_loss_pct": 4.0,
        "max_open_positions": 4,
        "min_risk_reward": 1.8,
        "max_spread_pct": 0.15,
        "max_slippage_pct": 0.08,
        "leverage": 5,
        "taker_fee_pct": 0.05,
        "funding_rate_pct_8h": 0.01,
    },
    "backtest": {
        "default_limit": 300,
        "commission_pct": 0.05,
        "slippage_pct": 0.05,
        "min_score": 65,
    },
}


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = deepcopy(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(merged.get(k), dict):
            merged[k] = _deep_merge(merged[k], v)
        else:
            merged[k] = v
    return merged


def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        save_config(DEFAULT_CONFIG)
        return deepcopy(DEFAULT_CONFIG)
    try:
        with CONFIG_PATH.open("r", encoding="utf-8") as fh:
            raw = json.load(fh)
        if not isinstance(raw, dict):
            return deepcopy(DEFAULT_CONFIG)
        return _deep_merge(DEFAULT_CONFIG, raw)
    except Exception:
        return deepcopy(DEFAULT_CONFIG)


def save_config(cfg: dict[str, Any]) -> None:
    safe_cfg = deepcopy(cfg)
    # Never allow auto trading in v1
    safe_cfg.setdefault("app", {})["trading_mode"] = "ANALYSIS_ONLY"
    safe_cfg["app"]["auto_trading_enabled"] = False
    with CONFIG_PATH.open("w", encoding="utf-8") as fh:
        json.dump(safe_cfg, fh, indent=2, ensure_ascii=False)
