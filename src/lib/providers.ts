import type { DailyBar, StockSeries } from "./types";

const headers = { "User-Agent": "Mozilla/5.0 ABC-Stock-Dashboard/0.1", "Accept": "application/json,text/plain,*/*", "Referer": "https://quote.eastmoney.com/" };
const EXPECTED_BAR_COUNT = 85;
export type StockIdentity = {code: string; name: string; origin: string};

function assertCode(code: string): string {
  if (!/^\d{6}$/.test(code)) throw new Error(`非法股票代码：${code}`);
  return code;
}
function secid(code: string): string { return `${code.startsWith("6") ? 1 : 0}.${assertCode(code)}`; }
function txid(code: string): string { return `${code.startsWith("6") ? "sh" : "sz"}${assertCode(code)}`; }

async function fetchText(url: URL, timeoutMs = 11000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response = await fetch(url.toString(), { cache: "no-store", signal: controller.signal, headers });
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if(text.length < 15) throw new Error("响应过短");
    return text;
  } finally {clearTimeout(timer);}
}
function parseJsonOrJsonp(text: string): any {
  const trimmed = text.trim();
  if(trimmed.startsWith("{")) return JSON.parse(trimmed);
  const p=trimmed.indexOf("={");
  if(p>=0){const end=trimmed.lastIndexOf("}");if(end>p)return JSON.parse(trimmed.slice(p+1,end+1));}
  const s=trimmed.indexOf("({"),e=trimmed.lastIndexOf("})");
  if(s>=0&&e>s)return JSON.parse(trimmed.slice(s+1,e+1));
  throw new Error("不是有效的JSON/JSONP响应");
}
function validBar(b: DailyBar): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(b.date) && [b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite) && b.high>=Math.max(b.open,b.close,b.low)-1e-6 && b.low<=Math.min(b.open,b.close,b.high)+1e-6 && b.close>0 && b.volume>=0;
}
function parseCsvLine(line: string): DailyBar | undefined {
  const x = line.split(",");
  const bar={date:x[0], open:Number(x[1]),close:Number(x[2]),high:Number(x[3]),low:Number(x[4]),volume:Number(x[5]),amount:Number(x[6])};
  return validBar(bar)?bar:undefined;
}
function orderedValidBars(bars: DailyBar[]): DailyBar[] {
  const byDate=new Map(bars.filter(validBar).map((bar)=>[bar.date,bar]));
  return [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
}

async function eastMoneyKline(code: string, adjust: 0|1, asof: string): Promise<{name:string; bars:DailyBar[]}> {
  const u = new URL("https://push2his.eastmoney.com/api/qt/stock/kline/get");
  Object.entries({secid:secid(code),fields1:"f1,f2,f3,f4,f5,f6",fields2:"f51,f52,f53,f54,f55,f56,f57",klt:"101",fqt:String(adjust),end:asof.replaceAll("-", ""),lmt:String(EXPECTED_BAR_COUNT)}).forEach(([k,v])=>u.searchParams.set(k,v));
  const payload=parseJsonOrJsonp(await fetchText(u));
  const obj=payload?.data;
  if(!Array.isArray(obj?.klines) || obj.klines.length<1) throw new Error(`东方财富${code}暂无日K`);
  const bars=orderedValidBars(obj.klines.map((line: string)=>parseCsvLine(line)).filter(Boolean));
  if(bars.length<1) throw new Error(`东方财富${code}日K格式异常`);
  return {name:String(obj.name || code),bars};
}
async function tencentKline(code:string, adjusted:boolean, asof:string):Promise<{name:string;bars:DailyBar[]}>{
  const key=txid(code);
  const u=new URL("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get");
  u.searchParams.set("param", `${key},day,,${asof},${EXPECTED_BAR_COUNT},${adjusted?"qfq":""}`);
  const payload=parseJsonOrJsonp(await fetchText(u));
  const obj=payload?.data?.[key];
  const lines=adjusted?(obj?.qfqday??obj?.day):(obj?.day);
  if(!Array.isArray(lines))throw new Error(`腾讯${code}无${adjusted?"前复权":"未复权"}日K`);
  const bars=orderedValidBars(lines.map((a:unknown)=>{
    if(!Array.isArray(a)||a.length<6) return undefined;
    const b={date:String(a[0]),open:Number(a[1]),close:Number(a[2]),high:Number(a[3]),low:Number(a[4]),volume:Number(a[5])};
    return validBar(b)?b:undefined;
  }).filter((bar): bar is DailyBar => bar !== undefined));
  if(!bars.length)throw new Error(`腾讯${code}日K格式异常`);
  return {name:code,bars};
}
function normalizePair(code:string,name:string,provider:string,raw:DailyBar[],adjusted:DailyBar[]):StockSeries{
  const shared=new Set(raw.map(bar=>bar.date));
  const adj=adjusted.filter(bar=>shared.has(bar.date));
  const adjDates=new Set(adj.map(bar=>bar.date));
  const r=raw.filter(bar=>adjDates.has(bar.date));
  if(adj.length<32)throw new Error(`${provider} ${code}有效重叠日线不足32日，不能判定首板`);
  const warnings:string[]=[];
  if(adj.length < Math.min(raw.length,adjusted.length))warnings.push("复权/未复权日期有差异，已只保留共同交易日");
  if(r[r.length-1].date!==adj[adj.length-1].date)warnings.push("最新日线日期不一致");
  return {code,name,provider,raw:r,adjusted:adj,warnings};
}
export async function fetchStockSeries(code:string,name:string,asof:string):Promise<StockSeries>{
  try {
    const [r,a]=await Promise.all([eastMoneyKline(code,0,asof),eastMoneyKline(code,1,asof)]);
    return normalizePair(code,name||r.name,"东方财富",r.bars,a.bars);
  } catch (eastError) {
    try {
      const [r,a]=await Promise.all([tencentKline(code,false,asof),tencentKline(code,true,asof)]);
      const pair=normalizePair(code,name||a.name,"腾讯财经",r.bars,a.bars);
      pair.warnings.push(`东财不可用，已回退腾讯（${eastError instanceof Error ?eastError.message:"未知错误"}）`);
      return pair;
    }catch(txError){throw new Error(`${code} 东财：${eastError instanceof Error?eastError.message:"请求失败"}；腾讯：${txError instanceof Error?txError.message:"请求失败"}`);}
  }
}

function poolItems(obj:any):unknown[]{
  const data=obj?.data;
  const candidate=data?.pool??data?.diff??[];
  return Array.isArray(candidate)?candidate:Object.values(candidate);
}
function pickString(obj:any,keys:string[]):string{
  for(const k of keys){ const value=obj?.[k];if(typeof value==="string"&&value.trim())return value.trim(); if(typeof value==="number")return String(value); }
  return "";
}
export async function fetchLimitPool(date: string): Promise<StockIdentity[]> {
  const codes = new Map<string,StockIdentity>();
  const firstURL=new URL("https://push2ex.eastmoney.com/getTopicZTPool");
  let hadValidResponse=false;
  for(let page=0;page<6;page++){
    const url=new URL(firstURL);
    Object.entries({ut:"7eea3edcaed734bea9cbfc24409ed989",dpt:"wz.ztzt",Pageindex:String(page),pagesize:"200",sort:"fbt:asc",date:date.replaceAll("-","")}).forEach(([k,v])=>url.searchParams.set(k,v));
    const payload=parseJsonOrJsonp(await fetchText(url));
    if(payload?.data===undefined||payload?.data===null)throw new Error(`${date}涨停池没有有效data字段`);
    hadValidResponse=true;
    const rows=poolItems(payload);
    for(const row of rows){
      const c=pickString(row,["c","f12"]).padStart(6,"0");
      const n=pickString(row,["n","f14"]);
      if(/^\d{6}$/.test(c))codes.set(c,{code:c,name:n||c,origin:date});
    }
    if(rows.length<200)break;
    if(page===5)throw new Error(`${date}涨停池超出分页上限，完整性无法确认`);
  }
  if(!hadValidResponse)throw new Error(`${date}涨停池为空或响应异常`);
  return [...codes.values()];
}
export async function fetchSessionCalendar(asof: string):Promise<string[]> {
  const series=await fetchStockSeries("600519","贵州茅台",asof);
  const dates=series.raw.map(bar=>bar.date).filter(d=>d<=asof);
  if(dates.length<4)throw new Error("基准股票交易日不足，无法识别交易日历");
  return dates;
}
