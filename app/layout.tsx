// app/layout.tsx — replace your existing file
import type { Metadata } from "next";
import { Bungee, Lato, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Big chunky display — substitute Joyride here when you license it.
const display = Bungee({
  weight: ["400"],
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const sans = Lato({
  weight: ["400", "700", "900"],
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MLB Player Stat Database",
  description: "Browse and search MLB player statistics",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${display.variable} ${sans.variable} ${mono.variable} antialiased bg-page text-ink`}
      >
        {children}
      </body>
    </html>
  );
}
