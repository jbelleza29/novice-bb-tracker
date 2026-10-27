import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import "./globals.css";

const text = Barlow({ variable: "--font-text", subsets: ["latin"], weight: ["400", "500", "600"] });
const condensed = Barlow_Condensed({ variable: "--font-num", subsets: ["latin"], weight: ["500", "600", "700"] });

export const metadata: Metadata = {
  title: "Novice Bodybuilding Tracker",
  description: "Workout log for the Ripped Body Novice Bodybuilding Program with automatic load progression.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${text.variable} ${condensed.variable}`}>
      <body>{children}</body>
    </html>
  );
}
