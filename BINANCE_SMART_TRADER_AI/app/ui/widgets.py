from __future__ import annotations

import numpy as np
import pyqtgraph as pg
from PySide6.QtCore import Qt
from PySide6.QtGui import QAction, QColor, QKeySequence, QPainter, QPicture, QShortcut
from PySide6.QtWidgets import (
    QApplication,
    QFrame,
    QLabel,
    QMenu,
    QTableWidget,
    QVBoxLayout,
)

from app.exchange.market_data import Kline
from app.utils.indicators import ema, macd, rsi


def copy_text_to_clipboard(text: str) -> None:
    cb = QApplication.clipboard()
    if cb is not None:
        cb.setText(text)


def attach_table_clipboard(table: QTableWidget) -> None:
    table.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)

    def copy_selection() -> None:
        ranges = table.selectedRanges()
        if not ranges:
            row = table.currentRow()
            if row < 0:
                return
            vals = [table.item(row, c).text() if table.item(row, c) else "" for c in range(table.columnCount())]
            copy_text_to_clipboard("\t".join(vals))
            return
        lines = []
        for r_range in ranges:
            for r in range(r_range.topRow(), r_range.bottomRow() + 1):
                vals = [
                    table.item(r, c).text() if table.item(r, c) else ""
                    for c in range(r_range.leftColumn(), r_range.rightColumn() + 1)
                ]
                lines.append("\t".join(vals))
        copy_text_to_clipboard("\n".join(lines))

    def copy_all() -> None:
        headers = [
            table.horizontalHeaderItem(c).text() if table.horizontalHeaderItem(c) else f"Col{c}"
            for c in range(table.columnCount())
        ]
        rows = ["\t".join(headers)]
        for r in range(table.rowCount()):
            vals = [table.item(r, c).text() if table.item(r, c) else "" for c in range(table.columnCount())]
            rows.append("\t".join(vals))
        copy_text_to_clipboard("\n".join(rows))

    QShortcut(QKeySequence.StandardKey.Copy, table, activated=copy_selection)
    QShortcut(QKeySequence.StandardKey.SelectAll, table, activated=table.selectAll)

    def show_menu(pos) -> None:
        menu = QMenu(table)
        act_copy = QAction("Copy Selected (Ctrl+C)", table)
        act_copy.triggered.connect(copy_selection)
        act_all = QAction("Copy Entire Table (TSV)", table)
        act_all.triggered.connect(copy_all)
        menu.addAction(act_copy)
        menu.addAction(act_all)
        menu.exec(table.viewport().mapToGlobal(pos))

    table.customContextMenuRequested.connect(show_menu)


class MetricCard(QFrame):
    def __init__(self, title: str, initial_value: str = "--", subtitle: str = "") -> None:
        super().__init__()
        self.setObjectName("Card")
        layout = QVBoxLayout(self)
        layout.setContentsMargins(14, 12, 14, 12)
        layout.setSpacing(4)
        self.title_lbl = QLabel(title)
        self.title_lbl.setObjectName("MutedLabel")
        self.value_lbl = QLabel(initial_value)
        self.value_lbl.setObjectName("MonoMetric")
        self.sub_lbl = QLabel(subtitle)
        self.sub_lbl.setObjectName("MutedLabel")
        layout.addWidget(self.title_lbl)
        layout.addWidget(self.value_lbl)
        layout.addWidget(self.sub_lbl)

    def set_value(self, value: str, subtitle: str = "", color: str | None = None) -> None:
        self.value_lbl.setText(value)
        self.sub_lbl.setText(subtitle)
        if color:
            self.value_lbl.setStyleSheet(f"color: {color};")
        else:
            self.value_lbl.setStyleSheet("")


class _CandlestickItem(pg.GraphicsObject):
    def __init__(self, data: list[tuple[int, float, float, float, float]]) -> None:
        super().__init__()
        self.data = data
        self.picture = QPicture()
        self._generate_picture()

    def _generate_picture(self) -> None:
        painter = QPainter(self.picture)
        w = 0.34
        for idx, o, c, lo, hi in self.data:
            bull = c >= o
            color = QColor("#22C55E") if bull else QColor("#EF4444")
            painter.setPen(pg.mkPen(color, width=1.1))
            painter.setBrush(pg.mkBrush(color))
            painter.drawLine(pg.QtCore.QPointF(idx, lo), pg.QtCore.QPointF(idx, hi))
            top = max(o, c)
            bot = min(o, c)
            h = max(top - bot, max(abs(o) * 0.0002, 1e-8))
            painter.drawRect(pg.QtCore.QRectF(idx - w, bot, w * 2, h))
        painter.end()

    def paint(self, painter, *_args) -> None:
        painter.drawPicture(0, 0, self.picture)

    def boundingRect(self):
        return pg.QtCore.QRectF(self.picture.boundingRect())


class LiveCandleChartWidget(pg.GraphicsLayoutWidget):
    def __init__(self) -> None:
        super().__init__()
        self.setBackground("#0F141E")
        self.price_plot = self.addPlot(row=0, col=0)
        self.price_plot.showGrid(x=True, y=True, alpha=0.16)
        self.price_plot.setLabel("left", "Price")

        self.vol_plot = self.addPlot(row=1, col=0)
        self.vol_plot.setMaximumHeight(95)
        self.vol_plot.showGrid(x=True, y=True, alpha=0.12)
        self.vol_plot.setLabel("left", "Vol")
        self.vol_plot.setXLink(self.price_plot)

        self.rsi_plot = self.addPlot(row=2, col=0)
        self.rsi_plot.setMaximumHeight(95)
        self.rsi_plot.showGrid(x=True, y=True, alpha=0.12)
        self.rsi_plot.setLabel("left", "RSI/MACD")
        self.rsi_plot.setXLink(self.price_plot)

    def render_klines(
        self,
        klines: list[Kline],
        entry: float | None = None,
        stop_loss: float | None = None,
        tp1: float | None = None,
        tp2: float | None = None,
        direction: str = "WAIT",
    ) -> None:
        self.price_plot.clear()
        self.vol_plot.clear()
        self.rsi_plot.clear()
        if len(klines) < 10:
            return

        view = klines[-120:]
        x = np.arange(len(view), dtype=float)
        closes = np.array([k.close for k in view], dtype=float)
        vols = np.array([k.volume for k in view], dtype=float)

        candle_tuples = [(i, k.open, k.close, k.low, k.high) for i, k in enumerate(view)]
        self.price_plot.addItem(_CandlestickItem(candle_tuples))

        e9 = ema(closes, 9)
        e21 = ema(closes, 21)
        e50 = ema(closes, 50)
        for arr, color in ((e9, "#38BDF8"), (e21, "#F59E0B"), (e50, "#A855F7")):
            valid = ~np.isnan(arr)
            if np.any(valid):
                self.price_plot.plot(x[valid], arr[valid], pen=pg.mkPen(color, width=1.4))

        if direction != "WAIT" and entry and stop_loss and tp1 and tp2:
            self.price_plot.addItem(pg.InfiniteLine(pos=entry, angle=0, pen=pg.mkPen("#38BDF8", width=1.4, style=Qt.PenStyle.DashLine)))
            self.price_plot.addItem(pg.InfiniteLine(pos=stop_loss, angle=0, pen=pg.mkPen("#EF4444", width=1.4, style=Qt.PenStyle.DashLine)))
            self.price_plot.addItem(pg.InfiniteLine(pos=tp1, angle=0, pen=pg.mkPen("#22C55E", width=1.2, style=Qt.PenStyle.DotLine)))
            self.price_plot.addItem(pg.InfiniteLine(pos=tp2, angle=0, pen=pg.mkPen("#10B981", width=1.4, style=Qt.PenStyle.DashLine)))

        brushes = [QColor("#22C55E") if k.close >= k.open else QColor("#EF4444") for k in view]
        bars = pg.BarGraphItem(x=x, height=vols, width=0.65, brushes=brushes)
        self.vol_plot.addItem(bars)

        rsi_arr = rsi(closes, 14)
        valid_r = ~np.isnan(rsi_arr)
        if np.any(valid_r):
            self.rsi_plot.plot(x[valid_r], rsi_arr[valid_r], pen=pg.mkPen("#38BDF8", width=1.4))
            self.rsi_plot.addItem(pg.InfiniteLine(pos=70, angle=0, pen=pg.mkPen("#EF4444", width=0.8, style=Qt.PenStyle.DotLine)))
            self.rsi_plot.addItem(pg.InfiniteLine(pos=30, angle=0, pen=pg.mkPen("#22C55E", width=0.8, style=Qt.PenStyle.DotLine)))

        _, _, mh = macd(closes)
        valid_m = ~np.isnan(mh)
        if np.any(valid_m):
            m_norm = 50.0 + (mh[valid_m] / max(1e-9, float(np.max(np.abs(mh[valid_m]))))) * 22.0
            self.rsi_plot.plot(x[valid_m], m_norm, pen=pg.mkPen("#F59E0B", width=1.0))
