import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AntdRegistry } from "@ant-design/nextjs-registry";

import { AppThemeProvider } from "@/components/app-theme-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "知径 · 把讨论走成一条学会的路",
    template: "%s · 知径",
  },
  description: "用真实知乎来源组织学习路径，在验证中留下属于你的进度。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <AntdRegistry>
          <AppThemeProvider>{children}</AppThemeProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
