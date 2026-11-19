from __future__ import annotations

from PySide6.QtCore import Signal
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDoubleSpinBox,
    QFormLayout,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)

from app.ui.widgets import copy_text_to_clipboard
from app.utils.keyring_store import mask_api_key


class SettingsView(QWidget):
    settings_saved = Signal(dict, str)

    def __init__(self, config: dict, current_api_key: str) -> None:
        super().__init__()
        self._config = config
        self._last_error_text = "No errors logged."

        root = QHBoxLayout(self)
        root.setContentsMargins(16, 16, 16, 16)
        root.setSpacing(14)

        left = QFrame()
        left.setObjectName("Card")
        l_lay = QVBoxLayout(left)
        l_lay.addWidget(QLabel("Market, Scanner & Signal Weights"))

        form = QFormLayout()
        self.cb_mode = QComboBox()
        self.cb_mode.addItems(["FUTURES", "SPOT"])
        self.cb_mode.setCurrentText(config["market"]["default_mode"])

        self.cb_aggr = QComboBox()
        self.cb_aggr.addItems(["CONSERVATIVE", "BALANCED", "AGGRESSIVE"])
        self.cb_aggr.setCurrentText(config["scanner"]["aggressiveness"])

        self.sp_min_vol = QDoubleSpinBox()
        self.sp_min_vol.setRange(100_000, 5_000_000_000)
        self.sp_min_vol.setSingleStep(1_000_000)
        self.sp_min_vol.setValue(float(config["scanner"]["min_volume_24h_usd"]))

        self.sp_min_vola = QDoubleSpinBox()
        self.sp_min_vola.setRange(0.0, 25.0)
        self.sp_min_vola.setValue(float(config["scanner"]["min_volatility_pct"]))

        self.chk_no_stables = QCheckBox("Exclude stablecoins by default")
        self.chk_no_stables.setChecked(bool(config["scanner"]["exclude_stablecoins"]))

        w = config["weights"]
        self.w_trend = QSpinBox()
        self.w_trend.setRange(0, 100)
        self.w_trend.setValue(int(w["trend"]))
        self.w_mom = QSpinBox()
        self.w_mom.setRange(0, 100)
        self.w_mom.setValue(int(w["momentum"]))
        self.w_vol = QSpinBox()
        self.w_vol.setRange(0, 100)
        self.w_vol.setValue(int(w["volume"]))
        self.w_struct = QSpinBox()
        self.w_struct.setRange(0, 100)
        self.w_struct.setValue(int(w["structure"]))
        self.w_flow = QSpinBox()
        self.w_flow.setRange(0, 100)
        self.w_flow.setValue(int(w["order_flow"]))
        self.w_vola = QSpinBox()
        self.w_vola.setRange(0, 100)
        self.w_vola.setValue(int(w["volatility"]))

        form.addRow("Default Market:", self.cb_mode)
        form.addRow("Strategy Aggressiveness:", self.cb_aggr)
        form.addRow("Min 24h Volume (USD):", self.sp_min_vol)
        form.addRow("Min 24h Volatility (%):", self.sp_min_vola)
        form.addRow("", self.chk_no_stables)
        form.addRow("Weight · Trend %:", self.w_trend)
        form.addRow("Weight · Momentum %:", self.w_mom)
        form.addRow("Weight · Volume %:", self.w_vol)
        form.addRow("Weight · Structure %:", self.w_struct)
        form.addRow("Weight · Order Flow %:", self.w_flow)
        form.addRow("Weight · Volatility %:", self.w_vola)
        l_lay.addLayout(form)
        l_lay.addStretch(1)

        right = QFrame()
        right.setObjectName("Card")
        r_lay = QVBoxLayout(right)
        r_lay.addWidget(QLabel("Binance API Key (Optional · Read-Only Only)"))
        lbl_sec = QLabel(
            "Public Binance streams work without an API key. If provided, the key is encrypted locally via Windows DPAPI, "
            "never logged, and never sent to third parties. Withdraw/Transfer/Trade permissions are NOT required in v1."
        )
        lbl_sec.setObjectName("MutedLabel")
        lbl_sec.setWordWrap(True)

        self.lbl_key_status = QLabel(f"Stored Key: {mask_api_key(current_api_key)}")
        self.ed_api_key = QLineEdit()
        self.ed_api_key.setEchoMode(QLineEdit.EchoMode.Password)
        self.ed_api_key.setPlaceholderText("Optional Binance Read-Only API Key (leave blank to keep unchanged)")

        btn_save = QPushButton("Save Settings & Apply")
        btn_save.setObjectName("PrimaryBtn")
        btn_save.clicked.connect(self._save)

        btn_copy_diag = QPushButton("Copy Diagnostic Error Details")
        btn_copy_diag.clicked.connect(lambda: copy_text_to_clipboard(self._last_error_text))

        r_lay.addWidget(lbl_sec)
        r_lay.addWidget(self.lbl_key_status)
        r_lay.addWidget(self.ed_api_key)
        r_lay.addWidget(btn_save)
        r_lay.addWidget(btn_copy_diag)
        r_lay.addStretch(1)

        root.addWidget(left, 1)
        root.addWidget(right, 1)

    def set_last_error(self, err: str) -> None:
        self._last_error_text = err

    def _save(self) -> None:
        cfg = dict(self._config)
        cfg["market"]["default_mode"] = self.cb_mode.currentText()
        cfg["scanner"]["aggressiveness"] = self.cb_aggr.currentText()
        cfg["scanner"]["min_volume_24h_usd"] = self.sp_min_vol.value()
        cfg["scanner"]["min_volatility_pct"] = self.sp_min_vola.value()
        cfg["scanner"]["exclude_stablecoins"] = self.chk_no_stables.isChecked()
        cfg["weights"] = {
            "trend": self.w_trend.value(),
            "momentum": self.w_mom.value(),
            "volume": self.w_vol.value(),
            "structure": self.w_struct.value(),
            "order_flow": self.w_flow.value(),
            "volatility": self.w_vola.value(),
        }
        new_key = self.ed_api_key.text().strip()
        if new_key:
            self.lbl_key_status.setText(f"Stored Key: {mask_api_key(new_key)}")
            self.ed_api_key.clear()
        self.settings_saved.emit(cfg, new_key)
