import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
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
    "Credit and transaction modeling on your institution's scoring model.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex h-12 w-full max-w-[1400px] items-center gap-5 px-4 whitespace-nowrap sm:gap-8 sm:px-6">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              Modeling workspace
            </Link>
            <nav className="flex h-full items-center gap-5 text-sm">
              <Link
                href="/scoring-model"
                className="flex h-full items-center border-b-2 border-accent font-medium"
              >
                Scoring model
              </Link>
            </nav>
            <div className="ml-auto flex items-center gap-2 text-xs text-muted">
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
