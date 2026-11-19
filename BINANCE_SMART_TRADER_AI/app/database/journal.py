from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any

from app.database.database import DatabaseManager


@dataclass
class JournalStats:
    total_signals: int
    open_signals: int
    winning_signals: int
    losing_signals: int
    win_rate_pct: float
    average_r: float
    net_pnl_usd: float
    max_drawdown_pct: float
    profit_factor: float
    long_win_rate_pct: float
    long_net_pnl_usd: float
    short_win_rate_pct: float
    short_net_pnl_usd: float


class TradeJournalRepository:
    def __init__(self, db: DatabaseManager) -> None:
        self.db = db

    def log_signal_snapshot(
        self,
        symbol: str,
        market_mode: str,
        direction: str,
        long_score: int,
        short_score: int,
        entry_price: float,
        stop_loss: float,
        take_profit_2: float,
        risk_reward: float,
        entry_state: str,
        reasons: list[str],
    ) -> int:
        now_ms = int(time.time() * 1000)
        with self.db.connection() as conn:
            cur = conn.execute(
                """
                INSERT INTO signal_history (
                    created_at, symbol, market_mode, direction, long_score, short_score,
                    entry_price, stop_loss, take_profit_2, risk_reward, entry_state, reasons_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    now_ms, symbol, market_mode, direction, long_score, short_score,
                    entry_price, stop_loss, take_profit_2, risk_reward, entry_state,
                    json.dumps(reasons, ensure_ascii=False),
                ),
            )
            return int(cur.lastrowid)

    def add_journal_entry(
        self,
        symbol: str,
        market_mode: str,
        direction: str,
        entry_price: float,
        stop_loss: float,
        take_profit_1: float,
        take_profit_2: float,
        score: int,
        risk_reward: float,
        position_size_qty: float,
        notional_usd: float,
        fees_usd: float,
        slippage_usd: float,
        notes: str = "",
    ) -> int:
        now_ms = int(time.time() * 1000)
        with self.db.connection() as conn:
            cur = conn.execute(
                """
                INSERT INTO trade_journal (
                    created_at, symbol, market_mode, direction, entry_price, stop_loss,
                    take_profit_1, take_profit_2, score, risk_reward, position_size_qty,
                    notional_usd, fees_usd, slippage_usd, status, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)
                """,
                (
                    now_ms, symbol, market_mode, direction, entry_price, stop_loss,
                    take_profit_1, take_profit_2, score, risk_reward, position_size_qty,
                    notional_usd, fees_usd, slippage_usd, notes,
                ),
            )
            return int(cur.lastrowid)

    def close_entry(
        self,
        entry_id: int,
        exit_price: float,
        status: str,
        close_reason: str,
    ) -> None:
        now_ms = int(time.time() * 1000)
        with self.db.connection() as conn:
            row = conn.execute(
                "SELECT * FROM trade_journal WHERE id = ?", (entry_id,)
            ).fetchone()
            if not row:
                return
            direction = row["direction"]
            entry_price = float(row["entry_price"])
            stop_loss = float(row["stop_loss"])
            qty = float(row["position_size_qty"])
            fees = float(row["fees_usd"])
            slip = float(row["slippage_usd"])
            created_at = int(row["created_at"])

            raw_pnl = (
                (exit_price - entry_price) * qty
                if direction == "LONG"
                else (entry_price - exit_price) * qty
            )
            net_pnl = raw_pnl - fees - slip
            risk_usd = abs(entry_price - stop_loss) * qty
            r_mult = net_pnl / risk_usd if risk_usd > 0 else 0.0
            hold_ms = max(0, now_ms - created_at)

            conn.execute(
                """
                UPDATE trade_journal
                SET status = ?, exit_price = ?, closed_at = ?, hold_duration_ms = ?,
                    close_reason = ?, realized_pnl_usd = ?, realized_r = ?
                WHERE id = ?
                """,
                (status, exit_price, now_ms, hold_ms, close_reason, net_pnl, r_mult, entry_id),
            )

    def evaluate_open_entries(self, latest_prices: dict[str, float]) -> int:
        updated = 0
        with self.db.connection() as conn:
            rows = conn.execute(
                "SELECT * FROM trade_journal WHERE status = 'OPEN'"
            ).fetchall()
        for row in rows:
            sym = row["symbol"]
            price = latest_prices.get(sym)
            if price is None or price <= 0:
                continue
            direction = row["direction"]
            sl = float(row["stop_loss"])
            tp2 = float(row["take_profit_2"])
            if direction == "LONG":
                if price <= sl:
                    self.close_entry(int(row["id"]), sl, "SL_HIT", "Stop Loss triggered by live price")
                    updated += 1
                elif price >= tp2:
                    self.close_entry(int(row["id"]), tp2, "TP2_HIT", "Take Profit 2 target reached")
                    updated += 1
            else:
                if price >= sl:
                    self.close_entry(int(row["id"]), sl, "SL_HIT", "Stop Loss triggered by live price")
                    updated += 1
                elif price <= tp2:
                    self.close_entry(int(row["id"]), tp2, "TP2_HIT", "Take Profit 2 target reached")
                    updated += 1
        return updated

    def delete_entry(self, entry_id: int) -> None:
        with self.db.connection() as conn:
            conn.execute("DELETE FROM trade_journal WHERE id = ?", (entry_id,))

    def list_entries(self, limit: int = 200) -> list[dict[str, Any]]:
        with self.db.connection() as conn:
            rows = conn.execute(
                "SELECT * FROM trade_journal ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
            return [dict(r) for r in rows]

    def compute_stats(self, starting_balance: float = 10000.0) -> JournalStats:
        entries = self.list_entries(limit=1000)
        closed = [e for e in entries if e["status"] != "OPEN" and e["realized_pnl_usd"] is not None]
        open_count = sum(1 for e in entries if e["status"] == "OPEN")
        if not closed:
            return JournalStats(
                total_signals=len(entries),
                open_signals=open_count,
                winning_signals=0,
                losing_signals=0,
                win_rate_pct=0.0,
                average_r=0.0,
                net_pnl_usd=0.0,
                max_drawdown_pct=0.0,
                profit_factor=0.0,
                long_win_rate_pct=0.0,
                long_net_pnl_usd=0.0,
                short_win_rate_pct=0.0,
                short_net_pnl_usd=0.0,
            )

        wins = [e for e in closed if float(e["realized_pnl_usd"]) > 0]
        losses = [e for e in closed if float(e["realized_pnl_usd"]) <= 0]
        gross_win = sum(float(e["realized_pnl_usd"]) for e in wins)
        gross_loss = abs(sum(float(e["realized_pnl_usd"]) for e in losses))
        net_pnl = sum(float(e["realized_pnl_usd"]) for e in closed)
        avg_r = sum(float(e["realized_r"] or 0.0) for e in closed) / len(closed)

        eq = starting_balance
        peak = starting_balance
        max_dd = 0.0
        for e in reversed(closed):
            eq += float(e["realized_pnl_usd"])
            if eq > peak:
                peak = eq
            dd = ((peak - eq) / peak) * 100.0 if peak > 0 else 0.0
            if dd > max_dd:
                max_dd = dd

        long_closed = [e for e in closed if e["direction"] == "LONG"]
        short_closed = [e for e in closed if e["direction"] == "SHORT"]
        long_wr = (sum(1 for e in long_closed if float(e["realized_pnl_usd"]) > 0) / len(long_closed) * 100.0) if long_closed else 0.0
        short_wr = (sum(1 for e in short_closed if float(e["realized_pnl_usd"]) > 0) / len(short_closed) * 100.0) if short_closed else 0.0

        return JournalStats(
            total_signals=len(entries),
            open_signals=open_count,
            winning_signals=len(wins),
            losing_signals=len(losses),
            win_rate_pct=round(len(wins) / len(closed) * 100.0, 2),
            average_r=round(avg_r, 2),
            net_pnl_usd=round(net_pnl, 2),
            max_drawdown_pct=round(max_dd, 2),
            profit_factor=round(gross_win / gross_loss, 2) if gross_loss > 0 else (99.0 if gross_win > 0 else 0.0),
            long_win_rate_pct=round(long_wr, 2),
            long_net_pnl_usd=round(sum(float(e["realized_pnl_usd"]) for e in long_closed), 2),
            short_win_rate_pct=round(short_wr, 2),
            short_net_pnl_usd=round(sum(float(e["realized_pnl_usd"]) for e in short_closed), 2),
        )
