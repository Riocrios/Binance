from __future__ import annotations

import time
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from app.exchange.market_data import ConnectionState, Kline, OrderBookSnapshot, TickerSnapshot
from app.utils.helpers import is_stablecoin_pair
from app.utils.logger import get_logger

logger = get_logger("binance_client")


class BinanceRestClient:
    SPOT_BASE = "https://api.binance.com"
    FUTURES_BASE = "https://fapi.binance.com"

    def __init__(self, market_mode: str = "FUTURES", api_key: str = "") -> None:
        self.market_mode = market_mode.upper()
        self.api_key = api_key
        self.state = ConnectionState(market_mode=self.market_mode)
        self.session = requests.Session()
        retry = Retry(total=2, backoff_factor=0.35, status_forcelist=[500, 502, 503, 504])
        adapter = HTTPAdapter(max_retries=retry, pool_connections=20, pool_maxsize=20)
        self.session.mount("https://", adapter)
        self.session.headers.update({"User-Agent": "BinanceSmartTraderAI/1.0"})
        self._rate_limit_until = 0.0

    def set_market_mode(self, mode: str) -> None:
        self.market_mode = mode.upper()
        self.state.market_mode = self.market_mode

    def set_api_key(self, api_key: str) -> None:
        self.api_key = api_key.strip()

    @property
    def base_url(self) -> str:
        return self.FUTURES_BASE if self.market_mode == "FUTURES" else self.SPOT_BASE

    def _get(self, path: str, params: dict[str, Any] | None = None, timeout: float = 8.0) -> Any:
        now = time.time()
        if now < self._rate_limit_until:
            raise RuntimeError(f"Rate limit cooldown active ({int(self._rate_limit_until - now)}s remaining)")

        headers: dict[str, str] = {}
        if self.api_key:
            headers["X-MBX-APIKEY"] = self.api_key

        t0 = time.perf_counter()
        try:
            resp = self.session.get(
                f"{self.base_url}{path}",
                params=params,
                headers=headers,
                timeout=timeout,
            )
            elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 1)

            if resp.status_code in (418, 429):
                retry_after = int(resp.headers.get("Retry-After", "15"))
                self._rate_limit_until = time.time() + max(5, retry_after)
                raise RuntimeError(f"Binance API rate limit ({resp.status_code}), backing off {retry_after}s")

            resp.raise_for_status()
            self.state.rest_ping_ms = elapsed_ms
            self.state.last_data_update = time.time()
            self.state.status = "CONNECTED"
            self.state.last_error = None
            return resp.json()
        except Exception as exc:
            self.state.api_errors += 1
            err_str = str(exc)
            self.state.last_error = err_str
            self.state.recent_errors = (self.state.recent_errors + [err_str])[-15:]
            self.state.status = "DISCONNECTED"
            logger.warning("REST request failed (%s): %s", path, err_str)
            raise

    def ping(self) -> float:
        endpoint = "/fapi/v1/ping" if self.market_mode == "FUTURES" else "/api/v3/ping"
        self._get(endpoint, timeout=5.0)
        return self.state.rest_ping_ms or 0.0

    def fetch_tickers_24h(self, exclude_stablecoins: bool = True) -> list[TickerSnapshot]:
        if self.market_mode == "FUTURES":
            raw_tickers = self._get("/fapi/v1/ticker/24hr")
            book_map: dict[str, tuple[float, float]] = {}
            try:
                raw_books = self._get("/fapi/v1/ticker/bookTicker")
                for b in raw_books:
                    book_map[b["symbol"]] = (float(b.get("bidPrice") or 0), float(b.get("askPrice") or 0))
            except Exception:
                pass
            premium_map: dict[str, tuple[float, float]] = {}
            try:
                raw_prem = self._get("/fapi/v1/premiumIndex")
                for p in raw_prem:
                    premium_map[p["symbol"]] = (
                        float(p.get("markPrice") or 0),
                        float(p.get("lastFundingRate") or 0),
                    )
            except Exception:
                pass
        else:
            raw_tickers = self._get("/api/v3/ticker/24hr")
            book_map = {}
            premium_map = {}

        now = time.time()
        snapshots: list[TickerSnapshot] = []
        for item in raw_tickers:
            symbol = str(item.get("symbol", ""))
            if not symbol.endswith("USDT"):
                continue
            if exclude_stablecoins and is_stablecoin_pair(symbol):
                continue

            last_price = float(item.get("lastPrice") or 0)
            high_price = float(item.get("highPrice") or 0)
            low_price = float(item.get("lowPrice") or 0)
            quote_vol = float(item.get("quoteVolume") or 0)
            chg_pct = float(item.get("priceChangePercent") or 0)
            if last_price <= 0 or quote_vol <= 0:
                continue

            if symbol in book_map:
                bid, ask = book_map[symbol]
            else:
                bid = float(item.get("bidPrice") or last_price)
                ask = float(item.get("askPrice") or last_price)

            spread_pct = ((ask - bid) / last_price) * 100.0 if (bid > 0 and ask > 0 and ask >= bid) else 0.0
            volatility_pct = ((high_price - low_price) / last_price) * 100.0 if high_price > low_price else 0.0
            mark_price, funding_rate = premium_map.get(symbol, (last_price, 0.0))

            snapshots.append(
                TickerSnapshot(
                    symbol=symbol,
                    last_price=last_price,
                    price_change_pct=chg_pct,
                    quote_volume=quote_vol,
                    high_price=high_price,
                    low_price=low_price,
                    bid_price=bid,
                    ask_price=ask,
                    spread_pct=spread_pct,
                    volatility_pct=volatility_pct,
                    mark_price=mark_price,
                    funding_rate=funding_rate,
                    updated_at=now,
                )
            )
        return snapshots

    def fetch_klines(self, symbol: str, interval: str = "15m", limit: int = 220) -> list[Kline]:
        endpoint = "/fapi/v1/klines" if self.market_mode == "FUTURES" else "/api/v3/klines"
        raw = self._get(endpoint, params={"symbol": symbol.upper(), "interval": interval, "limit": limit})
        klines: list[Kline] = []
        for row in raw:
            klines.append(
                Kline(
                    open_time=int(row[0]),
                    open=float(row[1]),
                    high=float(row[2]),
                    low=float(row[3]),
                    close=float(row[4]),
                    volume=float(row[5]),
                    close_time=int(row[6]),
                    quote_volume=float(row[7]),
                    trades=int(row[8]),
                    taker_buy_base_vol=float(row[9]),
                    taker_buy_quote_vol=float(row[10]),
                )
            )
        return klines

    def fetch_order_book(self, symbol: str, limit: int = 20) -> OrderBookSnapshot:
        endpoint = "/fapi/v1/depth" if self.market_mode == "FUTURES" else "/api/v3/depth"
        raw = self._get(endpoint, params={"symbol": symbol.upper(), "limit": limit})
        bids = raw.get("bids", [])
        asks = raw.get("asks", [])
        if not bids or not asks:
            raise ValueError(f"Empty order book returned for {symbol}")
        best_bid = float(bids[0][0])
        best_ask = float(asks[0][0])
        mid = (best_bid + best_ask) / 2.0
        spread_pct = ((best_ask - best_bid) / mid) * 100.0 if mid > 0 else 0.0
        bid_depth = sum(float(p) * float(q) for p, q in bids)
        ask_depth = sum(float(p) * float(q) for p, q in asks)
        total = bid_depth + ask_depth
        imbalance = (bid_depth - ask_depth) / total if total > 0 else 0.0
        return OrderBookSnapshot(
            best_bid=best_bid,
            best_ask=best_ask,
            spread_pct=spread_pct,
            bid_depth_usd=bid_depth,
            ask_depth_usd=ask_depth,
            imbalance_ratio=imbalance,
            updated_at=time.time(),
        )

    def fetch_open_interest_usd(self, symbol: str, mark_price: float) -> float:
        if self.market_mode != "FUTURES":
            return 0.0
        try:
            raw = self._get("/fapi/v1/openInterest", params={"symbol": symbol.upper()})
            oi_qty = float(raw.get("openInterest") or 0.0)
            return oi_qty * mark_price
        except Exception:
            return 0.0

    def fetch_recent_agg_trades(self, symbol: str, limit: int = 80) -> list[dict[str, Any]]:
        endpoint = "/fapi/v1/aggTrades" if self.market_mode == "FUTURES" else "/api/v3/aggTrades"
        return list(self._get(endpoint, params={"symbol": symbol.upper(), "limit": limit}))
