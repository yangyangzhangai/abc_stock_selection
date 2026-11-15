export type DailyBar = {
  date: string; // YYYY-MM-DD, Chinese trading session
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount?: number;
};
export type StockSeries = {
  code: string;
  name: string;
  raw: DailyBar[];
  adjusted: DailyBar[];
  provider: string;
  warnings: string[];
};
export type Phase = "ready" | "watch" | "first_board";
export type Signal = {
  id: string;
  code: string;
  name: string;
  phase: Phase;
  t0: string;
  t1?: string;
  t2?: string;
  shape?: "R1" | "R3";
  tags: string[];
  pendingTags: string[];
  notes: string[];
  v1?: number;
  v2?: number;
  t1GapPct?: number;
  t2LowVsMa5Pct?: number;
  t2UpperWickPct?: number;
  t2Close?: number;
  t0HeldPreviousClose?: boolean;
  t1FailedLimit?: boolean;
  // prices are in last available adjusted series; corporate-action price-scale changes must be checked.
  maOpenLower?: number;
  maOpenUpper?: number;
  maPreviousFourCloseSum?: number;
  nextOpenScaleFactor?: number; // adjusted T2 close / raw T2 close
  t3LimitUpPrice?: number;
  dataDate: string;
  provider: string;
};
export type ScanSummary = {
  requestedDate: string;
  marketDate: string;
  sessionDates: string[];
  updatedAt: string;
  screened: number;
  fetched: number;
  failed: number;
  stale: number;
  pools: Record<string, number>;
  coverageComplete: boolean;
  warnings: string[];
  errors: string[];
};
export type ScanResult = { summary: ScanSummary; signals: Signal[] };
