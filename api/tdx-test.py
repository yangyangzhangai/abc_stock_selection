import json
import math
import os
import time
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import date, datetime, timezone
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlsplit

from pytdx.hq import TdxHq_API


HOSTS = (
    "180.153.18.170",
    "60.191.117.167",
    "218.75.126.9",
    "115.238.56.198",
    "180.153.18.171",
    "124.160.88.183",
    "218.57.11.101",
)
PORT = 7709
BAR_COUNT = 30
STOCKS = ((1, "600519"), (0, "000001"))


def validate_bars(rows):
    if not rows or len(rows) != BAR_COUNT:
        raise ValueError(f"expected {BAR_COUNT} bars, received {len(rows or [])}")
    bars = []
    for row in rows:
        session = date(int(row["year"]), int(row["month"]), int(row["day"]))
        if session.weekday() >= 5 or (bars and session.isoformat() <= bars[-1]["date"]):
            raise ValueError(f"invalid session order or weekday: {session}")
        opening, high, low, close, volume = (
            float(row[field]) for field in ("open", "high", "low", "close", "vol")
        )
        if (
            not all(map(math.isfinite, (opening, high, low, close, volume)))
            or not (0 < low <= min(opening, close) <= max(opening, close) <= high)
            or volume < 0
        ):
            raise ValueError(f"invalid OHLC or volume: {session}")
        bars.append(dict(date=session.isoformat(), open=opening, high=high,
                         low=low, close=close, volume=volume))
    return bars


def error_text(exc):
    cause = getattr(exc, "original_exception", None) or exc.__cause__ or exc.__context__ or exc
    return f"{type(cause).__name__}: {cause}"


def probe(host, expected_date):
    started = time.monotonic()
    result = {"host": host, "port": PORT, "connected": False, "stocks": {}}
    api = TdxHq_API(heartbeat=False, auto_retry=False, raise_exception=True)
    try:
        if not api.connect(host, PORT, time_out=2):
            raise ConnectionError("TDX handshake failed")
        result["connected"] = True
        result["connectMs"] = round((time.monotonic() - started) * 1000)
        for market, code in STOCKS:
            try:
                bars = validate_bars(api.get_security_bars(9, market, code, 0, BAR_COUNT))
            except Exception as exc:
                result["stocks"][code] = {"ok": False, "error": error_text(exc)}
                continue
            latest = bars[-1]["date"]
            result["stocks"][code] = {"ok": True, "latestDate": latest, "barCount": len(bars),
                                      "matchesExpectedDate": latest == expected_date if expected_date else None}
            result.setdefault("bars", {})[code] = bars
        result["ok"] = all(stock["ok"] for stock in result["stocks"].values())
    except Exception as exc:
        result.update(ok=False, stage="connect", error=error_text(exc))
    finally:
        if api.client is not None:
            api.client.close()
    result["latencyMs"] = round((time.monotonic() - started) * 1000)
    return result


def diagnose(expected_date=None):
    pool = ThreadPoolExecutor(max_workers=len(HOSTS))
    futures = [pool.submit(probe, host, expected_date) for host in HOSTS]
    done, _ = wait(futures, timeout=12)
    pool.shutdown(wait=False, cancel_futures=True)
    servers = []
    for host, future in zip(HOSTS, futures):
        if future in done:
            servers.append(future.result())
        else:
            servers.append({"host": host, "port": PORT, "ok": False,
                            "error": "diagnostic deadline exceeded", "latencyMs": 12000})
    connected = sum(server.get("connected") is True for server in servers)
    successful = [server for server in servers if server["ok"]]
    best = min(successful, key=lambda server: server["latencyMs"], default=None)
    bars = best.get("bars") if best else None
    for server in servers:
        server.pop("bars", None)
    return {
        "ok": bool(successful),
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "vercelRegion": os.getenv("VERCEL_REGION"),
        "commitSha": os.getenv("VERCEL_GIT_COMMIT_SHA"),
        "expectedDate": expected_date,
        "priceBasis": "unadjusted",
        "connectionSuccessRate": connected / len(servers),
        "dailyBarSuccessRate": len(successful) / len(servers),
        "sampleHost": best["host"] if best else None,
        "bars": bars,
        "servers": servers,
    }


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        requested = parse_qs(urlsplit(self.path).query).get("date", [None])[0]
        try:
            expected = date.fromisoformat(requested).isoformat() if requested else None
        except ValueError:
            self.send_error(400, "date must be an ISO calendar date")
            return
        body = json.dumps(diagnose(expected), allow_nan=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
