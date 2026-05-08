import { pathToFileURL } from "node:url";

const playwrightImport = process.env.PLAYWRIGHT_IMPORT || "playwright";
const playwrightModule = await import(playwrightImport.startsWith("/") ? pathToFileURL(playwrightImport).href : playwrightImport);
const { chromium } = playwrightModule;

const url = process.argv[2] || "http://127.0.0.1:4173/";
const screenshots = {
  desktop: "/tmp/culvert-map-desktop.png",
  mobile: "/tmp/culvert-map-mobile.png",
};

const launchOptions = { headless: true };
if (process.env.BROWSER_EXECUTABLE) {
  launchOptions.executablePath = process.env.BROWSER_EXECUTABLE;
}

const browser = await chromium.launch(launchOptions);
const failures = [];

try {
  await runDesktopFlow();
  await runMobileDeniedLocationFlow();
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`Smoke test failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Smoke test passed.");
console.log(`Desktop screenshot: ${screenshots.desktop}`);
console.log(`Mobile screenshot: ${screenshots.mobile}`);

async function runDesktopFlow() {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const consoleIssues = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      const text = message.text();
      if (!isIgnoredConsoleIssue(text)) {
        consoleIssues.push(`${message.type()}: ${text}`);
      }
    }
  });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "桃園川暗渠" }).waitFor({ timeout: 15000 });
  await expectText(page, "地図出典:");
  await expectText(page, "地理院タイル");
  await expectText(page, "OpenStreetMap contributors");
  await expectText(page, "根拠 A");

  await page.getByLabel("暗渠名・地域名で検索").fill("呑川本流");
  await page.locator("#searchResults").getByRole("button", { name: /呑川本流暗渠/ }).click();
  await page.getByRole("heading", { name: "呑川本流暗渠" }).waitFor({ timeout: 5000 });
  await expectText(page, "線形出典");
  await expectText(page, "OpenStreetMap linework");

  await page.getByLabel("暗渠名・地域名で検索").fill("逆川");
  await page.locator("#searchResults").getByRole("button", { name: /旧逆川道路/ }).click();
  await page.getByRole("heading", { name: "旧逆川道路" }).waitFor({ timeout: 5000 });
  await expectText(page, "根拠 C");

  await page.getByRole("button", { name: "レイヤーを切替" }).click();
  await page.getByLabel("淡色地図").check();
  await page.locator("#terrainToggle").check();
  await page.locator("#culvertToggle").uncheck();
  await page.locator("#culvertToggle").check();
  await page.getByRole("button", { name: "閉じる" }).click();

  await page.screenshot({ path: screenshots.desktop, fullPage: false });
  if (consoleIssues.length) failures.push(`Desktop console issues: ${consoleIssues.join(" | ")}`);
  await context.close();
}

async function runMobileDeniedLocationFlow() {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(_success, error) {
          error({ code: 1, message: "denied by smoke test" });
        },
      },
    });
  });
  const page = await context.newPage();
  const consoleIssues = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      const text = message.text();
      if (!isIgnoredConsoleIssue(text)) {
        consoleIssues.push(`${message.type()}: ${text}`);
      }
    }
  });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "桃園川暗渠" }).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "現在地を表示" }).click();
  await expectText(page, "現在地を取得できませんでした。");
  await page.screenshot({ path: screenshots.mobile, fullPage: false });
  if (consoleIssues.length) failures.push(`Mobile console issues: ${consoleIssues.join(" | ")}`);
  await context.close();
}

async function expectText(page, text) {
  const count = await page.getByText(text, { exact: false }).count();
  if (count === 0) failures.push(`Missing visible text: ${text}`);
}

function isIgnoredConsoleIssue(text) {
  return (
    text.includes("Failed to load resource") ||
    text.includes("Map error") ||
    text.includes("GL Driver Message") ||
    text.includes("GPU stall due to ReadPixels")
  );
}
