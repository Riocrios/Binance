from __future__ import annotations

from PySide6.QtWidgets import QGridLayout, QLabel, QVBoxLayout, QWidget

from app.engines.signal_engine import SignalReport
from app.ui.widgets import MetricCard


class MomentumView(QWidget):
    def __init__(self) -> None:
        super().__init__()
        root = QVBoxLayout(self)
        root.setContentsMargins(16, 16, 16, 16)
        root.setSpacing(12)

        self.title = QLabel("Momentum Engine")
        self.title.setObjectName("TitleLabel")
        root.addWidget(self.title)

        grid = QGridLayout()
        grid.setSpacing(10)
        self.c_strength = MetricCard("Momentum Strength", "--", "WEAK / MODERATE / STRONG / EXTREME")
        self.c_rsi = MetricCard("RSI (14)", "--", "Divergence: NONE")
        self.c_macd = MetricCard("MACD / Histogram", "--", "Divergence: NONE")
        self.c_stoch = MetricCard("Stochastic RSI (K / D)", "--", "Oscillator posture")
        self.c_roc = MetricCard("Rate of Change (10)", "--", "Price acceleration %")
        self.c_exhaust = MetricCard("Exhaustion Monitor", "CLEAR", "No reversal warning")

        grid.addWidget(self.c_strength, 0, 0)
        grid.addWidget(self.c_rsi, 0, 1)
        grid.addWidget(self.c_macd, 0, 2)
        grid.addWidget(self.c_stoch, 1, 0)
        grid.addWidget(self.c_roc, 1, 1)
        grid.addWidget(self.c_exhaust, 1, 2)
        root.addLayout(grid)
        root.addStretch(1)

    def update_signal(self, rep: SignalReport) -> None:
        m = rep.momentum
        self.title.setText(f"Momentum Engine · {rep.symbol}")
        col = "#22C55E" if m.strength in ("STRONG", "EXTREME") else ("#38BDF8" if m.strength == "MODERATE" else "#94A3B8")
        self.c_strength.set_value(m.strength, f"Active Direction: {rep.direction}", col)
        self.c_rsi.set_value(f"{m.rsi14:.2f}", f"RSI Divergence: {m.rsi_divergence}")
        self.c_macd.set_value(f"{m.macd_hist:+.5f}", f"MACD: {m.macd_line:+.5f} · Div: {m.macd_divergence}")
        self.c_stoch.set_value(f"{m.stoch_rsi_k:.1f} / {m.stoch_rsi_d:.1f}", "StochRSI K / D")
        self.c_roc.set_value(f"{m.roc10:+.2f}%", "10-bar Rate of Change")
        if m.exhaustion_warning:
            self.c_exhaust.set_value("WARNING", m.exhaustion_warning, "#F59E0B")
        else:
            self.c_exhaust.set_value("NOMINAL", "No exhaustion divergence detected", "#22C55E")
