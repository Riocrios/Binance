from __future__ import annotations

from PySide6.QtWidgets import QGridLayout, QLabel, QVBoxLayout, QWidget

from app.engines.signal_engine import SignalReport
from app.ui.widgets import MetricCard


class VolumeView(QWidget):
    def __init__(self) -> None:
        super().__init__()
        root = QVBoxLayout(self)
        root.setContentsMargins(16, 16, 16, 16)
        root.setSpacing(12)

        self.title = QLabel("Volume Analyzer (Closed Candles Only)")
        self.title.setObjectName("TitleLabel")
        root.addWidget(self.title)

        grid = QGridLayout()
        grid.setSpacing(10)
        self.c_rvol20 = MetricCard("RVOL (vs 20-bar)", "--", "Relative volume ratio")
        self.c_rvol50 = MetricCard("RVOL (vs 50-bar)", "--", "Longer baseline")
        self.c_spike = MetricCard("Volume Spike", "--", "Anomaly detection")
        self.c_ratio = MetricCard("Buy / Sell Ratio", "--", "Aggressive taker ratio")
        self.c_delta = MetricCard("Cumulative Delta (20)", "--", "Net aggressive flow")
        self.c_regime = MetricCard("Volume Regime", "--", "OBV & Flow classification")

        grid.addWidget(self.c_rvol20, 0, 0)
        grid.addWidget(self.c_rvol50, 0, 1)
        grid.addWidget(self.c_spike, 0, 2)
        grid.addWidget(self.c_ratio, 1, 0)
        grid.addWidget(self.c_delta, 1, 1)
        grid.addWidget(self.c_regime, 1, 2)
        root.addLayout(grid)
        root.addStretch(1)

    def update_signal(self, rep: SignalReport) -> None:
        v = rep.volume
        self.title.setText(f"Volume Analyzer · {rep.symbol} (Closed Candles Only)")
        self.c_rvol20.set_value(f"{v.rvol20:.2f}x", f"Avg 20: {v.avg_volume_20:,.1f}")
        self.c_rvol50.set_value(f"{v.rvol50:.2f}x", f"Avg 50: {v.avg_volume_50:,.1f}")
        self.c_spike.set_value(
            "SPIKE DETECTED" if v.is_spike else "NORMAL",
            f"Last closed vol: {v.current_volume:,.1f}",
            "#F59E0B" if v.is_spike else "#94A3B8",
        )
        self.c_ratio.set_value(
            f"{v.buy_sell_ratio:.2f}x",
            "Buyers > Sellers" if v.buy_sell_ratio > 1.0 else "Sellers > Buyers",
            "#22C55E" if v.buy_sell_ratio > 1.05 else ("#EF4444" if v.buy_sell_ratio < 0.95 else "#94A3B8"),
        )
        self.c_delta.set_value(f"{v.volume_delta:+,.1f}", f"OBV Trend: {v.obv_trend}")
        reg_col = "#22C55E" if v.regime == "ACCUMULATION" else ("#EF4444" if v.regime == "DISTRIBUTION" else "#38BDF8")
        self.c_regime.set_value(v.regime, f"OBV: {v.obv_trend}", reg_col)
