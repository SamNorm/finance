import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { MainNav, MainNavFallback } from "@/components/main-nav";
import { THEME_SCRIPT, ThemePicker } from "@/components/theme-picker";
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
  title: { template: "%s · Modeling workspace", default: "Modeling workspace" },
  description:
    "Credit and transaction modeling on your institution's scoring models.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The theme script sets data-theme before React hydrates.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex h-12 w-full max-w-[1400px] items-center gap-5 px-4 whitespace-nowrap sm:gap-8 sm:px-6">
            <Link
              href="/"
              className="hidden text-sm font-semibold tracking-tight sm:block"
            >
              Modeling workspace
            </Link>
            <Suspense fallback={<MainNavFallback />}>
              <MainNav />
            </Suspense>
            <div className="ml-auto flex shrink-0 items-center gap-3 text-xs text-muted">
              <ThemePicker />
              <span className="hidden sm:inline">Dev organization</span>
              <span className="rounded bg-warning-soft px-1.5 py-0.5 font-medium text-warning">
                No sign-in
              </span>
            </div>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
