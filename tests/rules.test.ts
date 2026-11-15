import {candleShape,calculateT3MaDistance,confirmT3Open,evaluateStockT0,getT3OpenPriceRange,isCloseAtLimitUp,isMainBoard,limitUpPrice,movingAverageClose,upperShadowRatio} from "../src/lib/rules";
import type {DailyBar,StockSeries} from "../src/lib/types";
let checks=0;
const eq=(a:unknown,b:unknown, msg="")=>{checks++;if(a!==b)throw new Error(`${msg}: expected ${String(b)} got ${String(a)}`);};
const assert=(a:boolean,msg="")=>{checks++;if(!a)throw new Error(`assertion failed ${msg}`);};
const near=(a:number,b:number,tol=1e-6)=>{checks++;if(Math.abs(a-b)>tol)throw new Error(`${a} differs from ${b}`)};
const plusDays=(i:number)=>{const d=new Date(Date.UTC(2026,0,1));d.setUTCDate(d.getUTCDate()+i);return d.toISOString().slice(0,10);};
const candle=(idx:number,o:number,c:number,h:number,l:number,v=100):DailyBar=>({date:plusDays(idx),open:o,close:c,high:h,low:l,volume:v});
function sample(t1:"R1"|"R3"="R1",v1=100,v2=150):StockSeries{
 const b:DailyBar[]=[];
 for(let i=0;i<30;i++)b.push(candle(i,10,10,10.08,9.92));
 b.push(candle(30,10.1,11,11,10.1,100)); // T0, limit+10%; previous no limit
 if(t1==="R1")b.push(candle(31,11.3,12.08,12.12,11.25,v1));
 else b.push(candle(31,11.5,12.05,12.10,11.2,v1));
 b.push(candle(32,11.9,11.7,12,11.35,v2)); // T2 retreat, short wick 0.1/0.65
 return {code:"600001",name:"测试股",raw:b,adjusted:b,provider:"mock",warnings:[]};
}
eq(isMainBoard("600001"),true);eq(isMainBoard("300123"),false);eq(isMainBoard("002123","*ST测试"),false);
eq(limitUpPrice(10.03),11.03);eq(isCloseAtLimitUp(11,10),true);eq(isCloseAtLimitUp(10.99,10),false);
eq(candleShape(candle(1,11.3,12.08,12.12,11.25)),"R1");eq(candleShape(candle(1,11.5,12.05,12.1,11.2)),"R3");
eq(candleShape(candle(1,11,10.5,11.2,10)),undefined);
near(upperShadowRatio(candle(1,11.9,11.7,12,11.35))!,.1/.65);
const a=sample("R1");const t0=plusDays(30),t1=plusDays(31),t2=plusDays(32);
const asig=evaluateStockT0(a,t0,t2)!;
assert(Boolean(asig),"A should be recognized");
eq(asig.phase,"ready");eq(asig.shape,"R1");assert(asig.tags.includes("A"));assert(asig.pendingTags.some(t=>t.includes("A1")));
const s=asig.maPreviousFourCloseSum!;const range=getT3OpenPriceRange(s);near(range.lower,s/4);near(calculateT3MaDistance(range.lower,s),0);near(calculateT3MaDistance(range.upper,s),.05);
const conf=confirmT3Open(asig,(asig.maOpenLower!+asig.maOpenUpper!)/2);assert(conf.includes("A1"));assert(!conf.includes("A2"));
const confFail=confirmT3Open(asig,asig.maOpenUpper!+5);assert(confFail.includes("A2"));
const b=evaluateStockT0(sample("R3",60,180),t0,t2)!;
assert(b.tags.includes("B"));assert(b.tags.includes("C"));assert(b.tags.includes("C1"));
const c=evaluateStockT0(sample("R3",150,330),t0,t2)!;
assert(!c.tags.includes("B"));assert(c.tags.includes("C"));
const old=sample("R1");old.adjusted=old.adjusted.slice(0,-1);old.raw=old.raw.slice(0,-1);
const w=evaluateStockT0(old,t0,t1)!;
eq(w.phase,"watch");assert(w.tags.includes("潜在A"));
const first=sample("R1");first.adjusted=first.adjusted.slice(0,-2);first.raw=first.raw.slice(0,-2);
eq(evaluateStockT0(first,t0,t0)?.phase,"first_board");
const invalid=sample("R1");invalid.raw[30]={...invalid.raw[30],close:10.98};
eq(evaluateStockT0(invalid,t0,t2),undefined);
const noRetreat=sample("R1");noRetreat.adjusted[32]={...noRetreat.adjusted[32],close:12.11};
eq(evaluateStockT0(noRetreat,t0,t2),undefined);
// Validate adjusting the future open raw scale: a 0.8 front-adjusted factor must be converted in both directions.
const copied={...asig,nextOpenScaleFactor:0.8};
assert(confirmT3Open(copied,(range.lower+range.upper)/2/0.8).includes("A1"));
assert(movingAverageClose(a.adjusted,32)!>0);
console.log(`Passed ${checks} domain checks`);
