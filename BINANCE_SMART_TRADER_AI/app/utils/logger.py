from __future__ import annotations

import logging
import re
from logging.handlers import RotatingFileHandler

from app.config import LOGS_DIR

_SECRET_PATTERN = re.compile(r"(X-MBX-APIKEY|api[_-]?key|secret)['\"]?\s*[:=]\s*['\"]?([A-Za-z0-9]{10,})", re.IGNORECASE)


class SecretMaskingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        if _SECRET_PATTERN.search(msg):
            record.msg = _SECRET_PATTERN.sub(r"\1=***REDACTED***", msg)
            record.args = ()
        return True


def get_logger(name: str = "smart_trader") -> logging.Logger:
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger

    logger.setLevel(logging.INFO)
    log_file = LOGS_DIR / "app.log"
    formatter = logging.Formatter(
        "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    file_handler = RotatingFileHandler(
        log_file, maxBytes=2_000_000, backupCount=4, encoding="utf-8"
    )
    file_handler.setFormatter(formatter)
    file_handler.addFilter(SecretMaskingFilter())

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)
    stream_handler.addFilter(SecretMaskingFilter())

    logger.addHandler(file_handler)
    logger.addHandler(stream_handler)
    return logger
