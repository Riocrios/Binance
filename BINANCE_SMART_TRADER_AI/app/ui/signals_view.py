from __future__ import annotations

from PySide6.QtCore import Signal
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QPlainTextEdit,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from app.engines.signal_engine import SignalReport
from app.ui.widgets import attach_table_clipboard, copy_text_to_clipboard
from app.utils.helpers import format_price


class SignalsView(QWidget):
    log_to_journal_requested = Signal(object)

    def __init__(self) -> None:
        super().__init__()
        self._current_report: SignalReport | None = None

        root = QVBoxLayout(self)
        root.setContentsMargins(16, 16, 16, 16)
        root.setSpacing(12)

        header = QHBoxLayout()
        self.lbl_header = QLabel("AI Signal Analysis: Select a symbol")
        self.lbl_header.setObjectName("TitleLabel")
        self.btn_copy_signal = QPushButton("Copy Full Signal")
        self.btn_copy_levels = QPushButton("Copy Entry / SL / TP")
        self.btn_log_journal = QPushButton("Save Virtual Signal to Journal")
        self.btn_log_journal.setObjectName("PrimaryBtn")
        self.btn_copy_signal.clicked.connect(self._copy_full)
        self.btn_copy_levels.clicked.connect(self._copy_levels)
        self.btn_log_journal.clicked.connect(self._emit_journal)
        header.addWidget(self.lbl_header, 1)
        header.addWidget(self.btn_copy_levels)
        header.addWidget(self.btn_copy_signal)
        header.addWidget(self.btn_log_journal)
        root.addLayout(header)

        grid = QGridLayout()
        grid.setSpacing(12)

        # Left summary card
        summary_card = QFrame()
        summary_card.setObjectName("Card")
        s_lay = QVBoxLayout(summary_card)
        self.lbl_direction = QLabel("DIRECTION: WAIT")
        self.lbl_direction.setObjectName("MonoMetric")
        self.lbl_scores = QLabel("LONG Score: --/100 | SHORT Score: --/100")
        self.lbl_levels = QLabel("ENTRY: -- | SL: -- | TP1: -- | TP2: -- | TP3: -- | R/R: --")
        self.lbl_levels.setWordWrap(True)
        self.lbl_note = QLabel("Note: Score reflects multi-factor indicator confluence, not a mathematical probability of profit.")
        self.lbl_note.setObjectName("MutedLabel")
        self.lbl_note.setWordWrap(True)

        self.txt_reasons = QPlainTextEdit()
        self.txt_reasons.setReadOnly(True)
        s_lay.addWidget(self.lbl_direction)
        s_lay.addWidget(self.lbl_scores)
        s_lay.addWidget(self.lbl_levels)
        s_lay.addWidget(self.lbl_note)
        s_lay.addWidget(QLabel("Reasons, Exit Rules & Invalidation:"))
        s_lay.addWidget(self.txt_reasons, 1)

        # Right breakdown + MTF
        right_card = QFrame()
        right_card.setObjectName("Card")
        r_lay = QVBoxLayout(right_card)
        r_lay.addWidget(QLabel("6-Factor Score Breakdown (0-100)"))
        self.breakdown_table = QTableWidget(6, 3)
        self.breakdown_table.setHorizontalHeaderLabels(["FACTOR", "LONG", "SHORT"])
        self.breakdown_table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        attach_table_clipboard(self.breakdown_table)
        r_lay.addWidget(self.breakdown_table)

        r_lay.addWidget(QLabel("Multi-Timeframe Alignment (1m - 1d)"))
        self.mtf_table = QTableWidget(0, 5)
        self.mtf_table.setHorizontalHeaderLabels(["TF", "DIRECTION", "EMA ALIGN", "RSI 14", "MACD HIST"])
        self.mtf_table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        attach_table_clipboard(self.mtf_table)
        r_lay.addWidget(self.mtf_table)

        grid.addWidget(summary_card, 0, 0)
        grid.addWidget(right_card, 0, 1)
        root.addLayout(grid, 1)

    def update_signal(self, rep: SignalReport) -> None:
        self._current_report = rep
        self.lbl_header.setText(f"{rep.symbol} ({rep.market_mode}) · State: {rep.entry_state}")
        color = "#22C55E" if rep.direction == "LONG" else ("#EF4444" if rep.direction == "SHORT" else "#F59E0B")
        self.lbl_direction.setText(f"DIRECTION: {rep.direction}  |  STATE: {rep.entry_state}")
        self.lbl_direction.setStyleSheet(f"color: {color}; font-size: 18px; font-weight: 700;")
        self.lbl_scores.setText(f"LONG SCORE: {rep.long_score}/100  |  SHORT SCORE: {rep.short_score}/100  |  RISK/REWARD: 1:{rep.risk_reward}")
        self.lbl_levels.setText(
            f"ENTRY: {format_price(rep.entry)}   |   STOP LOSS: {format_price(rep.stop_loss)}   |   "
            f"TP1: {format_price(rep.take_profit_1)}   |   TP2: {format_price(rep.take_profit_2)}   |   TP3: {format_price(rep.take_profit_3)}"
        )

        lines = ["REASONS:"] + [f"- {r}" for r in rep.reasons]
        if rep.warnings:
            lines += ["", "WARNINGS:"] + [f"! {w}" for w in rep.warnings]
        lines += [
            "",
            f"INVALIDATION: {rep.invalidation}",
            "",
            "SMART EXIT PLAN:",
            *[f"- {p}" for p in rep.exit_plan.partial_close_rules],
            *[f"- {f}" for f in rep.exit_plan.full_exit_rules],
        ]
        self.txt_reasons.setPlainText("\n".join(lines))

        factors = [
            ("Trend (25%)", rep.breakdown["trend_long"], rep.breakdown["trend_short"]),
            ("Momentum (20%)", rep.breakdown["momentum_long"], rep.breakdown["momentum_short"]),
            ("Volume (20%)", rep.breakdown["volume_long"], rep.breakdown["volume_short"]),
            ("Structure (15%)", rep.breakdown["structure_long"], rep.breakdown["structure_short"]),
            ("Order Flow (10%)", rep.breakdown["order_flow_long"], rep.breakdown["order_flow_short"]),
            ("Volatility (10%)", rep.breakdown["volatility_long"], rep.breakdown["volatility_short"]),
        ]
        for idx, (name, lv, sv) in enumerate(factors):
            self.breakdown_table.setItem(idx, 0, QTableWidgetItem(name))
            self.breakdown_table.setItem(idx, 1, QTableWidgetItem(str(lv)))
            self.breakdown_table.setItem(idx, 2, QTableWidgetItem(str(sv)))

        self.mtf_table.setRowCount(len(rep.timeframe_biases))
        for i, b in enumerate(rep.timeframe_biases):
            self.mtf_table.setItem(i, 0, QTableWidgetItem(b.timeframe))
            d_item = QTableWidgetItem(b.direction)
            d_item.setForeground(QColor("#22C55E" if b.direction == "LONG" else ("#EF4444" if b.direction == "SHORT" else "#94A3B8")))
            self.mtf_table.setItem(i, 1, d_item)
            self.mtf_table.setItem(i, 2, QTableWidgetItem(b.ema_alignment))
            self.mtf_table.setItem(i, 3, QTableWidgetItem(f"{b.rsi:.1f}"))
            self.mtf_table.setItem(i, 4, QTableWidgetItem(f"{b.macd_hist:+.5f}"))

    def _copy_levels(self) -> None:
        if not self._current_report:
            return
        r = self._current_report
        copy_text_to_clipboard(
            f"{r.symbol} {r.direction} | ENTRY: {format_price(r.entry)} | SL: {format_price(r.stop_loss)} | TP1: {format_price(r.take_profit_1)} | TP2: {format_price(r.take_profit_2)}"
        )

    def _copy_full(self) -> None:
        if not self._current_report:
            return
        r = self._current_report
        text = (
            f"{r.symbol} ({r.market_mode})\n"
            f"DIRECTION: {r.direction}\n"
            f"ENTRY: {format_price(r.entry)}\n"
            f"STOP LOSS: {format_price(r.stop_loss)}\n"
            f"TAKE PROFIT 1: {format_price(r.take_profit_1)}\n"
            f"TAKE PROFIT 2: {format_price(r.take_profit_2)}\n"
            f"SCORE: {r.active_score}/100 | R/R: 1:{r.risk_reward}\n"
            f"REASONS:\n" + "\n".join(f"- {x}" for x in r.reasons) +
            f"\nINVALIDATION: {r.invalidation}"
        )
        copy_text_to_clipboard(text)

    def _emit_journal(self) -> None:
        if self._current_report and self._current_report.direction != "WAIT":
            self.log_to_journal_requested.emit(self._current_report)
