from __future__ import annotations

from PySide6.QtCore import Signal
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from app.engines.market_scanner import ScannerRow
from app.exchange.market_data import Kline
from app.ui.widgets import LiveCandleChartWidget, MetricCard, attach_table_clipboard
from app.utils.helpers import format_price


class DashboardView(QWidget):
    symbol_selected = Signal(str)

    def __init__(self) -> None:
        super().__init__()
        root = QVBoxLayout(self)
        root.setContentsMargins(16, 16, 16, 16)
        root.setSpacing(12)

        kpi_grid = QGridLayout()
        kpi_grid.setSpacing(10)
        self.card_btc = MetricCard("BTC / USDT", "--", "Awaiting live ticker")
        self.card_eth = MetricCard("ETH / USDT", "--", "Awaiting live ticker")
        self.card_regime = MetricCard("Market State", "SCANNING", "0 scanned pairs")
        self.card_opps = MetricCard("Opportunities", "0 L / 0 S", "0 active signals")
        kpi_grid.addWidget(self.card_btc, 0, 0)
        kpi_grid.addWidget(self.card_eth, 0, 1)
        kpi_grid.addWidget(self.card_regime, 0, 2)
        kpi_grid.addWidget(self.card_opps, 0, 3)
        root.addLayout(kpi_grid)

        split = QHBoxLayout()
        split.setSpacing(12)

        left_box = QVBoxLayout()
        lbl_sig = QLabel("Live Signal Matrix")
        lbl_sig.setObjectName("SectionTitle")
        left_box.addWidget(lbl_sig)

        self.table = QTableWidget(0, 8)
        self.table.setHorizontalHeaderLabels(
            ["SYMBOL", "DIRECTION", "ENTRY", "STOP LOSS", "TAKE PROFIT", "SCORE", "R/R", "STATUS"]
        )
        self.table.setAlternatingRowColors(True)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        attach_table_clipboard(self.table)
        self.table.cellDoubleClicked.connect(self._on_row_double_click)
        left_box.addWidget(self.table)

        right_box = QVBoxLayout()
        self.chart_title = QLabel("Live Candlestick & Signal Overlay")
        self.chart_title.setObjectName("SectionTitle")
        right_box.addWidget(self.chart_title)
        self.chart = LiveCandleChartWidget()
        right_box.addWidget(self.chart)

        split.addLayout(left_box, 3)
        split.addLayout(right_box, 2)
        root.addLayout(split, 1)

    def _on_row_double_click(self, row: int, _col: int) -> None:
        item = self.table.item(row, 0)
        if item:
            self.symbol_selected.emit(item.text())

    def update_data(
        self,
        rows: list[ScannerRow],
        btc_price: float | None,
        btc_chg: float,
        eth_price: float | None,
        eth_chg: float,
        active_symbol: str,
        active_klines: list[Kline],
        active_signal,
    ) -> None:
        if btc_price:
            self.card_btc.set_value(
                f"${format_price(btc_price)}",
                f"24h: {btc_chg:+.2f}%",
                "#22C55E" if btc_chg >= 0 else "#EF4444",
            )
        if eth_price:
            self.card_eth.set_value(
                f"${format_price(eth_price)}",
                f"24h: {eth_chg:+.2f}%",
                "#22C55E" if eth_chg >= 0 else "#EF4444",
            )

        longs = [r for r in rows if r.signal.direction == "LONG"]
        shorts = [r for r in rows if r.signal.direction == "SHORT"]
        promising = len(longs) + len(shorts)
        regime = "BULLISH BIAS" if len(longs) > len(shorts) else ("BEARISH BIAS" if len(shorts) > len(longs) else "NEUTRAL / SELECTIVE")
        self.card_regime.set_value(regime, f"{len(rows)} pairs scanned · {promising} promising")
        self.card_opps.set_value(
            f"{len(longs)} LONG / {len(shorts)} SHORT",
            f"Active setups: {sum(1 for r in rows if r.signal.entry_state in ('ENTRY READY', 'SIGNAL ACTIVE'))}",
        )

        sorted_rows = sorted(
            rows,
            key=lambda r: (0 if r.signal.direction != "WAIT" else 1, -r.signal.active_score),
        )
        self.table.setRowCount(len(sorted_rows))
        for i, row in enumerate(sorted_rows):
            s = row.signal
            vals = [
                s.symbol,
                s.direction,
                format_price(s.entry),
                format_price(s.stop_loss),
                format_price(s.take_profit_2),
                f"{s.active_score}/100",
                f"1:{s.risk_reward:.2f}",
                s.entry_state,
            ]
            for c, val in enumerate(vals):
                item = QTableWidgetItem(val)
                if c == 1:
                    color = "#22C55E" if s.direction == "LONG" else ("#EF4444" if s.direction == "SHORT" else "#94A3B8")
                    item.setForeground(QColor(color))
                self.table.setItem(i, c, item)

        self.chart_title.setText(f"{active_symbol} · 15m Candlesticks & EMA/RSI/MACD")
        if active_klines:
            self.chart.render_klines(
                active_klines,
                entry=active_signal.entry if active_signal else None,
                stop_loss=active_signal.stop_loss if active_signal else None,
                tp1=active_signal.take_profit_1 if active_signal else None,
                tp2=active_signal.take_profit_2 if active_signal else None,
                direction=active_signal.direction if active_signal else "WAIT",
            )
