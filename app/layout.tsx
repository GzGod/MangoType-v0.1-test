import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hanfully",
  description: "Chinese-first X writer and scheduler"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
