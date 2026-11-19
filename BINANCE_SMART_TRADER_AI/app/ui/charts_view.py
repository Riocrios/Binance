from __future__ import annotations

from PySide6.QtCore import Signal
from PySide6.QtWidgets import QComboBox, QHBoxLayout, QLabel, QPushButton, QVBoxLayout, QWidget

from app.engines.signal_engine import SignalReport
from app.exchange.market_data import Kline
from app.ui.widgets import LiveCandleChartWidget


class ChartsView(QWidget):
    timeframe_changed = Signal(str)

    def __init__(self) -> None:
        super().__init__()
        root = QVBoxLayout(self)
        root.setContentsMargins(16, 16, 16, 16)
        root.setSpacing(10)

        bar = QHBoxLayout()
        self.lbl_sym = QLabel("LIVE CHARTS · BTCUSDT")
        self.lbl_sym.setObjectName("TitleLabel")
        self.tf_combo = QComboBox()
        self.tf_combo.addItems(["1m", "5m", "15m", "30m", "1h", "4h", "1d"])
        self.tf_combo.setCurrentText("15m")
        self.tf_combo.currentTextChanged.connect(self.timeframe_changed.emit)
        btn_reload = QPushButton("Reload Chart")
        btn_reload.clicked.connect(lambda: self.timeframe_changed.emit(self.tf_combo.currentText()))

        bar.addWidget(self.lbl_sym, 1)
        bar.addWidget(QLabel("Timeframe:"))
        bar.addWidget(self.tf_combo)
        bar.addWidget(btn_reload)
        root.addLayout(bar)

        self.chart = LiveCandleChartWidget()
        root.addWidget(self.chart, 1)

    def update_chart(self, symbol: str, tf: str, klines: list[Kline], rep: SignalReport | None) -> None:
        self.lbl_sym.setText(f"LIVE CHARTS · {symbol} ({tf}) — EMA 9/21/50 + Volume + RSI + MACD + Signal Lines")
        self.chart.render_klines(
            klines,
            entry=rep.entry if rep else None,
            stop_loss=rep.stop_loss if rep else None,
            tp1=rep.take_profit_1 if rep else None,
            tp2=rep.take_profit_2 if rep else None,
            direction=rep.direction if rep else "WAIT",
        )
