import {evaluateStockT0, isMainBoard} from "./rules";
import {fetchLimitPool,fetchSessionCalendar,fetchStockSeries} from "./providers";
import type {ScanResult,Signal} from "./types";

function chinaClock(){
  const now=new Date();
  const fmt=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
  const parts=Object.fromEntries(fmt.formatToParts(now).map(p=>[p.type,p.value]));
  return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`};
}
function uniqueCodes(raw:string): string[] {
  return [...new Set(raw.match(/(?<!\d)\d{6}(?!\d)/g)??[])].filter(code=>isMainBoard(code)).slice(0,300);
}
async function concurrentMap<T,R>(input:T[],limit:number,fn:(value:T)=>Promise<R>):Promise<PromiseSettledResult<R>[]> {
  const out:PromiseSettledResult<R>[] = new Array(input.length);
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(limit,input.length)},async()=>{
    while(cursor<input.length){
      const idx=cursor++;
      try{out[idx]={status:"fulfilled",value:await fn(input[idx])};}
      catch(error){out[idx]={status:"rejected",reason:error};}
    }
  }));
  return out;
}
export async function scanMarket(asofRaw:string,manualText=""):Promise<ScanResult>{
  const now=chinaClock();
  const requestedDate=/^\d{4}-\d{2}-\d{2}$/.test(asofRaw)?asofRaw:now.date;
  if(requestedDate>now.date)throw new Error("不能筛选未来日期");
  const manual=uniqueCodes(manualText);
  const warnings:string[]=[];
  const errors:string[]=[];
  let sessionDates=await fetchSessionCalendar(requestedDate);
  // Do not treat unfinished current-day bars as a completed candle.
  if(requestedDate===now.date && now.time<"15:05"){
    sessionDates=sessionDates.filter(d=>d!==now.date);
    warnings.push("当前交易日未达到15:05，忽略当日可能未完成的日K线；仅使用上一完整交易日");
  }
  const marketDate=sessionDates[sessionDates.length-1];
  if(!marketDate)throw new Error("没有找到已完成的交易日");
  if(marketDate<requestedDate)warnings.push(`指定日${requestedDate}非交易日或日K未更新，实际分析截至${marketDate}`);
  const recent=sessionDates.slice(-3);
  const pools:Record<string,number>={};
  const candidates=new Map<string,{code:string;name:string}>();
  let poolFailed=false;
  let poolEmpty=false;
  const poolResults=await Promise.allSettled(recent.map(d=>fetchLimitPool(d)));
  poolResults.forEach((result,index)=>{
    const date=recent[index];
    if(result.status==="fulfilled"){
      pools[date]=result.value.length;
      if(result.value.length===0){poolEmpty=true;warnings.push(`${date}的涨停池返回0只，可能尚未更新或被限流，无法确认全市场覆盖`);}
      result.value.filter(stock=>isMainBoard(stock.code,stock.name)).forEach(stock=>candidates.set(stock.code,stock));
    }else{
      pools[date]=-1;poolFailed=true;
      errors.push(`${date}涨停池获取失败：${result.reason instanceof Error?result.reason.message:String(result.reason)}`);
    }
  });
  for(const code of manual){
    if(!candidates.has(code))candidates.set(code,{code,name:code});
  }
  if(candidates.size===0){
    throw new Error(poolFailed?`涨停池接口不可用，且没有手动输入股票。${errors.join("；")}`:"三个交易日没有股票可跟踪（请核对日期与行情源）");
  }
  const identities=[...candidates.values()].slice(0,500);
  const signals:Signal[]=[];
  let fetched=0, failed=0, stale=0;
  const stockResults=await concurrentMap(identities,6, stock=>fetchStockSeries(stock.code,stock.name,marketDate));
  stockResults.forEach((result,index)=>{
    const stock=identities[index];
    if(result.status!=="fulfilled"){
      failed++;
      errors.push(result.reason instanceof Error?result.reason.message:`${stock.code}行情获取失败`);
      return;
    }
    fetched++;
    const series=result.value;
    const latest=series.adjusted[series.adjusted.length-1].date;
    if(latest < marketDate){
      stale++;
      errors.push(`${stock.code}最新日K仅截至${latest}，未更新至${marketDate}`);
    }
    for(const t0 of recent){
      // If today's T+2 candle is missing, still show T+1 as a preliminary watch signal.
      const evalDate=latest < marketDate ? latest : marketDate;
      const signal=evaluateStockT0(series,t0,evalDate);
      if(signal){
        if(latest < marketDate)signal.notes.unshift(`数据滞后：应更新到${marketDate}，当前仅有${latest}；不可作为明日买入信号`);
        signals.push(signal);
      }
    }
  });
  if(failed)warnings.push(`有${failed}只股票行情获取失败，本次结果不保证不漏票`);
  if(stale)warnings.push(`有${stale}只股票日K尚未更新到${marketDate}，可能只有T+1初筛信息，严禁当作T+2已确认买入信号`);
  if(poolFailed)warnings.push("至少一个涨停池获取失败；即使候选为0也不能视为全市场没有信号");
  if(signals.some(s=>s.notes.some(n=>n.includes("回退腾讯"))))warnings.push("部分股票使用腾讯回退，复权与成交量口径应对关键股票二次核验");
  const priority=(s:Signal)=>s.tags.includes("C1")?0:s.tags.includes("B")||s.tags.includes("A")?1:s.phase==="watch"?2:3;
  signals.sort((a,b)=>priority(a)-priority(b)||a.code.localeCompare(b.code));
  return {
    summary:{requestedDate,marketDate,sessionDates:recent,updatedAt:new Date().toISOString(),screened:identities.length,fetched,failed,stale,pools,coverageComplete:!poolFailed&&!poolEmpty&&failed===0&&stale===0,warnings,errors},
    signals
  };
}
