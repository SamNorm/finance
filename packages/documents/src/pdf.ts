import { existsSync } from "node:fs";
import { chromium, type Browser } from "playwright-core";
import type { RenderedDocument } from "./html";

// HTML to PDF in headless Chromium (documents-plan.md §3.5): the page's
// print CSS lays it out, and the footer repeats on every page with its
// number. The browser is the one installed on the machine or container:
// CHROME_PATH, or the usual places.

const CANDIDATES = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

export function browserPath(): string | null {
  const configured = process.env.CHROME_PATH;
  if (configured) return existsSync(configured) ? configured : null;
  return CANDIDATES.find((path) => existsSync(path)) ?? null;
}

// One browser for the process, launched on first use.
let browser: Promise<Browser> | null = null;

function launch() {
  const executablePath = browserPath();
  if (!executablePath)
    throw new Error(
      "No Chrome or Chromium found to print PDFs. Install one, or set CHROME_PATH to it.",
    );
  browser ??= chromium
    .launch({ executablePath, headless: true })
    .catch((error) => {
      browser = null;
      throw error;
    });
  return browser;
}

export async function printPdf(
  document: RenderedDocument,
): Promise<{ pdf: Uint8Array; pages: number }> {
  const page = await (await launch()).newPage();
  try {
    await page.setContent(document.html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "Letter",
      landscape: document.orientation === "landscape",
      preferCSSPageSize: true,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: document.footer,
    });
    return { pdf: new Uint8Array(pdf), pages: countPages(pdf) };
  } finally {
    await page.close();
  }
}

// The pages Chromium wrote: each page object is "/Type /Page", unlike the
// "/Type /Pages" tree above them.
function countPages(pdf: Buffer) {
  return pdf.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g)?.length ?? 0;
}

export async function closeBrowser() {
  const open = browser;
  browser = null;
  if (open) await (await open).close();
}
