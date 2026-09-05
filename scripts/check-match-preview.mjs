// Run in an isolated Chromium + Playwright container; does not access the DB.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire("/tmp/urtube-browser/package.json");
const { chromium } = require("playwright");
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: [
    "--no-sandbox",
    "--unsafely-treat-insecure-origin-as-secure=http://urtube-local-proxy-1",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const requests = [];
await context.route("**/*", (route) => {
  const url = new URL(route.request().url());
  requests.push(url.pathname);
  if (
    url.pathname.startsWith("/match-preview/") ||
    url.pathname === "/favicon.svg"
  )
    return route.continue();
  return route.abort();
});
const categories = [
  "Politic",
  "Music",
  "Sport",
  "Education",
  "Video gaming",
  "Streaming",
  "News",
  "Podcast",
  "channel type",
];
async function check(scope, label) {
  await page
    .locator(scope)
    .getByRole("checkbox", { name: label, exact: true })
    .check();
}
async function settle() {
  await page.waitForFunction(
    () =>
      document.querySelector("#detail").getAttribute("aria-busy") === "false",
  );
}
try {
  await page.goto("http://urtube-local-proxy-1/match-preview/");
  assert.equal(
    await page.locator("#interests-dialog").evaluate((e) => e.open),
    true,
  );
  assert.deepEqual(
    await page
      .locator("#interest-options input")
      .evaluateAll((els) => els.map((e) => e.value)),
    categories,
  );
  await page.locator("#interests-form button[type=submit]").click();
  assert.match(await page.locator("#interests-error").textContent(), /至少/);
  for (const label of categories) await check("#interest-options", label);
  await page.locator("#interests-form button[type=submit]").click();
  await page.locator("#create-button").click();
  await page.locator("#topic-name").fill("音樂與日常");
  await page.locator("#save-topic").click();
  assert.match(await page.locator("#topic-error").textContent(), /至少選擇 1/);
  for (const label of categories)
    await check("#topic-options", label);
  assert.equal(await page.locator("#topic-options input:disabled").count(), 0);
  await page.locator("#save-topic").click();
  await settle();
  assert.equal(await page.locator(".candidate-card").count(), 6);
  assert.equal(await page.locator(".candidate-card .match-reason").count(), 6);
  assert.match(await page.locator(".candidate-card").first().locator(".match-reason").textContent(), /為什麼推薦給你.*示範說明/s);
  await page.locator("[data-person=lin]").click();
  assert.match(await page.locator("#compare-dialog .match-reason").textContent(), /Lin/);
  assert.equal(
    await page.locator("#compare-dialog").evaluate((e) => e.open),
    true,
  );
  await page.getByRole("button", { name: "返回名單", exact: true }).click();
  await page.locator("#create-button").click();
  await page.locator("#topic-name").fill("遊戲時間");
  await check("#topic-options", "Video gaming");
  await check("#topic-options", "Streaming");
  await page.locator("#save-topic").click();
  await settle();
  assert.equal(await page.locator(".candidate-card").count(), 3);
  await page.getByRole("button", { name: "編輯主題", exact: true }).click();
  await page.locator("#topic-name").fill("遊戲與實況");
  await page.locator("#save-topic").click();
  await settle();
  await page.locator("#search").fill("不存在");
  assert.equal(await page.locator(".topic-row").count(), 0);
  await page.locator("#search").fill("");
  assert.equal(await page.locator(".topic-row").count(), 2);
  await page.reload();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("urtube.match-topic-preview.v1")).topics[0].categories.length), 9);
  assert.equal(await page.locator(".topic-row").count(), 2);
  await page.locator(".topic-row").first().click();
  await settle();
  await page.screenshot({ path: "/out/desktop.png", fullPage: true });
  // Escaping and empty results are exercised through ordinary UI input.
  await page.locator("#create-button").click();
  await page.locator("#topic-name").fill("<img src=x onerror=alert(1)>");
  await check("#topic-options", "Politic");
  await page.locator("#save-topic").click();
  await settle();
  assert.equal(await page.locator("#detail img").count(), 0);
  assert.match(await page.locator("#detail").textContent(), /還沒有共同話題/);
  await page.getByRole("button", { name: "刪除主題", exact: true }).click();
  await page
    .locator("#confirm-dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  assert.equal(await page.locator(".topic-row").count(), 3);
  await page.getByRole("button", { name: "刪除主題", exact: true }).click();
  await page.locator("#confirm-form button[type=submit]").click();
  assert.equal(await page.locator(".topic-row").count(), 2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  assert.equal(await page.locator(".sidebar").isVisible(), true);
  await page.locator(".topic-row").first().click();
  await settle();
  assert.equal(await page.locator(".sidebar").isVisible(), false);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: "/out/mobile.png", fullPage: true });
  await page.locator("[data-action=back]").click();
  assert.equal(await page.locator(".sidebar").isVisible(), true);
  await page.locator("#create-button").click();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: "/out/create-mobile.png", fullPage: true });
  await page.locator("#topic-dialog [data-close]").first().click();
  await page.locator("#reset-button").click();
  await page.locator("#confirm-form button[type=submit]").click();
  assert.equal(
    await page.locator("#interests-dialog").evaluate((e) => e.open),
    true,
  );
  await page.reload();
  assert.equal(await page.locator(".topic-row").count(), 0);
  assert.deepEqual(errors, []);
  assert.ok(await page.evaluate(() => {
    const container = document.createElement("div");
    container.innerHTML = matchReasonSection({text: '<img src=x onerror=alert(1)>', isExample: true});
    return !container.querySelector('img') && container.textContent.includes('<img')
      && matchReasonSection(null).includes('配對說明尚未提供');
  }));
  assert.ok(
    requests.every(
      (p) => p.startsWith("/match-preview/") || p === "/favicon.svg",
    ),
  );
  console.log(
    "PASS: fixed categories, all 9 selected and persisted, matching explanations, validation, create/edit/delete, filtering, comparison, local persistence, empty state, escaping, mobile navigation, reset; no backend requests or browser errors.",
  );
} finally {
  await browser.close();
}
