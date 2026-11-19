from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from app.utils.logger import get_logger

logger = get_logger("database")


class DatabaseManager:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            conn = sqlite3.connect(
                str(self.db_path),
                timeout=15.0,
                check_same_thread=False,
            )
            conn.row_factory = sqlite3.Row
            try:
                conn.execute("PRAGMA journal_mode=WAL;")
                conn.execute("PRAGMA foreign_keys=ON;")
                yield conn
                conn.commit()
            except sqlite3.Error as exc:
                conn.rollback()
                logger.error("SQLite transaction error: %s", exc)
                raise
            finally:
                conn.close()

    def initialize(self) -> None:
        with self.connection() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS trade_journal (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at INTEGER NOT NULL,
                    symbol TEXT NOT NULL,
                    market_mode TEXT NOT NULL,
                    direction TEXT NOT NULL CHECK(direction IN ('LONG', 'SHORT')),
                    entry_price REAL NOT NULL,
                    stop_loss REAL NOT NULL,
                    take_profit_1 REAL NOT NULL,
                    take_profit_2 REAL NOT NULL,
                    score INTEGER NOT NULL,
                    risk_reward REAL NOT NULL,
                    position_size_qty REAL NOT NULL,
                    notional_usd REAL NOT NULL,
                    fees_usd REAL NOT NULL DEFAULT 0.0,
                    slippage_usd REAL NOT NULL DEFAULT 0.0,
                    status TEXT NOT NULL DEFAULT 'OPEN',
                    exit_price REAL,
                    closed_at INTEGER,
                    hold_duration_ms INTEGER,
                    close_reason TEXT,
                    realized_pnl_usd REAL,
                    realized_r REAL,
                    notes TEXT DEFAULT ''
                );

                CREATE TABLE IF NOT EXISTS signal_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at INTEGER NOT NULL,
                    symbol TEXT NOT NULL,
                    market_mode TEXT NOT NULL,
                    direction TEXT NOT NULL,
                    long_score INTEGER NOT NULL,
                    short_score INTEGER NOT NULL,
                    entry_price REAL NOT NULL,
                    stop_loss REAL NOT NULL,
                    take_profit_2 REAL NOT NULL,
                    risk_reward REAL NOT NULL,
                    entry_state TEXT NOT NULL,
                    reasons_json TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_journal_status ON trade_journal(status);
                CREATE INDEX IF NOT EXISTS idx_journal_created ON trade_journal(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_signals_created ON signal_history(created_at DESC);
                """
            )
