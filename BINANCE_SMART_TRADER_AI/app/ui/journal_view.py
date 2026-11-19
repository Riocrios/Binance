from __future__ import annotations

from datetime import datetime

from PySide6.QtCore import Signal
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from app.database.journal import JournalStats
from app.ui.widgets import MetricCard, attach_table_clipboard
from app.utils.helpers import format_price


class JournalView(QWidget):
    close_entry_requested = Signal(int)
    delete_entry_requested = Signal(int)
    refresh_requested = Signal()

    def __init__(self) -> None:
        super().__init__()
        root = QVBoxLayout(self)
        root.setContentsMargins(16, 16, 16, 16)
        root.setSpacing(12)

        top = QHBoxLayout()
        title = QLabel("SQLite Trade Journal (Virtual Simulation History)")
        title.setObjectName("TitleLabel")
        btn_close = QPushButton("Close Selected at Market")
        btn_del = QPushButton("Delete Selected")
        btn_ref = QPushButton("Refresh")
        btn_close.clicked.connect(self._close_selected)
        btn_del.clicked.connect(self._delete_selected)
        btn_ref.clicked.connect(self.refresh_requested.emit)
        top.addWidget(title, 1)
        top.addWidget(btn_close)
        top.addWidget(btn_del)
        top.addWidget(btn_ref)
        root.addLayout(top)

        grid = QGridLayout()
        grid.setSpacing(8)
        self.c_total = MetricCard("Total / Open", "0 / 0", "Simulated journal records")
        self.c_wr = MetricCard("Win Rate", "0.0%", "0 W / 0 L")
        self.c_pnl = MetricCard("Net PnL / Avg R", "$0.00", "Avg R: 0.00")
        self.c_dd = MetricCard("Max DD / PF", "0.0%", "Profit Factor: 0.00")
        self.c_split = MetricCard("LONG vs SHORT", "0% / 0%", "$0.00 / $0.00")
        grid.addWidget(self.c_total, 0, 0)
        grid.addWidget(self.c_wr, 0, 1)
        grid.addWidget(self.c_pnl, 0, 2)
        grid.addWidget(self.c_dd, 0, 3)
        grid.addWidget(self.c_split, 0, 4)
        root.addLayout(grid)

        self.table = QTableWidget(0, 11)
        self.table.setHorizontalHeaderLabels([
            "ID", "TIME", "SYMBOL", "DIR", "ENTRY", "SL", "TP2", "SCORE", "R/R", "STATUS", "NET PNL / R"
        ])
        self.table.setAlternatingRowColors(True)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        attach_table_clipboard(self.table)
        root.addWidget(self.table, 1)

    def _selected_id(self) -> int | None:
        row = self.table.currentRow()
        if row < 0:
            return None
        item = self.table.item(row, 0)
        return int(item.text()) if item else None

    def _close_selected(self) -> None:
        eid = self._selected_id()
        if eid is not None:
            self.close_entry_requested.emit(eid)

    def _delete_selected(self) -> None:
        eid = self._selected_id()
        if eid is not None:
            self.delete_entry_requested.emit(eid)

    def update_journal(self, entries: list[dict], stats: JournalStats) -> None:
        self.c_total.set_value(f"{stats.total_signals} / {stats.open_signals}", "Total / Open")
        self.c_wr.set_value(f"{stats.win_rate_pct:.1f}%", f"{stats.winning_signals}W / {stats.losing_signals}L")
        self.c_pnl.set_value(
            f"${stats.net_pnl_usd:+,.2f}",
            f"Average R: {stats.average_r:+.2f}R",
            "#22C55E" if stats.net_pnl_usd >= 0 else "#EF4444",
        )
        self.c_dd.set_value(f"{stats.max_drawdown_pct:.2f}%", f"Profit Factor: {stats.profit_factor:.2f}")
        self.c_split.set_value(
            f"L {stats.long_win_rate_pct:.0f}% / S {stats.short_win_rate_pct:.0f}%",
            f"L ${stats.long_net_pnl_usd:+.0f} | S ${stats.short_net_pnl_usd:+.0f}",
        )

        self.table.setRowCount(len(entries))
        for i, e in enumerate(entries):
            dt = datetime.fromtimestamp(int(e["created_at"]) / 1000.0).strftime("%m-%d %H:%M")
            pnl = e.get("realized_pnl_usd")
            r_val = e.get("realized_r")
            pnl_str = f"${pnl:+.2f} ({r_val:+.2f}R)" if pnl is not None else "OPEN"
            vals = [
                str(e["id"]),
                dt,
                e["symbol"],
                e["direction"],
                format_price(float(e["entry_price"])),
                format_price(float(e["stop_loss"])),
                format_price(float(e["take_profit_2"])),
                str(e["score"]),
                f"1:{float(e['risk_reward']):.2f}",
                e["status"],
                pnl_str,
            ]
            for c, val in enumerate(vals):
                item = QTableWidgetItem(val)
                if c == 3:
                    item.setForeground(QColor("#22C55E" if e["direction"] == "LONG" else "#EF4444"))
                elif c == 10 and pnl is not None:
                    item.setForeground(QColor("#22C55E" if float(pnl) >= 0 else "#EF4444"))
                self.table.setItem(i, c, item)
