from __future__ import annotations

import threading
import time
from collections import deque

from app.exchange.market_data import WhaleEvent


class WhaleTracker:
    """Monitors unusually large aggTrades and forced liquidations without attributing wallets/identities."""

    def __init__(self, max_events: int = 120) -> None:
        self._events: deque[WhaleEvent] = deque(maxlen=max_events)
        self._lock = threading.Lock()
        self._avg_trade_usd: dict[str, float] = {}

    def process_agg_trade(self, symbol: str, trade: dict) -> WhaleEvent | None:
        price = float(trade.get("p") or 0)
        qty = float(trade.get("q") or 0)
        if price <= 0 or qty <= 0:
            return None
        notional = price * qty
        ts = int(trade.get("T") or trade.get("E") or time.time() * 1000)
        is_buyer_maker = bool(trade.get("m", False))
        side = "SELL" if is_buyer_maker else "BUY"

        prev_avg = self._avg_trade_usd.get(symbol, notional)
        new_avg = prev_avg * 0.96 + notional * 0.04
        self._avg_trade_usd[symbol] = new_avg
        dev = notional / max(1.0, prev_avg)

        threshold_usd = 75_000.0 if symbol in ("BTCUSDT", "ETHUSDT") else 25_000.0
        if notional < threshold_usd and dev < 6.0:
            return None

        impact = "HIGH" if notional >= threshold_usd * 4 else ("MEDIUM" if notional >= threshold_usd * 1.8 else "LOW")
        event_type = "LARGE_BUY" if side == "BUY" else "LARGE_SELL"
        event = WhaleEvent(
            symbol=symbol.upper(),
            timestamp_ms=ts,
            event_type=event_type,
            side=side,
            price=price,
            quantity=qty,
            notional_usd=notional,
            deviation_multiple=round(dev, 2),
            market_impact=impact,
            note=f"Large aggressive market {side.lower()} ({dev:.1f}x rolling trade average).",
        )
        with self._lock:
            self._events.appendleft(event)
        return event

    def process_rest_agg_trades(self, symbol: str, trades: list[dict]) -> list[WhaleEvent]:
        if not trades:
            return []
        notionals = [float(t["p"]) * float(t["q"]) for t in trades if float(t.get("p", 0)) > 0]
        if not notionals:
            return []
        avg_n = sum(notionals) / len(notionals)
        self._avg_trade_usd[symbol] = avg_n
        detected: list[WhaleEvent] = []
        threshold = max(avg_n * 4.5, 45_000.0 if symbol in ("BTCUSDT", "ETHUSDT") else 18_000.0)
        for t in trades:
            p = float(t["p"])
            q = float(t["q"])
            n = p * q
            if n >= threshold:
                side = "SELL" if bool(t.get("m", False)) else "BUY"
                dev = n / max(1.0, avg_n)
                ev = WhaleEvent(
                    symbol=symbol.upper(),
                    timestamp_ms=int(t.get("T") or time.time() * 1000),
                    event_type="LARGE_BUY" if side == "BUY" else "LARGE_SELL",
                    side=side,
                    price=p,
                    quantity=q,
                    notional_usd=n,
                    deviation_multiple=round(dev, 2),
                    market_impact="HIGH" if dev >= 8 else "MEDIUM",
                    note=f"Aggressive {side} execution {dev:.1f}x recent sample average.",
                )
                detected.append(ev)
        with self._lock:
            for ev in reversed(detected[-15:]):
                self._events.appendleft(ev)
        return detected

    def process_liquidation(self, payload: dict) -> WhaleEvent | None:
        order = payload.get("o", {})
        symbol = str(order.get("s") or "")
        price = float(order.get("ap") or order.get("p") or 0)
        qty = float(order.get("q") or 0)
        if not symbol or price <= 0 or qty <= 0:
            return None
        notional = price * qty
        if notional < 10_000.0:
            return None
        side = str(order.get("S") or "SELL")
        ev_type = "LONG_LIQUIDATION" if side == "SELL" else "SHORT_LIQUIDATION"
        event = WhaleEvent(
            symbol=symbol.upper(),
            timestamp_ms=int(payload.get("E") or time.time() * 1000),
            event_type=ev_type,
            side=side,
            price=price,
            quantity=qty,
            notional_usd=notional,
            deviation_multiple=10.0,
            market_impact="HIGH" if notional >= 100_000 else "MEDIUM",
            note=f"Forced {ev_type.replace('_', ' ').title()} event on USD-M Futures.",
        )
        with self._lock:
            self._events.appendleft(event)
        return event

    def get_events(self, limit: int = 60) -> list[WhaleEvent]:
        with self._lock:
            return list(self._events)[:limit]
