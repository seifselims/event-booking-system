import type { Metadata, Viewport } from "next";
import { Baloo_2, Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { TRPCReactProvider } from "@/lib/trpc/react";

/** Display voice — the rounded pop logotype (DESIGN.md § Type). */
const baloo = Baloo_2({
  variable: "--font-baloo",
  subsets: ["latin"],
  display: "swap",
});

/** Body voice. */
const hankenGrotesk = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Gate — tickets for the night you'll keep",
  description:
    "Buy tickets as a guest, with no account. Your QR arrives by email and is scanned at the door.",
};

export const viewport: Viewport = {
  // Matches the landing ground so mobile browser chrome joins the design.
  themeColor: "#AE2F00",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${baloo.variable} ${hankenGrotesk.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TRPCReactProvider>{children}</TRPCReactProvider>
      </body>
    </html>
  );
}
