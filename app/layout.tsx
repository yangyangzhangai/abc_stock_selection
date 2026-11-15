import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {title:"ABC · 形态筛选工作台",description:"沪深主板首板回调 A/B/C 模式量价选股工作台"};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
