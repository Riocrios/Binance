from __future__ import annotations

from PySide6.QtCore import Signal
from PySide6.QtWidgets import (
    QDoubleSpinBox,
    QFormLayout,
    QFrame,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)

from app.engines.risk_manager import evaluate_risk
from app.engines.signal_engine import SignalReport


class RiskView(QWidget):
    risk_config_saved = Signal(dict)

    def __init__(self, risk_cfg: dict) -> None:
        super().__init__()
        self._cfg = dict(risk_cfg)
        self._last_signal: SignalReport | None = None
        self._last_spread = 0.02

        root = QHBoxLayout(self)
        root.setContentsMargins(16, 16, 16, 16)
        root.setSpacing(14)

        left_card = QFrame()
        left_card.setObjectName("Card")
        form_wrap = QVBoxLayout(left_card)
        lbl = QLabel("Risk Manager Parameters")
        lbl.setObjectName("SectionTitle")
        form_wrap.addWidget(lbl)

        form = QFormLayout()
        self.sp_balance = QDoubleSpinBox()
        self.sp_balance.setRange(50, 10_000_000)
        self.sp_balance.setValue(float(self._cfg.get("virtual_balance", 10000)))
        self.sp_risk = QDoubleSpinBox()
        self.sp_risk.setRange(0.1, 10.0)
        self.sp_risk.setSingleStep(0.1)
        self.sp_risk.setValue(float(self._cfg.get("risk_per_trade_pct", 1.0)))
        self.sp_daily = QDoubleSpinBox()
        self.sp_daily.setRange(0.5, 50.0)
        self.sp_daily.setValue(float(self._cfg.get("max_daily_loss_pct", 4.0)))
        self.sp_max_pos = QSpinBox()
        self.sp_max_pos.setRange(1, 20)
        self.sp_max_pos.setValue(int(self._cfg.get("max_open_positions", 4)))
        self.sp_min_rr = QDoubleSpinBox()
        self.sp_min_rr.setRange(1.0, 10.0)
        self.sp_min_rr.setSingleStep(0.1)
        self.sp_min_rr.setValue(float(self._cfg.get("min_risk_reward", 1.8)))
        self.sp_spread = QDoubleSpinBox()
        self.sp_spread.setRange(0.01, 2.0)
        self.sp_spread.setDecimals(3)
        self.sp_spread.setValue(float(self._cfg.get("max_spread_pct", 0.15)))
        self.sp_slip = QDoubleSpinBox()
        self.sp_slip.setRange(0.0, 1.0)
        self.sp_slip.setDecimals(3)
        self.sp_slip.setValue(float(self._cfg.get("max_slippage_pct", 0.08)))
        self.sp_lev = QSpinBox()
        self.sp_lev.setRange(1, 50)
        self.sp_lev.setValue(int(self._cfg.get("leverage", 5)))

        for w in (self.sp_balance, self.sp_risk, self.sp_daily, self.sp_max_pos, self.sp_min_rr, self.sp_spread, self.sp_slip, self.sp_lev):
            w.valueChanged.connect(self._recalculate)

        form.addRow("Virtual Balance (USDT):", self.sp_balance)
        form.addRow("Risk per Trade (%):", self.sp_risk)
        form.addRow("Max Daily Loss (%):", self.sp_daily)
        form.addRow("Max Open Positions:", self.sp_max_pos)
        form.addRow("Min Risk/Reward:", self.sp_min_rr)
        form.addRow("Max Spread (%):", self.sp_spread)
        form.addRow("Max Slippage (%):", self.sp_slip)
        form.addRow("Leverage Scenario (x):", self.sp_lev)
        form_wrap.addLayout(form)

        btn_save = QPushButton("Save Risk Parameters")
        btn_save.setObjectName("PrimaryBtn")
        btn_save.clicked.connect(self._save)
        form_wrap.addWidget(btn_save)
        form_wrap.addStretch(1)

        right_card = QFrame()
        right_card.setObjectName("Card")
        r_lay = QVBoxLayout(right_card)
        r_title = QLabel("Live Position Sizing & Cost Simulation")
        r_title.setObjectName("SectionTitle")
        self.lbl_output = QLabel("Waiting for active signal...")
        self.lbl_output.setWordWrap(True)
        self.lbl_output.setObjectName("MonoMetric")
        self.lbl_details = QLabel("")
        self.lbl_details.setWordWrap(True)
        r_lay.addWidget(r_title)
        r_lay.addWidget(self.lbl_output)
        r_lay.addWidget(self.lbl_details)
        r_lay.addStretch(1)

        root.addWidget(left_card, 1)
        root.addWidget(right_card, 1)

    def current_config(self) -> dict:
        return {
            "virtual_balance": self.sp_balance.value(),
            "risk_per_trade_pct": self.sp_risk.value(),
            "max_daily_loss_pct": self.sp_daily.value(),
            "max_open_positions": self.sp_max_pos.value(),
            "min_risk_reward": self.sp_min_rr.value(),
            "max_spread_pct": self.sp_spread.value(),
            "max_slippage_pct": self.sp_slip.value(),
            "leverage": self.sp_lev.value(),
            "taker_fee_pct": float(self._cfg.get("taker_fee_pct", 0.05)),
            "funding_rate_pct_8h": float(self._cfg.get("funding_rate_pct_8h", 0.01)),
        }

    def _save(self) -> None:
        self._cfg = self.current_config()
        self.risk_config_saved.emit(self._cfg)
        self._recalculate()

    def update_signal(self, sig: SignalReport, spread_pct: float = 0.02) -> None:
        self._last_signal = sig
        self._last_spread = spread_pct
        self._recalculate()

    def _recalculate(self) -> None:
        if not self._last_signal:
            return
        sig = self._last_signal
        cfg = self.current_config()
        ev = evaluate_risk(
            direction=sig.direction,
            entry=sig.entry,
            stop_loss=sig.stop_loss,
            take_profit_1=sig.take_profit_1,
            take_profit_2=sig.take_profit_2,
            spread_pct=self._last_spread,
            open_positions_count=0,
            daily_loss_usd=0.0,
            risk_cfg=cfg,
        )
        status = "APPROVED" if ev.approved else "REJECTED"
        color = "#22C55E" if ev.approved else "#EF4444"
        self.lbl_output.setText(f"{sig.symbol} ({sig.direction}) · {status}")
        self.lbl_output.setStyleSheet(f"color: {color}; font-size: 16px; font-weight: 700;")

        lines = [
            f"Position Size: {ev.position_size_qty:.6f} {sig.symbol.replace('USDT', '')}",
            f"Notional Value: ${ev.notional_value_usd:,.2f}  |  Required Margin ({cfg['leverage']}x): ${ev.required_margin_usd:,.2f}",
            f"Risk Amount (1R): ${ev.risk_amount_usd:,.2f}  |  Stop Distance: {ev.stop_distance_pct:.3f}%",
            f"Fees (Entry+Exit): ${ev.entry_fee_usd + ev.exit_fee_usd:,.2f}  |  Slippage: ${ev.slippage_usd:,.2f}  |  Funding: ${ev.funding_usd:,.2f}",
            f"Net Profit at TP1: +${ev.net_profit_tp1_usd:,.2f}  |  Net Profit at TP2: +${ev.net_profit_tp2_usd:,.2f}",
            f"Net Max Loss at SL: -${ev.net_max_loss_usd:,.2f}  |  Net Effective R:R: 1:{ev.effective_rr:.2f}",
        ]
        if ev.rejection_reasons:
            lines.append("\nRejection Reasons:")
            lines.extend(f"- {r}" for r in ev.rejection_reasons)
        self.lbl_details.setText("\n".join(lines))
