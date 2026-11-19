from __future__ import annotations

import time
from datetime import datetime

from PySide6.QtCore import QRunnable, QThreadPool, QTimer, Signal, QObject
from PySide6.QtWidgets import (
    QComboBox,
    QFrame,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

from app.config import DATA_DIR, load_config, save_config
from app.database.database import DatabaseManager
from app.database.journal import TradeJournalRepository
from app.engines.backtester import run_walk_forward_backtest
from app.engines.market_scanner import MarketScanner, ScannerRow
from app.engines.risk_manager import evaluate_risk
from app.engines.signal_engine import SignalReport, generate_signal_report
from app.engines.whale_tracker import WhaleTracker
from app.exchange.binance_client import BinanceRestClient
from app.exchange.websocket_manager import BinanceWebSocketManager
from app.ui.backtest_view import BacktestView
from app.ui.charts_view import ChartsView
from app.ui.dashboard import DashboardView
from app.ui.journal_view import JournalView
from app.ui.momentum_view import MomentumView
from app.ui.risk_view import RiskView
from app.ui.scanner_view import ScannerView
from app.ui.settings_view import SettingsView
from app.ui.signals_view import SignalsView
from app.ui.volume_view import VolumeView
from app.ui.whale_view import WhaleView
from app.utils.keyring_store import load_api_key, save_api_key
from app.utils.logger import get_logger

logger = get_logger("main_window")


class _WorkerSignals(QObject):
    finished = Signal(object)
    error = Signal(str)


class _AsyncTask(QRunnable):
    def __init__(self, fn, *args, **kwargs) -> None:
        super().__init__()
        self.fn = fn
        self.args = args
        self.kwargs = kwargs
        self.signals = _WorkerSignals()

    def run(self) -> None:
        try:
            res = self.fn(*self.args, **self.kwargs)
            self.signals.finished.emit(res)
        except Exception as exc:
            self.signals.error.emit(str(exc))


class MainWindow(QMainWindow):
    NAV_ITEMS = [
        "OVERVIEW",
        "MARKET SCANNER",
        "AI SIGNALS",
        "WHALE TRACKER",
        "MOMENTUM",
        "VOLUME ANALYSIS",
        "LIVE CHARTS",
        "RISK MANAGER",
        "TRADE JOURNAL",
        "BACKTESTING",
        "SETTINGS",
    ]

    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("BINANCE SMART TRADER AI — Autonomous Analysis Terminal")
        self.resize(1420, 880)

        self.config = load_config()
        self.api_key = load_api_key()
        self.db = DatabaseManager(DATA_DIR / "smart_trader.db")
        self.db.initialize()
        self.journal = TradeJournalRepository(self.db)

        mode = self.config["market"]["default_mode"]
        self.active_symbol = self.config["market"]["default_symbol"]
        self.active_tf = self.config["market"]["default_timeframe"]

        self.client = BinanceRestClient(market_mode=mode, api_key=self.api_key)
        self.scanner = MarketScanner(self.client)
        self.whale_tracker = WhaleTracker()
        self.ws = BinanceWebSocketManager(
            on_trade=self._on_ws_trade,
            on_liquidation=self._on_ws_liq,
            on_status=self._on_ws_status,
        )
        self.pool = QThreadPool.globalInstance()

        self._scanner_rows: list[ScannerRow] = []
        self._active_klines = []
        self._active_signal: SignalReport | None = None
        self._active_spread = 0.02
        self._ws_connected = False
        self._ws_latency_ms: float | None = None
        self._ws_reconnects = 0
        self._ws_err: str | None = None
        self._scan_busy = False

        self._build_ui()
        self._refresh_journal()
        self.ws.start(mode, self.active_symbol)
        self._trigger_scan()
        self._trigger_symbol_refresh(self.active_symbol, self.active_tf)

        self.scan_timer = QTimer(self)
        self.scan_timer.timeout.connect(self._trigger_scan)
        self.scan_timer.start(int(self.config["app"].get("refresh_interval_sec", 8)) * 1000)

        self.ui_timer = QTimer(self)
        self.ui_timer.timeout.connect(self._update_status_bar)
        self.ui_timer.start(1000)

    def _build_ui(self) -> None:
        central = QWidget()
        self.setCentralWidget(central)
        outer = QVBoxLayout(central)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        # Top Bar
        topbar = QFrame()
        topbar.setObjectName("TopBar")
        tb_lay = QHBoxLayout(topbar)
        tb_lay.setContentsMargins(16, 10, 16, 10)
        brand = QLabel("BINANCE SMART TRADER AI  ·  ANALYSIS ONLY (v1)")
        brand.setObjectName("TitleLabel")

        self.mode_combo = QComboBox()
        self.mode_combo.addItems(["FUTURES", "SPOT"])
        self.mode_combo.setCurrentText(self.client.market_mode)
        self.mode_combo.currentTextChanged.connect(self._on_market_mode_changed)

        self.lbl_conn = QLabel("STATUS: CONNECTING...")
        self.lbl_conn.setObjectName("MutedLabel")
        self.btn_rescan = QPushButton("Refresh Market")
        self.btn_rescan.setObjectName("PrimaryBtn")
        self.btn_rescan.clicked.connect(self._manual_refresh)

        tb_lay.addWidget(brand)
        tb_lay.addStretch(1)
        tb_lay.addWidget(QLabel("Market:"))
        tb_lay.addWidget(self.mode_combo)
        tb_lay.addWidget(self.lbl_conn)
        tb_lay.addWidget(self.btn_rescan)
        outer.addWidget(topbar)

        body = QHBoxLayout()
        body.setContentsMargins(0, 0, 0, 0)
        body.setSpacing(0)

        # Sidebar
        sidebar = QFrame()
        sidebar.setObjectName("Sidebar")
        sidebar.setFixedWidth(220)
        sb_lay = QVBoxLayout(sidebar)
        sb_lay.setContentsMargins(10, 14, 10, 14)
        sb_lay.setSpacing(4)

        self.nav_buttons: list[QPushButton] = []
        for idx, name in enumerate(self.NAV_ITEMS):
            btn = QPushButton(name)
            btn.setObjectName("NavButton")
            btn.setProperty("active", idx == 0)
            btn.clicked.connect(lambda _checked=False, i=idx: self._switch_tab(i))
            sb_lay.addWidget(btn)
            self.nav_buttons.append(btn)
        sb_lay.addStretch(1)
        body.addWidget(sidebar)

        # Views Stack
        self.stack = QStackedWidget()
        self.v_dashboard = DashboardView()
        self.v_scanner = ScannerView()
        self.v_signals = SignalsView()
        self.v_whales = WhaleView()
        self.v_momentum = MomentumView()
        self.v_volume = VolumeView()
        self.v_charts = ChartsView()
        self.v_risk = RiskView(self.config["risk"])
        self.v_journal = JournalView()
        self.v_backtest = BacktestView()
        self.v_settings = SettingsView(self.config, self.api_key)

        for v in (
            self.v_dashboard,
            self.v_scanner,
            self.v_signals,
            self.v_whales,
            self.v_momentum,
            self.v_volume,
            self.v_charts,
            self.v_risk,
            self.v_journal,
            self.v_backtest,
            self.v_settings,
        ):
            self.stack.addWidget(v)

        body.addWidget(self.stack, 1)
        outer.addLayout(body, 1)

        # Connect view signals
        self.v_dashboard.symbol_selected.connect(self._on_symbol_selected)
        self.v_scanner.symbol_selected.connect(self._on_symbol_selected)
        self.v_scanner.scan_requested.connect(self._trigger_scan)
        self.v_charts.timeframe_changed.connect(self._on_tf_changed)
        self.v_signals.log_to_journal_requested.connect(self._on_log_signal_to_journal)
        self.v_risk.risk_config_saved.connect(self._on_risk_saved)
        self.v_journal.close_entry_requested.connect(self._on_close_journal_entry)
        self.v_journal.delete_entry_requested.connect(self._on_delete_journal_entry)
        self.v_journal.refresh_requested.connect(self._refresh_journal)
        self.v_backtest.run_backtest_requested.connect(self._on_run_backtest)
        self.v_settings.settings_saved.connect(self._on_settings_saved)

    def _switch_tab(self, index: int) -> None:
        self.stack.setCurrentIndex(index)
        for i, btn in enumerate(self.nav_buttons):
            btn.setProperty("active", i == index)
            btn.style().unpolish(btn)
            btn.style().polish(btn)

    def _manual_refresh(self) -> None:
        self._trigger_scan()
        self._trigger_symbol_refresh(self.active_symbol, self.active_tf)

    def _on_market_mode_changed(self, mode: str) -> None:
        self.client.set_market_mode(mode)
        self.config["market"]["default_mode"] = mode
        save_config(self.config)
        self.ws.switch_stream(mode, self.active_symbol)
        self._manual_refresh()

    def _on_symbol_selected(self, symbol: str) -> None:
        self.active_symbol = symbol.upper()
        self.ws.switch_stream(self.client.market_mode, self.active_symbol)
        self._trigger_symbol_refresh(self.active_symbol, self.active_tf)
        self._switch_tab(2)  # Jump to AI SIGNALS

    def _on_tf_changed(self, tf: str) -> None:
        self.active_tf = tf
        self._trigger_symbol_refresh(self.active_symbol, self.active_tf)

    def _trigger_scan(self) -> None:
        if self._scan_busy:
            return
        self._scan_busy = True
        sc = self.config["scanner"]
        rk = self.config["risk"]

        def task():
            return self.scanner.scan(
                min_volume_usd=float(sc["min_volume_24h_usd"]),
                max_spread_pct=float(sc["max_spread_pct"]),
                min_volatility_pct=float(sc["min_volatility_pct"]),
                exclude_stablecoins=bool(sc["exclude_stablecoins"]),
                aggressiveness=str(sc["aggressiveness"]),
                weights=self.config["weights"],
                min_risk_reward=float(rk["min_risk_reward"]),
                max_pairs=int(self.config["market"].get("max_scanned_pairs", 25)),
            )

        runnable = _AsyncTask(task)
        runnable.signals.finished.connect(self._on_scan_finished)
        runnable.signals.error.connect(self._on_worker_error)
        self.pool.start(runnable)

    def _on_scan_finished(self, rows: list[ScannerRow]) -> None:
        self._scan_busy = False
        self._scanner_rows = rows
        self.v_scanner.set_rows(rows)

        price_map = {r.ticker.symbol: r.ticker.last_price for r in rows}
        btc_row = next((r for r in rows if r.ticker.symbol == "BTCUSDT"), None)
        eth_row = next((r for r in rows if r.ticker.symbol == "ETHUSDT"), None)

        self.journal.evaluate_open_entries(price_map)
        self._refresh_journal()

        self.v_dashboard.update_data(
            rows=rows,
            btc_price=btc_row.ticker.last_price if btc_row else None,
            btc_chg=btc_row.ticker.price_change_pct if btc_row else 0.0,
            eth_price=eth_row.ticker.last_price if eth_row else None,
            eth_chg=eth_row.ticker.price_change_pct if eth_row else 0.0,
            active_symbol=self.active_symbol,
            active_klines=self._active_klines,
            active_signal=self._active_signal,
        )

    def _trigger_symbol_refresh(self, symbol: str, tf: str) -> None:
        sc = self.config["scanner"]
        rk = self.config["risk"]

        def task():
            k_chart = self.client.fetch_klines(symbol, tf, 220)
            tf_map = {tf: k_chart}
            for req_tf in ("5m", "15m", "1h", "4h"):
                if req_tf not in tf_map:
                    tf_map[req_tf] = self.client.fetch_klines(symbol, req_tf, 140)
            ob = self.client.fetch_order_book(symbol, 20)
            trades = self.client.fetch_recent_agg_trades(symbol, 80)
            self.whale_tracker.process_rest_agg_trades(symbol, trades)
            live_px = k_chart[-1].close if k_chart else 0.0
            rep = generate_signal_report(
                symbol=symbol,
                market_mode=self.client.market_mode,
                primary_klines=tf_map["15m"],
                tf_klines=tf_map,
                order_book=ob,
                live_price=live_px,
                last_updated_sec=time.time(),
                weights=self.config["weights"],
                aggressiveness=str(sc["aggressiveness"]),
                min_risk_reward=float(rk["min_risk_reward"]),
                max_spread_pct=float(sc["max_spread_pct"]),
            )
            return k_chart, rep, ob.spread_pct

        runnable = _AsyncTask(task)
        runnable.signals.finished.connect(self._on_symbol_refreshed)
        runnable.signals.error.connect(self._on_worker_error)
        self.pool.start(runnable)

    def _on_symbol_refreshed(self, payload: tuple) -> None:
        k_chart, rep, spread_pct = payload
        self._active_klines = k_chart
        self._active_signal = rep
        self._active_spread = spread_pct
        self.v_signals.update_signal(rep)
        self.v_momentum.update_signal(rep)
        self.v_volume.update_signal(rep)
        self.v_charts.update_chart(self.active_symbol, self.active_tf, k_chart, rep)
        self.v_risk.update_signal(rep, spread_pct)
        self.v_whales.update_events(self.whale_tracker.get_events())

    def _on_ws_trade(self, data: dict) -> None:
        self.whale_tracker.process_agg_trade(self.active_symbol, data)

    def _on_ws_liq(self, data: dict) -> None:
        self.whale_tracker.process_liquidation(data)

    def _on_ws_status(self, connected: bool, latency: float | None, reconnects: int, err: str | None) -> None:
        self._ws_connected = connected
        self._ws_latency_ms = latency
        self._ws_reconnects = reconnects
        self._ws_err = err

    def _on_worker_error(self, msg: str) -> None:
        self._scan_busy = False
        self.v_settings.set_last_error(msg)
        logger.warning("Background worker error: %s", msg)

    def _update_status_bar(self) -> None:
        st = self.client.state
        ping_txt = f"{st.rest_ping_ms:.0f}ms" if st.rest_ping_ms is not None else "--"
        ws_txt = f"{self._ws_latency_ms:.0f}ms" if self._ws_latency_ms is not None else "--"
        upd_txt = (
            datetime.fromtimestamp(st.last_data_update).strftime("%H:%M:%S")
            if st.last_data_update
            else "--"
        )
        status_label = st.status if st.status == "CONNECTED" else "DISCONNECTED"
        self.lbl_conn.setText(
            f"{status_label}  |  Ping: {ping_txt}  |  WS: {ws_txt}  |  Updated: {upd_txt}  |  Errors: {st.api_errors}"
        )
        self.lbl_conn.setStyleSheet(
            "color: #22C55E; font-weight: 600;" if status_label == "CONNECTED" else "color: #EF4444; font-weight: 600;"
        )

    def _on_log_signal_to_journal(self, rep: SignalReport) -> None:
        ev = evaluate_risk(
            direction=rep.direction,
            entry=rep.entry,
            stop_loss=rep.stop_loss,
            take_profit_1=rep.take_profit_1,
            take_profit_2=rep.take_profit_2,
            spread_pct=self._active_spread,
            open_positions_count=len([e for e in self.journal.list_entries() if e["status"] == "OPEN"]),
            daily_loss_usd=0.0,
            risk_cfg=self.config["risk"],
        )
        if not ev.approved:
            QMessageBox.warning(self, "Risk Manager Guardrail", "\n".join(ev.rejection_reasons))
            return
        self.journal.add_journal_entry(
            symbol=rep.symbol,
            market_mode=rep.market_mode,
            direction=rep.direction,
            entry_price=rep.entry,
            stop_loss=rep.stop_loss,
            take_profit_1=rep.take_profit_1,
            take_profit_2=rep.take_profit_2,
            score=rep.active_score,
            risk_reward=rep.risk_reward,
            position_size_qty=ev.position_size_qty,
            notional_usd=ev.notional_value_usd,
            fees_usd=ev.entry_fee_usd + ev.exit_fee_usd,
            slippage_usd=ev.slippage_usd,
            notes="; ".join(rep.reasons[:2]),
        )
        self._refresh_journal()
        self._switch_tab(8)

    def _on_close_journal_entry(self, entry_id: int) -> None:
        entries = self.journal.list_entries()
        row = next((e for e in entries if e["id"] == entry_id), None)
        if not row or row["status"] != "OPEN":
            return
        price_map = {r.ticker.symbol: r.ticker.last_price for r in self._scanner_rows}
        px = price_map.get(row["symbol"], float(row["entry_price"]))
        self.journal.close_entry(entry_id, px, "MANUAL_CLOSED", "Closed manually in Trade Journal")
        self._refresh_journal()

    def _on_delete_journal_entry(self, entry_id: int) -> None:
        self.journal.delete_entry(entry_id)
        self._refresh_journal()

    def _refresh_journal(self) -> None:
        entries = self.journal.list_entries()
        stats = self.journal.compute_stats(float(self.config["risk"].get("virtual_balance", 10000.0)))
        self.v_journal.update_journal(entries, stats)

    def _on_risk_saved(self, risk_cfg: dict) -> None:
        self.config["risk"] = risk_cfg
        save_config(self.config)

    def _on_run_backtest(self, params: dict) -> None:
        def task():
            klines = self.client.fetch_klines(params["symbol"], params["timeframe"], params["limit"])
            return run_walk_forward_backtest(
                symbol=params["symbol"],
                timeframe=params["timeframe"],
                market_mode=self.client.market_mode,
                klines=klines,
                initial_balance=float(self.config["risk"]["virtual_balance"]),
                risk_per_trade_pct=float(self.config["risk"]["risk_per_trade_pct"]),
                commission_pct=float(params["commission_pct"]),
                slippage_pct=float(params["slippage_pct"]),
                min_score=int(self.config["backtest"]["min_score"]),
                min_rr=float(self.config["risk"]["min_risk_reward"]),
                aggressiveness=str(self.config["scanner"]["aggressiveness"]),
            )

        runnable = _AsyncTask(task)
        runnable.signals.finished.connect(self.v_backtest.update_result)
        runnable.signals.error.connect(self._on_worker_error)
        self.pool.start(runnable)

    def _on_settings_saved(self, cfg: dict, new_api_key: str) -> None:
        self.config = cfg
        save_config(cfg)
        if new_api_key:
            save_api_key(new_api_key)
            self.api_key = new_api_key
            self.client.set_api_key(new_api_key)
        self.mode_combo.setCurrentText(cfg["market"]["default_mode"])
        self._manual_refresh()

    def closeEvent(self, event) -> None:
        self.ws.stop()
        super().closeEvent(event)
