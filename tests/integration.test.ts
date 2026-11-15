import {scanMarket} from "../src/lib/scanner";
import type {DailyBar} from "../src/lib/types";
let checks=0;
function assert(x:unknown,label:string){checks++;if(!x)throw new Error(label);}
const day=(i:number)=>{const d=new Date(Date.UTC(2026,0,1));d.setUTCDate(d.getUTCDate()+i);return d.toISOString().slice(0,10);};
function data(code:string):DailyBar[]{
 const bars:DailyBar[]=[];
 for(let i=0;i<30;i++)bars.push({date:day(i),open:10,close:10,high:10.1,low:9.9,volume:100});
 if(code==="600001"){
   bars.push({date:day(30),open:10.1,close:11,high:11,low:10.1,volume:100});
   bars.push({date:day(31),open:11.3,close:12.08,high:12.12,low:11.25,volume:100});
   bars.push({date:day(32),open:11.9,close:11.7,high:12.0,low:11.35,volume:150});
 }else{
   for(let i=30;i<33;i++)bars.push({date:day(i),open:10,close:10,high:10.1,low:9.9,volume:100});
 }
 return bars;
}
let stale = false;
const originalFetch=globalThis.fetch;
globalThis.fetch=async (input: string|URL|Request):Promise<Response>=>{
 const url=new URL(String(input));
 if(url.pathname.includes("getTopicZTPool"))return new Response(JSON.stringify({data:{pool:[{c:"600001",n:"测试股"}]}}),{status:200});
 if(url.pathname.includes("stock/kline/get")){
  const code=(url.searchParams.get("secid")||"").split(".").at(-1)!;
  const bars=data(code).slice(0,code==="600001"&&stale?-1:undefined);
  return new Response(JSON.stringify({data:{code,name:code==="600001"?"测试股":"贵州茅台",klines:bars.map(b=>[b.date,b.open,b.close,b.high,b.low,b.volume,100000].join(","))}}),{status:200});
 }
 throw new Error("Unexpected mocked endpoint: "+url.toString());
};
(async()=>{
 const result=await scanMarket(day(32));
 assert(result.summary.marketDate===day(32),"market date mismatch");
 assert(result.summary.coverageComplete,"expected complete coverage");
 assert(result.signals.length===1,"should have exactly one candidate");
 assert(result.signals[0].tags.includes("A"),"A should be present");
 assert(result.signals[0].phase==="ready","T+2 ready should be detected");
 stale=true;
 const delayed=await scanMarket(day(32));
 assert(!delayed.summary.coverageComplete,"stale data must invalidate coverage");
 assert(delayed.summary.stale===1,"one stale stock should be reported");
 assert(delayed.signals[0].phase==="watch","missing T+2 should still create T+1 watch");
 assert(delayed.signals[0].tags.includes("潜在A"),"stale stock should retain potential A tag");
 globalThis.fetch=originalFetch;
 console.log(`Passed ${checks} integration checks (mocked HTTP; not real market access)`);
})().catch(err=>{globalThis.fetch=originalFetch;throw err;});
