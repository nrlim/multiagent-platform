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
  title: "AgentHive — Multi-Agent Platform",
  description:
    "A recursive multi-agent platform where AI agents spawn other agents to complete complex programming tasks. Supports Google Gemini, OpenAI GPT, and Anthropic Claude.",
  keywords: ["AI agents", "multi-agent", "LLM", "Gemini", "GPT", "Claude", "code generation"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#0a0a0f]`}
      >
        {children}
      </body>
    </html>
  );
}
