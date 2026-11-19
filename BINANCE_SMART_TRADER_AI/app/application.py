from __future__ import annotations

import sys
import traceback
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QApplication, QMessageBox

from app.ui.main_window import MainWindow
from app.utils.logger import get_logger

logger = get_logger("application")


def run_app() -> int:
    QApplication.setHighDpiScaleFactorRoundingPolicy(
        Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
    )
    app = QApplication(sys.argv)
    app.setApplicationName("BINANCE SMART TRADER AI")
    app.setOrganizationName("BinanceSmartTraderAI")

    qss_path = Path(__file__).resolve().parent / "ui" / "styles.qss"
    if qss_path.exists():
        app.setStyleSheet(qss_path.read_text(encoding="utf-8"))

    def handle_exception(exc_type, exc_value, exc_tb) -> None:
        tb_text = "".join(traceback.format_exception(exc_type, exc_value, exc_tb))
        logger.critical("Unhandled GUI exception:\n%s", tb_text)
        QMessageBox.critical(
            None,
            "BINANCE SMART TRADER AI — Error",
            f"An unexpected error occurred:\n{exc_value}\n\nDetails logged to logs/app.log.",
        )

    sys.excepthook = handle_exception

    window = MainWindow()
    window.show()
    return app.exec()
