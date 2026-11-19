from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Kline:
    open_time: int
    open: float
    high: float
    low: float
    close: float
    volume: float
    close_time: int
    quote_volume: float
    trades: int
    taker_buy_base_vol: float
    taker_buy_quote_vol: float


@dataclass
class TickerSnapshot:
    symbol: str
    last_price: float
    price_change_pct: float
    quote_volume: float
    high_price: float
    low_price: float
    bid_price: float
    ask_price: float
    spread_pct: float
    volatility_pct: float
    mark_price: float = 0.0
    funding_rate: float = 0.0
    open_interest_usd: float = 0.0
    updated_at: float = 0.0


@dataclass
class OrderBookSnapshot:
    best_bid: float
    best_ask: float
    spread_pct: float
    bid_depth_usd: float
    ask_depth_usd: float
    imbalance_ratio: float
    updated_at: float


@dataclass
class WhaleEvent:
    symbol: str
    timestamp_ms: int
    event_type: str
    side: str
    price: float
    quantity: float
    notional_usd: float
    deviation_multiple: float
    market_impact: str
    note: str


@dataclass
class ConnectionState:
    status: str = "DISCONNECTED"
    market_mode: str = "FUTURES"
    rest_ping_ms: float | None = None
    ws_latency_ms: float | None = None
    ws_connected: bool = False
    last_data_update: float | None = None
    api_errors: int = 0
    last_error: str | None = None
    reconnect_attempts: int = 0
    recent_errors: list[str] = field(default_factory=list)
