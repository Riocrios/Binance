from __future__ import annotations

import sys
from pathlib import Path

# Ensure workspace root is on sys.path regardless of working directory
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.application import run_app


if __name__ == "__main__":
    raise SystemExit(run_app())
