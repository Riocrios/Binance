from __future__ import annotations

STABLECOIN_BASES = {
    "USDC", "BUSD", "TUSD", "USDP", "FDUSD", "DAI", "USTC", "USDD",
    "PAXG", "AEUR", "EUR", "GBP", "TRY", "BRL", "ARS", "BIDR",
}


def is_stablecoin_pair(symbol: str) -> bool:
    s = symbol.upper()
    if not s.endswith("USDT"):
        return True
    base = s[:-4]
    return base in STABLECOIN_BASES


def format_price(price: float) -> str:
    if price <= 0:
        return "0.00"
    if price >= 1000:
        return f"{price:,.2f}"
    if price >= 1:
        return f"{price:,.4f}"
    return f"{price:.6f}"


def format_usd(amount: float) -> str:
    if abs(amount) >= 1_000_000_000:
        return f"${amount / 1_000_000_000:.2f}B"
    if abs(amount) >= 1_000_000:
        return f"${amount / 1_000_000:.2f}M"
    if abs(amount) >= 1_000:
        return f"${amount / 1_000:.1f}K"
    return f"${amount:,.2f}"
