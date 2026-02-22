import type { Metadata } from "next";
import { AuthSessionProvider } from "@/components/auth-session-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "MangoType",
  description: "Chinese-first X writer and scheduler"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <AuthSessionProvider>{children}</AuthSessionProvider>
      </body>
    </html>
  );
}
