import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AntdRegistry } from "@ant-design/nextjs-registry";
import "@fontsource-variable/noto-serif-sc/wght.css";
import "lxgw-wenkai-screen-web/lxgwwenkaiscreen/result.css";

import { AppThemeProvider } from "@/components/app-theme-provider";
import { ThreeParticlesBackground } from "@/components/three-particles-background";
import { ScrollReveal } from "@/components/scroll-reveal";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Shittim",
    template: "%s · Shittim",
  },
  description: "把讨论走成一条学会的路",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <ThreeParticlesBackground />
        <ScrollReveal />
        <AntdRegistry>
          <AppThemeProvider>{children}</AppThemeProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
