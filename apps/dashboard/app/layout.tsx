import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
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
    <html lang="en">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased bg-slate-50 text-slate-900 font-sans text-[13px] leading-relaxed`}
      >
        {children}
      </body>
    </html>
  );
}
