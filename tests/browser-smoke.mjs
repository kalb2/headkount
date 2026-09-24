import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
process.env.SCREENSHOT_DIR ||= "./test-results";
await mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const origin = "http://127.0.0.1:3100";
async function connect(key) {
  await page.goto(origin);
  await page.getByLabel("Connecteam API key").fill(key);
  await page.getByRole("button", { name: "Connect & load account" }).click();
  await page
    .getByRole("heading", { name: "Doors & brands", exact: true })
    .waitFor();
}
async function disconnect() {
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
}
try {
  await connect("test-main");
  await page.screenshot({
    path: process.env.SCREENSHOT_DIR + "/doors.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "+ Create door setup" }).click();
  await page.getByLabel("Door / job name").fill("Sephora — Santa Monica");
  await page
    .getByLabel("Address (optional)", { exact: true })
    .fill("123 Test Street");
  await page.getByLabel("West Coast Retail").check();
  await page.getByLabel("Brand 1 name").fill("House Labs");
  const brand = page.getByRole("group", { name: "Brand 1 groups" });
  await brand.getByRole("textbox").fill("House");
  await brand.getByLabel("House Labs Qualified").check();
  assert.equal(await brand.getByRole("checkbox").count(), 1);
  await page.getByRole("button", { name: "+ Add brand", exact: true }).click();
  await page.getByLabel("Brand 2 name").fill("MEJ");
  await page
    .getByRole("group", { name: "Brand 2 groups" })
    .getByLabel("MEJ Qualified")
    .check();
  await page.screenshot({
    path: process.env.SCREENSHOT_DIR + "/create.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Preview complete setup" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /House Labs Qualified/);
  assert.match(await dialog.innerText(), /MEJ Qualified/);
  await page.screenshot({
    path: process.env.SCREENSHOT_DIR + "/preview.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Create complete setup" }).click();
  await page.getByText("Operation completed.", { exact: true }).waitFor();
  assert.match(await page.locator("body").innerText(), /verified/);
  await page
    .getByRole("row")
    .filter({ hasText: "Sephora — The Grove" })
    .getByRole("button", { name: "Manage brands" })
    .click();
  await page
    .getByRole("checkbox", { name: "Select Sephora — The Grove / MEJ" })
    .check();
  await page
    .getByRole("group", { name: "Groups to apply" })
    .getByLabel("House Labs Qualified")
    .check();
  await page
    .getByRole("button", { name: "Preview assignment changes" })
    .click();
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /1 directly assigned users/);
  await dialog.getByRole("button", { name: "Apply reviewed changes" }).click();
  await page.getByText("Operation completed.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "+ Add brand to this door" }).click();
  await page.getByLabel("New brand name").fill("House Labs");
  await page
    .getByRole("group", { name: "New brand groups" })
    .getByLabel("House Labs Qualified")
    .check();
  await page.getByRole("button", { name: "Preview new brand" }).click();
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Apply reviewed changes" }).click();
  await page.getByText("Operation completed.", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Audit & Repair", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Select Sephora — The Grove / Refi" })
    .check();
  await page.getByLabel("Assignment change").selectOption("inherit");
  await page
    .getByRole("button", { name: "Preview assignment changes" })
    .click();
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /custom description and location/);
  await dialog.getByRole("button", { name: "Back to editing" }).click();
  await page
    .getByRole("button", { name: "Employee assignments", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Dropdown field" })
    .selectOption("30");
  await page.getByRole("combobox", { name: "Door value" }).selectOption("11");
  await page.getByLabel("Jane Example").check();
  await page.getByRole("button", { name: "Preview employee changes" }).click();
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /Santa Monica/);
  await dialog.getByRole("button", { name: "Apply reviewed changes" }).click();
  await page.getByText("Operation completed.", { exact: true }).waitFor();
  await disconnect();
  await connect("test-empty-groups");
  await page.getByRole("button", { name: "+ Create door setup" }).click();
  assert.match(
    await page.locator("body").innerText(),
    /returned no smart groups/,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Preview complete setup" })
      .isDisabled(),
    true,
  );
  await disconnect();
  await connect("test-groups-error");
  assert.match(
    await page.locator("body").innerText(),
    /Smart groups unavailable/,
  );
  await page.getByText("Account loaded with 1 warning(s)").click();
  assert.match(await page.locator("body").innerText(), /groups-403/);
  await disconnect();
  await connect("test-write-error");
  await page
    .getByRole("button", { name: "Audit & Repair", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Select Sephora — The Grove / MEJ" })
    .check();
  await page
    .getByRole("group", { name: "Groups to apply" })
    .getByLabel("House Labs Qualified")
    .check();
  await page
    .getByRole("button", { name: "Preview assignment changes" })
    .click();
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Apply reviewed changes" }).click();
  await page
    .getByText(
      "Operation needs attention. Inspect the results before retrying.",
      { exact: true },
    )
    .waitFor();
  assert.match(
    await page.locator("body").innerText(),
    /Example validation failure/,
  );
  await page.getByText("Connecteam error details", { exact: true }).click();
  assert.match(await page.locator("body").innerText(), /write-422/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: process.env.SCREENSHOT_DIR + "/mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: production UI creation, smart-group search/selection, preview/apply, manage/add brand, any-sub-job selection, inheritance warning, employee updates, empty/error group states, real API error details, mobile layout; no browser errors.",
  );
} finally {
  await browser.close();
}
