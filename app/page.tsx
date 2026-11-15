"use client";
import {useEffect,useMemo,useState} from "react";
import {Activity,ArrowDownToLine,ArrowRight,CalendarDays,CheckCircle2,ChevronDown,ChevronUp,CircleHelp,Database,Filter,RefreshCw,Search,ShieldAlert,Signal as SignalIcon,TrendingUp,TriangleAlert,Wallet,WifiOff} from "lucide-react";
import type {ScanResult,Signal} from "@/src/lib/types";
import {confirmT3Open} from "@/src/lib/rules";

type View="ready"|"watch"|"first_board";
const ruleInfo=[
  {tag:"A",name:"R1 平量",desc:"T+1高开R1阳线、首板次日量比0.8～1.2、T+2回调"},
  {tag:"A1",name:"A＋开盘MA5",desc:"A基础上，T+3开盘高于动态MA5的0～5%"},
  {tag:"A1-1",name:"A1＋均线回踩",desc:"A1基础上，T+2最低点在MA5上方0～3%"},
  {tag:"B",name:"R3 缩量",desc:"T+1高开R3阳线、首板次日量比<0.8、T+2回调"},
  {tag:"B1",name:"B＋开盘MA5",desc:"B基础上，T+3开盘高于动态MA5的0～5%"},
  {tag:"B1-1",name:"B1＋均线回踩",desc:"B1基础上，T+2最低点在MA5上方0～3%"},
  {tag:"C",name:"R3 放量",desc:"首板最低价不破前收、T+1为R3、T+2回调且量比≥2；不要求高开"},
  {tag:"C1",name:"C＋短上影",desc:"C基础上，T+2上影线占振幅≤20%"},
];
const f=(n?:number,d=2)=>n===undefined||!Number.isFinite(n)?"—":n.toFixed(d);
const currentChinaDate=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
function Chip({children,tone="plain"}:{children:React.ReactNode;tone?:"plain"|"green"|"orange"|"blue"|"muted"}){return <span className={`chip chip-${tone}`}>{children}</span>}
function ruleTone(rule:string):"orange"|"green"|"blue"|"muted"{
  if(rule==="C1"||rule==="B1-1"||rule==="A1-1")return "orange";
  if(rule.startsWith("C"))return "blue";
  if(rule.startsWith("潜在"))return "muted";
  return "green";
}
function toCsv(signals:Signal[],manual:Record<string,string>):string{
  const columns:[string,(s:Signal)=>string|number|undefined][]=[
    ["代码",s=>`\t${s.code}`],["名称",s=>s.name],["阶段",s=>s.phase],["首板日",s=>s.t0],["T+1",s=>s.t1],["T+2",s=>s.t2],
    ["全部标签",s=>confirmT3Open(s,Number(manual[s.id])).join(" / ")||s.tags.join(" / ")],["待确认",s=>s.pendingTags.join(" / ")],
    ["V1",s=>s.v1],["V2",s=>s.v2],["T+1高开幅度%",s=>s.t1GapPct],["T+2低点距MA5%",s=>s.t2LowVsMa5Pct],
    ["T+2上影线%",s=>s.t2UpperWickPct],["首板不破前收",s=>s.t0HeldPreviousClose===undefined?"":s.t0HeldPreviousClose?"是":"否"],
    ["明日开盘下限",s=>s.maOpenLower],["明日开盘上限",s=>s.maOpenUpper],["明日涨停价",s=>s.t3LimitUpPrice],["输入开盘价",s=>manual[s.id]],
    ["数据最新日期",s=>s.dataDate],["提供方",s=>s.provider],["风险备注",s=>s.notes.join("；")]
  ];
  const quote=(str:unknown)=>`"${String(str??"").replaceAll('"','""')}"`;
  return "\uFEFF"+[columns.map(c=>quote(c[0])).join(","),...signals.map(s=>columns.map(c=>quote(c[1](s))).join(","))].join("\r\n");
}
function downloadCsv(name:string,text:string){
  const blob=new Blob([text],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);
}
function SignalRow({s,openOverrides,setOpenOverrides}:{s:Signal;openOverrides:Record<string,string>;setOpenOverrides:(v:Record<string,string>)=>void}){
  const [expanded,setExpanded]=useState(false);
  const currentOpen=Number(openOverrides[s.id]);
  const confirmed=currentOpen>0?confirmT3Open(s,currentOpen):[];
  const displayTags=confirmed.length?confirmed:s.tags;
  return <>
    <tr className="main-row" onClick={()=>setExpanded(!expanded)} title="点击展开完整条件">
      <td className="stock-id"><div className="stock-name">{s.name===s.code?"未获取名称":s.name}</div><div className="stock-code">{s.code}</div></td>
      <td><div className="tag-cluster">{displayTags.map(tag=><Chip tone={ruleTone(tag)} key={tag}>{tag}</Chip>)}</div>{s.pendingTags.length>0&&currentOpen<=0&&<span className="pending-small">{s.pendingTags.join("、")}</span>}</td>
      <td><div className="num">{f(s.v1)}</div><span className="small-label">{s.v2!==undefined?`V2 ${f(s.v2)}`:"V2待出"}</span></td>
      <td><div className={`num ${s.t2LowVsMa5Pct!==undefined && s.t2LowVsMa5Pct<=0?"negative":""}`}>{s.t2LowVsMa5Pct!==undefined?`${f(s.t2LowVsMa5Pct)}%`:"—"}</div><span className="small-label">T+2最低点</span></td>
      <td><div className="num">{s.maOpenLower!==undefined?`${f(s.maOpenLower)}～${f(s.maOpenUpper)}`:"—"}</div><span className="small-label">明日开盘价区间</span></td>
      <td><span className={`status ${s.phase==="ready"?"status-ready":"status-watch"}`}>{s.phase==="ready"?"待T+3开盘":s.phase==="watch"?"T+1预警":"首板"}</span></td>
      <td className="expand-icon">{expanded?<ChevronUp size={16}/>:<ChevronDown size={16}/>}</td>
    </tr>
    {expanded&&<tr className="detail-row"><td colSpan={7}><div className="stock-detail">
      <div className="detail-grid">
        <div><span>首板 T</span><b>{s.t0}</b></div>
        <div><span>T+1 / 形态</span><b>{s.t1||"—"} {s.shape||""}</b></div>
        <div><span>T+2 / 收盘</span><b>{s.t2||"—"} {s.t2Close?f(s.t2Close):""}</b></div>
        <div><span>T+1高开幅度</span><b>{f(s.t1GapPct)}%</b></div>
        <div><span>T+2上影比例</span><b>{s.t2UpperWickPct!==undefined?`${f(s.t2UpperWickPct)}%`:"—"}</b></div>
        <div><span>T+0最低价守住昨收</span><b>{s.t0HeldPreviousClose?"是":"否"}</b></div>
        <div><span>数据提供方 / 最新日期</span><b>{s.provider} · {s.dataDate}</b></div>
        <div><span>T+1炸板风险</span><b>{s.t1FailedLimit?"是":"未标记"}</b></div>
      </div>
      {s.phase==="ready"&&<div className="open-check"><div><strong>次日9:25开盘价确认</strong><p>输入开盘价后，立即判断是否满足A1/B1及其子分支。不开盘前只允许显示“待确认”。</p></div><input type="number" step="0.01" min="0.01" placeholder="例如 11.28" value={openOverrides[s.id]||""} onChange={e=>setOpenOverrides({...openOverrides,[s.id]:e.target.value})}/><span>{currentOpen>0?confirmed.some(t=>t==="A1"||t==="B1")?"符合MA5开盘优化":"不符合MA5开盘优化":"未录入开盘价"}</span></div>}
      {currentOpen>0 && s.t3LimitUpPrice && currentOpen>=s.t3LimitUpPrice-0.005 && <div className="notices"><p><TriangleAlert size={13}/>T+3开盘价达到涨停价（{f(s.t3LimitUpPrice)}），即使形态满足也可能无法买入，请勿当作可成交信号。</p></div>}
      {s.notes.length>0&&<div className="notices">{s.notes.map((n,i)=><p key={i}><TriangleAlert size={13}/>{n}</p>)}</div>}
    </div></td></tr>}
  </>;
}
export default function Home(){
  const [date,setDate]=useState("");
  const [codes,setCodes]=useState("");
  const [token,setToken]=useState("");
  const [openOverrides,setOpenOverrides]=useState<Record<string,string>>({});
  const [result,setResult]=useState<ScanResult|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [view,setView]=useState<View>("ready");
  const [filter,setFilter]=useState("ALL");
  const [showRules,setShowRules]=useState(false);
  const [showAdvanced,setShowAdvanced]=useState(false);
  useEffect(()=>{setDate(currentChinaDate());try{const old=localStorage.getItem("abc-dashboard-cache");if(old){const r=JSON.parse(old);if(r?.summary&&Array.isArray(r?.signals))setResult(r);}}catch{}},[]);
  const groups=useMemo(()=>({ready:result?.signals.filter(s=>s.phase==="ready")??[],watch:result?.signals.filter(s=>s.phase==="watch")??[],first_board:result?.signals.filter(s=>s.phase==="first_board")??[]}),[result]);
  const rows=useMemo(()=>groups[view].filter(s=>filter==="ALL"||s.tags.some(t=>t===filter||t===`潜在${filter}`)||s.pendingTags.some(t=>t.includes(filter))),[groups,view,filter]);
  const allReady=groups.ready;
  async function runScan(){
    if(!date||busy)return;
    setBusy(true);setError("");
    try{
      const resp=await fetch("/api/scan",{method:"POST",headers:{"Content-Type":"application/json","x-scan-token":token},body:JSON.stringify({date,codes})});
      const data=await resp.json();
      if(!resp.ok)throw new Error(data.error||`请求失败 ${resp.status}`);
      setResult(data);setOpenOverrides({});setView("ready");setFilter("ALL");
      try{localStorage.setItem("abc-dashboard-cache",JSON.stringify(data));}catch{}
    }catch(err){setError(err instanceof Error?err.message:"未知错误");}
    finally{setBusy(false);}
  }
  const summary=result?.summary;
  const recentDate=summary?.marketDate??"—";
  const health=summary?.coverageComplete;
  return <main className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-logo"><Activity size={20}/></span><div><strong>ABC STOCK<span className="brand-mini"> LAB</span></strong><div className="brand-sub">A股首板回调 · 量价形态工作台</div></div></div><span className="env-mark">V1 · 手动刷新</span></header>
    <div className="page-container">
      <section className="page-heading"><div><div className="eyebrow">每日模式识别</div><h1>让形态筛选更准确，<span>让主观判断更从容。</span></h1><p>扫描沪深主板首板股，识别A、B、C及优化分支。系统负责筛选，你负责题材、位置和筹码。</p></div><div className="data-indicator"><span className={`live-dot ${result&&health?"ok":""}`}/><span>{result?health?"数据覆盖完整":"数据覆盖不完整":"尚未获取行情"}</span></div></section>
      <section className="scan-panel"><div className="scan-fields"><label><span><CalendarDays size={15}/> 分析截止日期</span><input type="date" value={date} max={currentChinaDate()} onChange={e=>setDate(e.target.value)}/></label><label className="password-field"><span>刷新口令（如已配置）</span><input type="password" value={token} onChange={e=>setToken(e.target.value)} placeholder="未设置可留空"/></label><button className="scan-button" type="button" disabled={busy||!date} onClick={runScan}><RefreshCw size={17} className={busy?"spin":""}/>{busy?"正在获取和筛选…":"更新行情并筛选"}</button></div>
      <button className="advanced-toggle" onClick={()=>setShowAdvanced(!showAdvanced)}><ChevronDown size={14}/> {showAdvanced?"收起":"展开"}手动名单 / 备用入口</button>
      {showAdvanced&&<div className="manual-field"><label>手动加入最近3个交易日的首板股票代码（可粘贴你的涨停名单；与自动池合并去重）</label><textarea value={codes} onChange={e=>setCodes(e.target.value)} placeholder="例如：600519 000001 002027（支持空格、逗号、换行）" rows={3}/><p>即使免费涨停池暂时不可用，仍可通过你记录的股票代码继续部分筛选。手动模式的结果不能视为全市场完整覆盖。</p></div>}
      {error&&<div className="error-banner"><WifiOff size={17}/><div><strong>获取失败</strong><p>{error}</p></div></div>}
      <p className="source-note"><Database size={14}/> 数据源：东方财富涨停池、东方财富日K；失败时尝试腾讯日K。非交易日自动回退至最近已完成交易日。</p></section>
      <section className="kpi-grid">
        <div className="kpi-card"><div><span>明日T+3候选</span><Search size={18}/></div><strong>{result?groups.ready.length:"—"}</strong><small>基础A/B/C已满足，开盘条件待确认</small></div>
        <div className="kpi-card"><div><span>T+1提前观察</span><SignalIcon size={18}/></div><strong>{result?groups.watch.length:"—"}</strong><small>下一阶段等待T+2收盘回调</small></div>
        <div className="kpi-card"><div><span>重点模式C1</span><TrendingUp size={18}/></div><strong>{result?allReady.filter(s=>s.tags.includes("C1")).length:"—"}</strong><small>R3 + 首板质量 + 放量 + 短上影</small></div>
        <div className="kpi-card"><div><span>行情基准日</span><Database size={18}/></div><strong className="kpi-date">{recentDate}</strong><small>{summary?`${summary.fetched}/${summary.screened}只股票已取数`:`等待首次扫描`}</small></div>
      </section>
      {summary&&<section className={`coverage ${summary.coverageComplete?"coverage-good":"coverage-warning"}`}><div className="coverage-head">{summary.coverageComplete?<CheckCircle2 size={17}/>:<ShieldAlert size={17}/>}<strong>{summary.coverageComplete?"行情覆盖检查通过":"注意：本次数据可能不完整"}</strong><span>更新于 {new Date(summary.updatedAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}</span></div>{summary.warnings.map((m,i)=><p key={i}>{m}</p>)}{summary.errors.length>0&&<details><summary>展开获取失败详情（{summary.errors.length}项）</summary>{summary.errors.slice(0,30).map((m,i)=><p key={i}>{m}</p>)}{summary.errors.length>30&&<p>其余{summary.errors.length-30}项未展开</p>}</details>}</section>}
      <section className="results"><div className="section-top"><div><div className="eyebrow">SCREENING RESULTS</div><h2>每日候选清单</h2></div><div className="section-actions"><button className="light-button" onClick={()=>setShowRules(!showRules)}><CircleHelp size={16}/> {showRules?"收起规则":"规则说明"}</button><button className="light-button" disabled={!result} onClick={()=>downloadCsv(`ABC筛选_${recentDate}.csv`,toCsv(result?.signals||[],openOverrides))}><ArrowDownToLine size={16}/> 导出CSV</button></div></div>
      {showRules&&<div className="rules-grid">{ruleInfo.map(r=><div className="rule-item" key={r.tag}><Chip tone={ruleTone(r.tag)}>{r.tag}</Chip><strong>{r.name}</strong><p>{r.desc}</p></div>)}<div className="rule-item"><Chip tone="muted">A2/B2</Chip><strong>开盘未通过MA5</strong><p>满足A或B基础，但T+3实际开盘不满足动态MA5上方0～5%。只有获得真实开盘价才能划分。</p></div><div className="rule-item"><Chip tone="muted">C2</Chip><strong>C的长上影分支</strong><p>满足C，且T+2上影线占振幅&gt;20%。</p></div></div>}
      <div className="tabs"><button className={view==="ready"?"tab active":"tab"} onClick={()=>{setView("ready");setFilter("ALL")}}>明日买入候选 <b>{groups.ready.length}</b></button><button className={view==="watch"?"tab active":"tab"} onClick={()=>{setView("watch");setFilter("ALL")}}>T+1提前观察 <b>{groups.watch.length}</b></button><button className={view==="first_board"?"tab active":"tab"} onClick={()=>{setView("first_board");setFilter("ALL")}}>当日首板池 <b>{groups.first_board.length}</b></button></div>
      <div className="table-tools"><div className="filters"><Filter size={16}/>{["ALL","A","B","C","C1"].map(t=><button className={filter===t?"filter-pill active":"filter-pill"} onClick={()=>setFilter(t)} key={t}>{t==="ALL"?"全部":t}</button>)}</div><span>{rows.length} 只股票 · 点击行看完整条件</span></div>
      <div className="table-container"><table className="stock-table"><thead><tr><th>股票</th><th>已确认模式 / 待确认</th><th>量比</th><th>T+2 vs MA5</th><th>T+3开盘优化区间</th><th>筛选状态</th><th></th></tr></thead><tbody>{rows.length?rows.map(s=><SignalRow key={s.id} s={s} openOverrides={openOverrides} setOpenOverrides={setOpenOverrides}/>):<tr><td colSpan={7}><div className="empty-state"><Search size={29}/><strong>{result?summary?.coverageComplete?"该阶段没有匹配股票":"当前未发现匹配，但数据覆盖不完整":"先点击「更新行情并筛选」"}</strong><p>{result?"支持更改日期，或者手动粘贴你的首板名单后重新筛选":"网站会从涨停池追踪首板日、次日及第三天的形态"}</p></div></td></tr>}</tbody></table></div>
      <div className="table-footer"><span>说明：基础模式的T+2条件在盘后确认；A1/B1只能在T+3开盘价出现后确认。</span><span>CSV可在Excel中打开</span></div></section>
      <footer className="footer"><Wallet size={15}/> 本站仅识别历史量价条件，不提供自动下单。免费行情源非官方稳定接口，数据不全时不得据此推断“无信号”。<ArrowRight size={15}/></footer>
    </div>
  </main>;
}
