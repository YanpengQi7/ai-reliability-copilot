import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { LocaleProvider } from "@/lib/i18n/client";
import { getLocale } from "@/lib/i18n/server";
import { resolveAppBaseUrl } from "@/lib/appUrl";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(resolveAppBaseUrl()),
  title: {
    default: "AI Reliability Copilot — Evidence-first incident response",
    template: "%s | AI Reliability Copilot",
  },
  applicationName: "AI Reliability Copilot",
  description:
    "Investigate production incidents with cited evidence, practical mitigation plans, and coordinated follow-ups. Open-source SRE incident response copilot.",
  keywords: [
    "incident response",
    "SRE",
    "reliability engineering",
    "incident management",
    "AI copilot",
    "root cause analysis",
  ],
  openGraph: {
    type: "website",
    siteName: "AI Reliability Copilot",
    title: "AI Reliability Copilot — Evidence-first incident response",
    description:
      "Investigate production incidents with cited evidence, practical mitigation plans, and coordinated follow-ups.",
    url: "/",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "AI Reliability Copilot for evidence-first incident response",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Reliability Copilot — Evidence-first incident response",
    description:
      "Investigate production incidents with cited evidence, practical mitigation plans, and coordinated follow-ups.",
    images: ["/opengraph-image"],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
