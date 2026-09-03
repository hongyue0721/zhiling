"use client";

import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import type { ReactNode } from "react";

const theme = {
  token: {
    colorPrimary: "#1677ff",
    colorInfo: "#1677ff",
    colorLink: "#0958d9",
    colorSuccess: "#389e0d",
    colorWarning: "#d48806",
    colorError: "#cf1322",
    colorText: "#102a43",
    colorTextSecondary: "#52687d",
    colorBorder: "#d9e7f7",
    colorBorderSecondary: "#e8f1fb",
    colorBgBase: "#ffffff",
    colorBgLayout: "#f5f9ff",
    borderRadius: 10,
    borderRadiusLG: 12,
    controlHeight: 42,
    fontFamily:
      'Inter, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif',
  },
  components: {
    Button: {
      primaryShadow: "none",
      defaultShadow: "none",
      dangerShadow: "none",
      fontWeight: 600,
    },
    Input: {
      activeShadow: "0 0 0 3px rgba(22, 119, 255, 0.12)",
    },
    Select: {
      activeOutlineColor: "rgba(22, 119, 255, 0.12)",
    },
    Alert: {
      withDescriptionPadding: "14px 16px",
    },
    Progress: {
      remainingColor: "#e8f1fb",
    },
    Segmented: {
      trackBg: "#edf5ff",
    },
  },
} as const;

export function AppThemeProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <ConfigProvider locale={zhCN} theme={theme}>
      {children}
    </ConfigProvider>
  );
}
