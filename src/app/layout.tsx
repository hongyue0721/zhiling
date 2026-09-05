import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@fontsource-variable/noto-serif-sc/wght.css";
import "lxgw-wenkai-screen-web/lxgwwenkaiscreen/result.css";
import "@fontsource/allura/latin-400.css";
import "@fontsource/fraunces/latin-400-italic.css";
import "@fontsource/cormorant-garamond/latin-400-italic.css";
import "./globals.css";
import "@/components/shittim-immersive/bookish-global.css";
import { RouteBackground } from "@/components/shittim-immersive/route-background";

export const metadata: Metadata = {
  title: {
    default: "知径 · 把讨论走成一条学会的路",
    template: "%s · 知径",
  },
  description: "用真实知乎来源组织学习路径，在验证中留下属于你的进度。",
};

const themeBootstrap = `try{document.documentElement.dataset.shittimTone=localStorage.getItem("shittim-paper-theme")==="dark"?"dark":"light"}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="zh-CN"
      data-shittim-tone="light"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <RouteBackground />
        {children}
      </body>
    </html>
  );
}
