import { NextResponse } from "next/server";
import {fetchSessionCalendar,fetchLimitPool} from "@/src/lib/providers";
export const runtime="nodejs";
export const maxDuration=45;
export const dynamic="force-dynamic";
export async function GET(req:Request){
  const url=new URL(req.url);
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const date=url.searchParams.get("date")||today;
  const [k,p]=await Promise.allSettled([fetchSessionCalendar(date),fetchLimitPool(date)]);
  return NextResponse.json({
    testDate:date,
    kline:k.status==="fulfilled"?{ok:true,latestDate:k.value.at(-1),barCount:k.value.length}:{ok:false,error:String(k.reason)},
    limitPool:p.status==="fulfilled"?{ok:true,count:p.value.length}:{ok:false,error:String(p.reason)},
    checkedAt:new Date().toISOString()
  },{headers:{"Cache-Control":"no-store"}});
}
