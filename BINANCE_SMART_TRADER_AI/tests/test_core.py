from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import load_config
from app.database.database import DatabaseManager
from app.database.journal import TradeJournalRepository
from app.engines.backtester import run_walk_forward_backtest
from app.engines.risk_manager import evaluate_risk
from app.engines.signal_engine import generate_signal_report
from app.exchange.market_data import Kline, OrderBookSnapshot


def _make_klines(count: int, start: float, step: float) -> list[Kline]:
    out: list[Kline] = []
    px = start
    t0 = 1_700_000_000_000
    for i in range(count):
        pullback = -step * 1.15 if (i % 14 >= 10 and i < count - 3) else step * 0.45
        mv = step * 0.9 if i >= count - 3 else pullback
        op = px
        cl = max(1.0, px + mv)
        wick = max(0.8, abs(step) * 1.9)
        hi = max(op, cl) + wick
        lo = min(op, cl) - wick
        vol = 2600.0 if i >= count - 2 else 1000.0 + (i % 5) * 40.0
        t_buy = vol * 0.72 if step >= 0 else vol * 0.28
        out.append(
            Kline(
                open_time=t0 + i * 300_000,
                open=op,
                high=hi,
                low=lo,
                close=cl,
                volume=vol,
                close_time=t0 + (i + 1) * 300_000 - 1,
                quote_volume=vol * cl,
                trades=200,
                taker_buy_base_vol=t_buy,
                taker_buy_quote_vol=t_buy * cl,
            )
        )
        px = cl
    return out


class TestCoreEngines(unittest.TestCase):
    def test_config_loads(self) -> None:
        cfg = load_config()
        self.assertEqual(cfg["app"]["trading_mode"], "ANALYSIS_ONLY")
        self.assertFalse(cfg["app"]["auto_trading_enabled"])

    def test_signal_long_short_wait(self) -> None:
        now = 1_700_050_000.0
        bull15 = _make_klines(140, 100.0, 0.7)
        bull1h = _make_klines(120, 90.0, 0.9)
        bull4h = _make_klines(100, 80.0, 1.1)
        px = bull15[-2].close
        ob = OrderBookSnapshot(px, px * 1.0002, 0.02, 800000.0, 320000.0, 0.42, now)
        rep = generate_signal_report(
            "BTCUSDT", "FUTURES", bull15, {"5m": bull15, "15m": bull15, "1h": bull1h, "4h": bull4h},
            ob, px, now, aggressiveness="BALANCED", max_stale_sec=1e12,
        )
        self.assertEqual(rep.direction, "LONG")
        self.assertGreaterEqual(rep.long_score, 65)
        self.assertLess(rep.stop_loss, rep.entry)

        bear15 = _make_klines(140, 220.0, -0.7)
        bear1h = _make_klines(120, 240.0, -0.9)
        bear4h = _make_klines(100, 260.0, -1.1)
        bpx = bear15[-2].close
        bob = OrderBookSnapshot(bpx, bpx * 1.0002, 0.02, 300000.0, 780000.0, -0.44, now)
        srep = generate_signal_report(
            "ETHUSDT", "FUTURES", bear15, {"5m": bear15, "15m": bear15, "1h": bear1h, "4h": bear4h},
            bob, bpx, now, aggressiveness="BALANCED", max_stale_sec=1e12,
        )
        self.assertEqual(srep.direction, "SHORT")
        self.assertGreater(srep.stop_loss, srep.entry)

        flat = _make_klines(140, 100.0, 0.0)
        wrep = generate_signal_report(
            "SOLUSDT", "FUTURES", flat, {"15m": flat}, None, flat[-2].close, now, max_stale_sec=1e12
        )
        self.assertEqual(wrep.direction, "WAIT")

    def test_risk_and_sqlite_journal_and_backtest(self) -> None:
        cfg = load_config()["risk"]
        ev = evaluate_risk("LONG", 50000.0, 49500.0, 50600.0, 51200.0, 0.02, 0, 0.0, cfg)
        self.assertTrue(ev.approved)
        self.assertAlmostEqual(ev.position_size_qty, 0.2, places=5)

        with tempfile.TemporaryDirectory() as tmp:
            db = DatabaseManager(Path(tmp) / "test.db")
            db.initialize()
            repo = TradeJournalRepository(db)
            eid = repo.add_journal_entry(
                "BTCUSDT", "FUTURES", "LONG", 50000.0, 49500.0, 50600.0, 51200.0, 82, 2.1,
                0.2, 10000.0, 10.0, 4.0, "test",
            )
            repo.close_entry(eid, 51200.0, "TP2_HIT", "TP2 reached")
            stats = repo.compute_stats(10000.0)
            self.assertEqual(stats.total_signals, 1)
            self.assertEqual(stats.winning_signals, 1)
            self.assertGreater(stats.net_pnl_usd, 200.0)

        up = _make_klines(140, 100.0, 0.7)
        down = _make_klines(120, up[-1].close, -0.6)
        bt = run_walk_forward_backtest("BTCUSDT", "15m", "FUTURES", up + down)
        self.assertEqual(bt.candles_analyzed, len(up) + len(down))
        self.assertEqual(bt.in_sample.trades + bt.out_of_sample.trades, bt.overall.trades)


if __name__ == "__main__":
    unittest.main()
