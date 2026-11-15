import type { DailyBar, Signal, StockSeries } from "./types";

const EPS = 1e-9;

export function isMainBoard(code: string, name = ""): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  if (!/^(60|601|603|605|000|001|002|003)/.test(code)) return false;
  if (/ST|退|\*ST/i.test(name)) return false;
  return true;
}
export function roundToCent(value: number): number {
  return Math.round((value + 1e-8) * 100) / 100;
}
export function limitUpPrice(previousClose: number): number {
  return roundToCent(previousClose * 1.1);
}
export function isCloseAtLimitUp(currentClose: number, previousClose: number): boolean {
  if (!(previousClose > 0 && currentClose > 0)) return false;
  // 允许行情供应商的小于半分钱的浮点误差，不允许偏离一分钱。
  return Math.abs(currentClose - limitUpPrice(previousClose)) < 0.005;
}
export function candleShape(bar: DailyBar): "R1" | "R3" | undefined {
  const range = bar.high - bar.low;
  if (range <= EPS || bar.close <= bar.open + EPS) return undefined;
  const body = (bar.close - bar.open) / range;
  const upper = (bar.high - Math.max(bar.close, bar.open)) / range;
  const lower = (Math.min(bar.close, bar.open) - bar.low) / range;
  if (body + EPS < 0.5 || upper >= 0.1 - EPS) return undefined;
  if (lower < 0.1 - EPS) return "R1";
  return "R3";
}
export function upperShadowRatio(bar: DailyBar): number | undefined {
  const range = bar.high - bar.low;
  return range > EPS ? (bar.high - Math.max(bar.open, bar.close)) / range : undefined;
}
export function movingAverageClose(bars: DailyBar[], index: number, window = 5): number | undefined {
  if (index - window + 1 < 0) return undefined;
  const values = bars.slice(index - window + 1, index + 1);
  if (values.length !== window || values.some((b) => !(b.close > 0))) return undefined;
  return values.reduce((sum, b) => sum + b.close, 0) / window;
}
export function getT3OpenPriceRange(fourCloseSum: number): { lower: number; upper: number } {
  // (P / ((S+P)/5) - 1) in [0,0.05] -> P in [S/4, 1.05S/3.95].
  return { lower: fourCloseSum / 4, upper: (1.05 * fourCloseSum) / 3.95 };
}
export function calculateT3MaDistance(open: number, fourCloseSum: number): number {
  return open / ((fourCloseSum + open) / 5) - 1;
}
export function confirmT3Open(signal: Signal, open: number): string[] {
  if (signal.phase !== "ready" || !(open > 0) || !signal.maPreviousFourCloseSum) return [];
  const adjustedOpen = open * (signal.nextOpenScaleFactor ?? 1);
  const d = calculateT3MaDistance(adjustedOpen, signal.maPreviousFourCloseSum);
  const passed = d >= -EPS && d <= 0.05 + EPS;
  const tags = [...signal.tags];
  if (tags.includes("A")) {
    tags.push(passed ? "A1" : "A2");
    if (passed) tags.push(signal.t2LowVsMa5Pct !== undefined && signal.t2LowVsMa5Pct > 0 && signal.t2LowVsMa5Pct <= 3 ? "A1-1" : "A1-2");
  }
  if (tags.includes("B")) {
    tags.push(passed ? "B1" : "B2");
    if (passed) tags.push(signal.t2LowVsMa5Pct !== undefined && signal.t2LowVsMa5Pct > 0 && signal.t2LowVsMa5Pct <= 3 ? "B1-1" : "B1-2");
  }
  return tags;
}

/** Full scan on one code; t0Date must be one of the last three selected trading sessions. */
export function evaluateStockT0(series: StockSeries, t0Date: string, marketDate: string): Signal | undefined {
  const raw = [...series.raw].sort((a,b)=>a.date.localeCompare(b.date));
  const adj = [...series.adjusted].sort((a,b)=>a.date.localeCompare(b.date));
  const i = raw.findIndex((bar) => bar.date === t0Date);
  const j = adj.findIndex((bar) => bar.date === t0Date);
  if (i < 26 || j < 26) return undefined; // cannot trust new-listing / insufficient history
  if (!isMainBoard(series.code, series.name)) return undefined;
  const r0=raw[i], rp=raw[i-1], rpp=raw[i-2];
  if (!isCloseAtLimitUp(r0.close, rp.close) || isCloseAtLimitUp(rp.close, rpp.close)) return undefined;
  const a0=adj[j], ap=adj[j-1];
  const t1=adj[j+1], t2=adj[j+2];
  const t1raw=raw[i+1];
  const phase: Signal["phase"] = !t1 || t1.date > marketDate ? "first_board" : !t2 || t2.date > marketDate ? "watch" : "ready";
  // Only show active T0/T1/T2 records, never expire and mislabel old candidates.
  if ((phase==="ready" && t2.date!==marketDate) || (phase==="watch" && t1?.date!==marketDate) || (phase==="first_board" && t0Date!==marketDate)) return undefined;
  const result: Signal = {
    id: `${series.code}_${t0Date}`, code: series.code, name: series.name, phase,
    t0:t0Date, t1:t1?.date, t2:phase==="ready"?t2?.date:undefined,
    tags: [], pendingTags: [], notes: [...series.warnings], t0HeldPreviousClose:a0.low >= ap.close - EPS,
    dataDate: adj[adj.length-1].date, provider:series.provider,
  };
  if (phase === "first_board") {
    result.tags=["首板观察"];
    return result;
  }
  if (!t1raw || !t1 || !(a0.volume>0 && t1.volume>0)) return undefined;
  const shape=candleShape(t1);
  if (!shape) return undefined;
  result.shape=shape;
  result.v1=t1.volume/a0.volume;
  result.t1GapPct=(t1.open/a0.close-1)*100;
  const t1Upper=limitUpPrice(raw[i].close);
  result.t1FailedLimit = t1raw.high >= t1Upper-0.005 && !isCloseAtLimitUp(t1raw.close, raw[i].close);
  if (result.t1FailedLimit) result.notes.push("T+1曾触板但收盘未封住");
  const A=shape==="R1" && result.t1GapPct>0 && result.v1>=0.8 && result.v1<1.2;
  const B=shape==="R3" && result.t1GapPct>0 && result.v1<0.8;
  // C cannot be fully determined until T2 volume is available.
  const potentialC=shape==="R3" && Boolean(result.t0HeldPreviousClose);
  if (phase === "watch") {
    if(A) result.tags.push("潜在A");
    if(B) result.tags.push("潜在B");
    if(potentialC) result.tags.push("潜在C");
    return result.tags.length ? result : undefined;
  }
  if (!t2 || !(t2.volume>0) || t2.close >= t1.close-EPS) return undefined;
  result.v2=t2.volume/t1.volume;
  const ma5=movingAverageClose(adj, j+2);
  if (!ma5 || ma5<=0) return undefined;
  result.t2LowVsMa5Pct=(t2.low/ma5-1)*100;
  const wick=upperShadowRatio(t2);
  if (wick===undefined) return undefined;
  result.t2UpperWickPct=wick*100;
  result.t2Close=t2.close;
  const C=potentialC && result.v2>=2;
  if(A) result.tags.push("A");
  if(B) result.tags.push("B");
  if(C){ result.tags.push("C"); result.tags.push(wick<=0.2+EPS?"C1":"C2"); }
  if(!result.tags.length) return undefined;
  if(A) result.pendingTags.push(result.t2LowVsMa5Pct>0 && result.t2LowVsMa5Pct<=3?"待A1-1开盘确认":"待A1开盘确认");
  if(B) result.pendingTags.push(result.t2LowVsMa5Pct>0 && result.t2LowVsMa5Pct<=3?"待B1-1开盘确认":"待B1开盘确认");
  const fourClose = adj.slice(j-1,j+3);
  if(fourClose.length!==4 || fourClose.some((bar)=>!(bar.close>0)))return undefined;
  const s=fourClose.reduce((sum,bar)=>sum+bar.close,0);
  const range=getT3OpenPriceRange(s);
  const r2=raw[i+2];
  if(!r2 || r2.date!==t2.date || r2.close<=0) return undefined;
  const factor=t2.close/r2.close;
  if(!(factor>0)) return undefined;
  result.maPreviousFourCloseSum=s;
  result.nextOpenScaleFactor=factor;
  result.t3LimitUpPrice=limitUpPrice(r2.close);
  // Real quotes use 0.01 CNY ticks: ceiling the lower bound and flooring the upper.
  result.maOpenLower=Math.ceil((range.lower/factor)*100-1e-8)/100;
  result.maOpenUpper=Math.floor((range.upper/factor)*100+1e-8)/100;
  if(result.t2LowVsMa5Pct<=0) result.notes.push("T+2最低价触及或跌破MA5");
  return result;
}
