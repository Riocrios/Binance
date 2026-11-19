from __future__ import annotations

from datetime import datetime

from PySide6.QtGui import QColor
from PySide6.QtWidgets import QLabel, QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget

from app.exchange.market_data import WhaleEvent
from app.ui.widgets import attach_table_clipboard
from app.utils.helpers import format_price, format_usd


class WhaleView(QWidget):
    def __init__(self) -> None:
        super().__init__()
        root = QVBoxLayout(self)
        root.setContentsMargins(16, 16, 16, 16)
        root.setSpacing(10)

        title = QLabel("Large Market Trades & Liquidation Monitor")
        title.setObjectName("TitleLabel")
        note = QLabel(
            "Tracks unusually large market buys/sells and forced Futures liquidations from live Binance streams. "
            "Events are never attributed to specific wallets or individuals."
        )
        note.setObjectName("MutedLabel")
        note.setWordWrap(True)

        self.table = QTableWidget(0, 8)
        self.table.setHorizontalHeaderLabels(
            ["TIME", "SYMBOL", "EVENT", "SIDE", "SIZE (USD)", "PRICE", "DEVIATION", "IMPACT / NOTE"]
        )
        self.table.setAlternatingRowColors(True)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        attach_table_clipboard(self.table)

        root.addWidget(title)
        root.addWidget(note)
        root.addWidget(self.table, 1)

    def update_events(self, events: list[WhaleEvent]) -> None:
        self.table.setRowCount(len(events))
        for i, ev in enumerate(events):
            dt = datetime.fromtimestamp(ev.timestamp_ms / 1000.0).strftime("%H:%M:%S")
            vals = [
                dt,
                ev.symbol,
                ev.event_type,
                ev.side,
                format_usd(ev.notional_usd),
                format_price(ev.price),
                f"{ev.deviation_multiple:.1f}x",
                f"[{ev.market_impact}] {ev.note}",
            ]
            for c, val in enumerate(vals):
                item = QTableWidgetItem(val)
                if c in (2, 3):
                    item.setForeground(QColor("#22C55E" if ev.side == "BUY" else "#EF4444"))
                self.table.setItem(i, c, item)
