from __future__ import annotations

import json
import threading
import time
from typing import Callable

import websocket

from app.utils.logger import get_logger

logger = get_logger("ws_manager")


class BinanceWebSocketManager:
    SPOT_WS = "wss://stream.binance.com:9443/stream?streams="
    FUTURES_WS = "wss://fstream.binance.com/stream?streams="

    def __init__(
        self,
        on_ticker: Callable[[dict], None] | None = None,
        on_trade: Callable[[dict], None] | None = None,
        on_liquidation: Callable[[dict], None] | None = None,
        on_status: Callable[[bool, float | None, int, str | None], None] | None = None,
    ) -> None:
        self.market_mode = "FUTURES"
        self.active_symbol = "btcusdt"
        self.on_ticker = on_ticker
        self.on_trade = on_trade
        self.on_liquidation = on_liquidation
        self.on_status = on_status

        self._ws: websocket.WebSocketApp | None = None
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._reconnect_count = 0
        self.connected = False
        self.latency_ms: float | None = None

    def start(self, market_mode: str = "FUTURES", symbol: str = "BTCUSDT") -> None:
        self.stop()
        self.market_mode = market_mode.upper()
        self.active_symbol = symbol.lower()
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()

    def switch_stream(self, market_mode: str, symbol: str) -> None:
        if market_mode.upper() == self.market_mode and symbol.lower() == self.active_symbol and self.connected:
            return
        self.start(market_mode, symbol)

    def stop(self) -> None:
        self._stop_event.set()
        if self._ws is not None:
            try:
                self._ws.close()
            except Exception:
                pass
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        self.connected = False

    def _build_url(self) -> str:
        streams = [f"{self.active_symbol}@aggTrade", f"{self.active_symbol}@miniTicker"]
        if self.market_mode == "FUTURES":
            streams.append("!forceOrder@arr")
            return f"{self.FUTURES_WS}{'/'.join(streams)}"
        return f"{self.SPOT_WS}{'/'.join(streams)}"

    def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            url = self._build_url()
            try:
                self._ws = websocket.WebSocketApp(
                    url,
                    on_open=self._on_open,
                    on_message=self._on_message,
                    on_error=self._on_error,
                    on_close=self._on_close,
                )
                self._ws.run_forever(ping_interval=20, ping_timeout=10)
            except Exception as exc:
                logger.warning("WebSocket loop exception: %s", exc)
            if not self._stop_event.is_set():
                self._reconnect_count += 1
                self.connected = False
                if self.on_status:
                    self.on_status(False, self.latency_ms, self._reconnect_count, "Reconnecting WebSocket...")
                time.sleep(min(10.0, 1.5 * self._reconnect_count))

    def _on_open(self, _ws: websocket.WebSocketApp) -> None:
        self.connected = True
        self._reconnect_count = 0
        if self.on_status:
            self.on_status(True, self.latency_ms, 0, None)

    def _on_message(self, _ws: websocket.WebSocketApp, message: str) -> None:
        try:
            payload = json.loads(message)
            stream = payload.get("stream", "")
            data = payload.get("data", {})
            event_time = data.get("E")
            if isinstance(event_time, (int, float)):
                lat = max(1.0, time.time() * 1000.0 - float(event_time))
                self.latency_ms = round(min(lat, 5000.0), 1)
            if stream.endswith("@miniTicker") and self.on_ticker:
                self.on_ticker(data)
            elif stream.endswith("@aggTrade") and self.on_trade:
                self.on_trade(data)
            elif stream == "!forceOrder@arr" and self.on_liquidation:
                self.on_liquidation(data)
            if self.on_status:
                self.on_status(True, self.latency_ms, self._reconnect_count, None)
        except Exception as exc:
            logger.debug("WS message parse error: %s", exc)

    def _on_error(self, _ws: websocket.WebSocketApp, error: object) -> None:
        self.connected = False
        if self.on_status:
            self.on_status(False, self.latency_ms, self._reconnect_count, str(error))

    def _on_close(self, _ws: websocket.WebSocketApp, _code: object, _msg: object) -> None:
        self.connected = False
        if self.on_status:
            self.on_status(False, self.latency_ms, self._reconnect_count, "WebSocket closed")
