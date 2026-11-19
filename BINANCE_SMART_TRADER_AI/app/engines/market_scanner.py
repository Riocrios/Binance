from __future__ import annotations

from dataclasses import dataclass

from app.engines.signal_engine import SignalReport, generate_signal_report
from app.exchange.binance_client import BinanceRestClient
from app.exchange.market_data import TickerSnapshot


@dataclass
class ScannerRow:
    ticker: TickerSnapshot
    signal: SignalReport


class MarketScanner:
    def __init__(self, client: BinanceRestClient) -> None:
        self.client = client

    def scan(
        self,
        min_volume_usd: float,
        max_spread_pct: float,
        min_volatility_pct: float,
        exclude_stablecoins: bool,
        aggressiveness: str,
        weights: dict[str, int],
        min_risk_reward: float,
        max_pairs: int = 25,
    ) -> list[ScannerRow]:
        tickers = self.client.fetch_tickers_24h(exclude_stablecoins=exclude_stablecoins)
        filtered = [
            t for t in tickers
            if t.quote_volume >= min_volume_usd
            and t.spread_pct <= max_spread_pct
            and t.volatility_pct >= min_volatility_pct
        ]
        filtered.sort(key=lambda t: t.quote_volume, reverse=True)
        candidates = filtered[:max_pairs]

        rows: list[ScannerRow] = []
        for t in candidates:
            try:
                k15 = self.client.fetch_klines(t.symbol, "15m", 160)
                k1h = self.client.fetch_klines(t.symbol, "1h", 120)
                k4h = self.client.fetch_klines(t.symbol, "4h", 90)
                k5 = self.client.fetch_klines(t.symbol, "5m", 120)
                ob = self.client.fetch_order_book(t.symbol, 20)
                sig = generate_signal_report(
                    symbol=t.symbol,
                    market_mode=self.client.market_mode,
                    primary_klines=k15,
                    tf_klines={"5m": k5, "15m": k15, "1h": k1h, "4h": k4h},
                    order_book=ob,
                    live_price=t.last_price,
                    last_updated_sec=t.updated_at,
                    weights=weights,
                    aggressiveness=aggressiveness,
                    min_risk_reward=min_risk_reward,
                    max_spread_pct=max_spread_pct,
                )
                rows.append(ScannerRow(ticker=t, signal=sig))
            except Exception:
                continue
        return rows
