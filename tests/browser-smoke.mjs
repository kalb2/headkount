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
  assert.match(await page.locator("body").innerText(), /No smart groups yet/);
  assert.match(await page.locator("body").innerText(), /Create smart group/);
  assert.equal(
    await page
      .getByRole("button", { name: "Preview complete setup" })
      .isDisabled(),
    true,
  );
  await page.getByLabel("Door / job name").fill("Empty Account Door");
  await page.getByLabel("West Coast Retail").check();
  await page.getByLabel("Brand 1 name").fill("MEJ");
  const created = page.getByRole("group", { name: "Brand 1 groups" });
  if (await created.getByRole("button", { name: "Create smart group" }).count())
    await created.getByRole("button", { name: "Create smart group" }).click();
  await created.getByLabel("Group name").fill("Santa Monica Qualified");
  await created.getByLabel("Brand 1 groups segment").selectOption("new");
  await created.getByLabel("New segment name").fill("Stores");
  await created.getByRole("button", { name: "+ Add dropdown filter" }).click();
  await created.getByLabel("Filter 1 field").selectOption("30");
  await created.getByRole("checkbox", { name: "Santa Monica" }).check();
  await created.getByRole("button", { name: "Add group to this list" }).click();
  await created
    .getByRole("checkbox", { name: /Santa Monica Qualified/ })
    .check();
  assert.equal(
    await page
      .getByRole("button", { name: "Preview complete setup" })
      .isDisabled(),
    false,
  );
  await page.getByRole("button", { name: "Preview complete setup" }).click();
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /Smart groups to create/);
  assert.match(await dialog.innerText(), /Santa Monica Qualified/);
  assert.match(await dialog.innerText(), /New segment Stores/);
  assert.match(await dialog.innerText(), /Doors: Santa Monica/);
  await dialog.getByRole("button", { name: "Create complete setup" }).click();
  await page.getByText("Operation completed.", { exact: true }).waitFor();
  assert.match(
    await page.locator("body").innerText(),
    /Smart group Santa Monica Qualified: verified/,
  );
  assert.match(
    await page.locator("body").innerText(),
    /Request ID: test-request/,
  );
  assert.match(await page.locator(".status").innerText(), /1 smart groups/);
  await page.getByRole("button", { name: "+ Create door setup" }).click();
  await page
    .getByRole("checkbox", { name: /Santa Monica Qualified/ })
    .first()
    .waitFor();
  await page.getByRole("button", { name: "Back to doors" }).click();
  await disconnect();
  await connect("test-groups-error");
  assert.match(await page.locator("body").innerText(), /Smart groups blocked/);
  assert.doesNotMatch(await page.locator("body").innerText(), /unavailable/);
  await page.getByRole("button", { name: "+ Create door setup" }).click();
  assert.match(
    await page.locator("body").innerText(),
    /Smart groups are blocked/,
  );
  assert.equal(await page.getByLabel("Group name").count(), 0);
  await page.getByRole("button", { name: "Back to doors" }).click();
  await page.getByText("Account loaded with 1 warning(s)").click();
  assert.match(await page.locator("body").innerText(), /groups-403/);
  await disconnect();
  await connect("test-groups-shape");
  assert.match(
    await page.locator("body").innerText(),
    /Smart groups could not be loaded/,
  );
  assert.match(await page.locator("body").innerText(), /groups-shape/);
  assert.doesNotMatch(
    await page.locator("body").innerText(),
    /unavailable|Smart groups are blocked/,
  );
  await page.getByRole("button", { name: "Create smart group" }).click();
  await page.getByLabel("Group name").first().waitFor();
  assert.match(await page.locator("body").innerText(), /could not be read/);
  await disconnect();
  await connect("test-eligibility");
  await page.getByRole("button", { name: "+ Create door setup" }).click();
  await page.getByLabel("Door / job name").fill("Eligibility Door");
  await page.getByLabel("West Coast Retail").check();
  await page.getByLabel("Brand 1 name").fill("MEJ");
  await page.getByLabel("Job dropdown").selectOption("30");
  await page.getByLabel("Brand dropdown").selectOption("40");
  await page.getByLabel("Eligibility segment").selectOption("7");
  await page
    .getByRole("group", { name: "Who already qualifies for this job" })
    .getByLabel("MEJ Qualified")
    .check();
  await page.getByLabel("Brand 1 tag").selectOption("20");
  await page.getByRole("button", { name: "+ Add brand", exact: true }).click();
  await page.getByLabel("Brand 2 name").fill("Refi");
  await page.getByLabel("Brand 2 tag").selectOption("21");
  await page.getByRole("button", { name: "Preview complete setup" }).click();
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /Job AND brand/);
  assert.match(await dialog.innerText(), /Jane Example/);
  assert.doesNotMatch(await dialog.innerText(), /Sam Example/);
  await dialog.getByRole("button", { name: "Create complete setup" }).click();
  await page.getByText("Operation completed.", { exact: true }).waitFor();
  assert.match(
    await page.locator("body").innerText(),
    /Smart group Eligibility Door — MEJ: verified/,
  );
  await page.getByRole("button", { name: "+ Create door setup" }).click();
  await page
    .getByRole("checkbox", { name: /Eligibility Door — MEJ/ })
    .first()
    .waitFor();
  await page.getByRole("button", { name: "Back to doors" }).click();
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
    "PASS: production UI creation, smart-group search/selection, inline create-and-assign, job-and-brand eligibility, preview/apply, manage/add brand, any-sub-job selection, inheritance warning, employee updates, empty/error group states, real API error details, mobile layout; no browser errors.",
  );
} finally {
  await browser.close();
}
