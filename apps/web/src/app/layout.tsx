import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { BOOT_SCRIPT } from "@/components/boot-script";
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
    // The boot script sets data-theme and data-sidebar before React hydrates.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
