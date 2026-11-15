import { NextResponse } from "next/server";
import {scanMarket} from "@/src/lib/scanner";
export const runtime="nodejs";
export const maxDuration=300;
export const dynamic="force-dynamic";
export async function POST(req:Request){
  try{
    const password=process.env.SCANNER_PASSWORD;
    if(password && req.headers.get("x-scan-token")!==password) return NextResponse.json({error:"刷新密码错误，请检查Vercel环境变量 SCANNER_PASSWORD"},{status:401});
    const body=await req.json();
    const date=String(body?.date??"");
    const codes=String(body?.codes??"");
    if(codes.length>6000)return NextResponse.json({error:"股票代码过多，请拆分为多次请求"},{status:400});
    const output=await scanMarket(date,codes);
    return NextResponse.json(output,{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"筛选过程异常"},{status:502});
  }
}
