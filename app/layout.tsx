import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AimTune — FPS 灵敏度测试与换算",
  description:
    "通过可解释的短测试，比较速度、精度与控制感，获得适合当前设备与游戏习惯的灵敏度建议。",
  openGraph: {
    title: "AimTune — FPS 灵敏度测试与换算",
    description: "用单点、多目标、跟枪与压枪测试，找到更适合你的灵敏度起点。",
    images: ["/aimtune-social.svg"],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/aimtune-social.svg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
