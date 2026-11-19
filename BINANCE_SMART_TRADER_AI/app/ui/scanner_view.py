from __future__ import annotations

from PySide6.QtCore import Signal
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QApplication,
    QComboBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from app.engines.market_scanner import ScannerRow
from app.ui.widgets import attach_table_clipboard
from app.utils.helpers import format_price, format_usd


class ScannerView(QWidget):
    symbol_selected = Signal(str)
    scan_requested = Signal()

    def __init__(self) -> None:
        super().__init__()
        self._rows: list[ScannerRow] = []

        root = QVBoxLayout(self)
        root.setContentsMargins(16, 16, 16, 16)
        root.setSpacing(12)

        controls = QHBoxLayout()
        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText("Search symbol (e.g. BTCUSDT, ETH, SOL)...")
        self.search_input.textChanged.connect(self._render_table)

        btn_paste = QPushButton("Paste Symbol")
        btn_paste.clicked.connect(self._paste_symbol)

        self.sort_combo = QComboBox()
        self.sort_combo.addItems([
            "Best LONG Opportunities",
            "Best SHORT Opportunities",
            "Highest Signal Score",
            "Highest 24h Volume",
            "Highest Volatility",
        ])
        self.sort_combo.currentIndexChanged.connect(self._render_table)

        self.btn_refresh = QPushButton("Scan Binance Now")
        self.btn_refresh.setObjectName("PrimaryBtn")
        self.btn_refresh.clicked.connect(self.scan_requested.emit)

        controls.addWidget(QLabel("Search:"))
        controls.addWidget(self.search_input, 2)
        controls.addWidget(btn_paste)
        controls.addWidget(QLabel("Sort by:"))
        controls.addWidget(self.sort_combo, 1)
        controls.addWidget(self.btn_refresh)
        root.addLayout(controls)

        self.table = QTableWidget(0, 8)
        self.table.setHorizontalHeaderLabels(
            ["SYMBOL", "PRICE", "24H CHANGE", "24H VOLUME", "SPREAD %", "MOMENTUM", "SIGNAL", "SCORE"]
        )
        self.table.setAlternatingRowColors(True)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        attach_table_clipboard(self.table)
        self.table.cellDoubleClicked.connect(self._on_select)
        root.addWidget(self.table, 1)

    def _paste_symbol(self) -> None:
        cb = QApplication.clipboard()
        if cb:
            self.search_input.setText(cb.text().strip().upper())

    def _on_select(self, row: int, _col: int) -> None:
        item = self.table.item(row, 0)
        if item:
            self.symbol_selected.emit(item.text())

    def set_rows(self, rows: list[ScannerRow]) -> None:
        self._rows = rows
        self._render_table()

    def _render_table(self) -> None:
        query = self.search_input.text().strip().upper()
        filtered = [r for r in self._rows if not query or query in r.ticker.symbol]

        mode = self.sort_combo.currentIndex()
        if mode == 0:
            filtered.sort(key=lambda r: r.signal.long_score, reverse=True)
        elif mode == 1:
            filtered.sort(key=lambda r: r.signal.short_score, reverse=True)
        elif mode == 2:
            filtered.sort(key=lambda r: r.signal.active_score, reverse=True)
        elif mode == 3:
            filtered.sort(key=lambda r: r.ticker.quote_volume, reverse=True)
        elif mode == 4:
            filtered.sort(key=lambda r: r.ticker.volatility_pct, reverse=True)

        self.table.setRowCount(len(filtered))
        for i, r in enumerate(filtered):
            t = r.ticker
            s = r.signal
            vals = [
                t.symbol,
                format_price(t.last_price),
                f"{t.price_change_pct:+.2f}%",
                format_usd(t.quote_volume),
                f"{t.spread_pct:.3f}%",
                s.momentum.strength,
                s.direction,
                f"L:{s.long_score} / S:{s.short_score}",
            ]
            for c, val in enumerate(vals):
                item = QTableWidgetItem(val)
                if c == 2:
                    item.setForeground(QColor("#22C55E" if t.price_change_pct >= 0 else "#EF4444"))
                elif c == 6:
                    color = "#22C55E" if s.direction == "LONG" else ("#EF4444" if s.direction == "SHORT" else "#94A3B8")
                    item.setForeground(QColor(color))
                self.table.setItem(i, c, item)
