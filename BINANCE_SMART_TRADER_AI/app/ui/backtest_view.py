from __future__ import annotations

import pyqtgraph as pg
from PySide6.QtCore import Signal
from PySide6.QtWidgets import (
    QComboBox,
    QDoubleSpinBox,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QSpinBox,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from app.engines.backtester import BacktestResult
from app.ui.widgets import MetricCard, attach_table_clipboard
from app.utils.helpers import format_price


class BacktestView(QWidget):
    run_backtest_requested = Signal(dict)

    def __init__(self) -> None:
        super().__init__()
        root = QVBoxLayout(self)
        root.setContentsMargins(16, 16, 16, 16)
        root.setSpacing(12)

        controls = QHBoxLayout()
        self.ed_symbol = QLineEdit("BTCUSDT")
        self.cb_tf = QComboBox()
        self.cb_tf.addItems(["5m", "15m", "1h", "4h"])
        self.cb_tf.setCurrentText("15m")
        self.sp_bars = QSpinBox()
        self.sp_bars.setRange(150, 1000)
        self.sp_bars.setValue(350)
        self.sp_fee = QDoubleSpinBox()
        self.sp_fee.setRange(0.0, 0.5)
        self.sp_fee.setDecimals(3)
        self.sp_fee.setValue(0.05)
        self.sp_slip = QDoubleSpinBox()
        self.sp_slip.setRange(0.0, 0.5)
        self.sp_slip.setDecimals(3)
        self.sp_slip.setValue(0.05)

        btn_run = QPushButton("Run Walk-Forward Backtest")
        btn_run.setObjectName("PrimaryBtn")
        btn_run.clicked.connect(self._emit_run)

        controls.addWidget(QLabel("Symbol:"))
        controls.addWidget(self.ed_symbol)
        controls.addWidget(QLabel("TF:"))
        controls.addWidget(self.cb_tf)
        controls.addWidget(QLabel("Candles:"))
        controls.addWidget(self.sp_bars)
        controls.addWidget(QLabel("Fee %:"))
        controls.addWidget(self.sp_fee)
        controls.addWidget(QLabel("Slip %:"))
        controls.addWidget(self.sp_slip)
        controls.addWidget(btn_run)
        root.addLayout(controls)

        grid = QGridLayout()
        grid.setSpacing(8)
        self.c_overall = MetricCard("Overall Net PnL", "--", "0 trades")
        self.c_is = MetricCard("In-Sample (60%)", "--", "Win Rate / PF")
        self.c_oos = MetricCard("Out-of-Sample (40%)", "--", "Validation Win Rate / PF")
        self.c_dd = MetricCard("Max Drawdown / Avg R", "--", "Zero look-ahead bias")
        grid.addWidget(self.c_overall, 0, 0)
        grid.addWidget(self.c_is, 0, 1)
        grid.addWidget(self.c_oos, 0, 2)
        grid.addWidget(self.c_dd, 0, 3)
        root.addLayout(grid)

        self.equity_plot = pg.PlotWidget()
        self.equity_plot.setBackground("#0F141E")
        self.equity_plot.setMaximumHeight(210)
        self.equity_plot.showGrid(x=True, y=True, alpha=0.15)
        self.equity_plot.setLabel("left", "Equity (USDT)")
        root.addWidget(self.equity_plot)

        self.table = QTableWidget(0, 7)
        self.table.setHorizontalHeaderLabels(["SEGMENT", "DIR", "ENTRY", "EXIT", "PNL $", "R", "REASON"])
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        attach_table_clipboard(self.table)
        root.addWidget(self.table, 1)

    def _emit_run(self) -> None:
        self.run_backtest_requested.emit({
            "symbol": self.ed_symbol.text().strip().upper() or "BTCUSDT",
            "timeframe": self.cb_tf.currentText(),
            "limit": self.sp_bars.value(),
            "commission_pct": self.sp_fee.value(),
            "slippage_pct": self.sp_slip.value(),
        })

    def update_result(self, res: BacktestResult) -> None:
        ov, ins, oos = res.overall, res.in_sample, res.out_of_sample
        self.c_overall.set_value(
            f"${ov.net_pnl_usd:+,.2f}",
            f"{ov.trades} trades · WR {ov.win_rate_pct:.1f}%",
            "#22C55E" if ov.net_pnl_usd >= 0 else "#EF4444",
        )
        self.c_is.set_value(f"${ins.net_pnl_usd:+,.2f}", f"{ins.trades} trades · WR {ins.win_rate_pct:.1f}% · PF {ins.profit_factor:.2f}")
        self.c_oos.set_value(f"${oos.net_pnl_usd:+,.2f}", f"{oos.trades} trades · WR {oos.win_rate_pct:.1f}% · PF {oos.profit_factor:.2f}")
        self.c_dd.set_value(f"{ov.max_drawdown_pct:.2f}%", f"Avg R: {ov.average_r:+.2f}R")

        self.equity_plot.clear()
        if res.equity_curve:
            y = [pt[1] for pt in res.equity_curve]
            x = list(range(len(y)))
            self.equity_plot.plot(x, y, pen=pg.mkPen("#38BDF8", width=2.0))

        self.table.setRowCount(len(res.trades))
        for i, t in enumerate(res.trades):
            vals = [
                t.segment,
                t.direction,
                format_price(t.entry_price),
                format_price(t.exit_price),
                f"${t.pnl_usd:+.2f}",
                f"{t.r_multiple:+.2f}R",
                t.exit_reason,
            ]
            for c, v in enumerate(vals):
                self.table.setItem(i, c, QTableWidgetItem(v))
