import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const rootDir = process.cwd();
const extensionPath = path.join(rootDir, "dist", "extension");
const userDataDir = path.join(rootDir, ".playwright", "job-search-extension-profile");
const startUrl = process.argv[2] ?? process.env.PLAYWRIGHT_START_URL ?? "http://127.0.0.1:4312";

if (!fs.existsSync(extensionPath)) {
  console.error("Missing dist/extension. Run `npm run build` first.");
  process.exit(1);
}

fs.mkdirSync(userDataDir, { recursive: true });

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`
  ]
});

const page = context.pages()[0] ?? (await context.newPage());
await page.goto(startUrl, { waitUntil: "domcontentloaded" });

let extensionId = "unknown";
const serviceWorker =
  context.serviceWorkers()[0] ??
  (await context.waitForEvent("serviceworker", { timeout: 10000 }).catch(() => null));

if (serviceWorker) {
  extensionId = new URL(serviceWorker.url()).host;
}

console.log(`Playwright Chromium launched with unpacked extension from ${extensionPath}`);
console.log(`Start URL: ${startUrl}`);
console.log(`Extension ID: ${extensionId}`);
console.log("Browser will stay open until you press Ctrl+C.");

let closed = false;

async function shutdown() {
  if (closed) {
    return;
  }
  closed = true;
  await context.close();
}

process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});

await new Promise(() => {});
