import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MOCK_SCAN_PREVIEW } from "../src/mockData";

const firstPath = "C:\\PixivLibrary\\Preview Artist's illustrations - pixiv";
const secondPath = "C:\\PixivLibrary\\Second Artist-13572468";
const unknownPath = "C:\\PixivLibrary\\misc";
const preview = {
  ...MOCK_SCAN_PREVIEW,
  changes: [MOCK_SCAN_PREVIEW.changes[0], {
    ...MOCK_SCAN_PREVIEW.changes[0], id: "new_artist:13572468", artist_id: "13572468",
    name: "Second Artist", save_paths: [secondPath]
  }],
  unmatched_folders: [
    { path: firstPath, count: 3 }, { path: secondPath, count: 2 }, { path: unknownPath, count: 1 }
  ]
};

async function openScan(page: Page) {
  // Backend behavior is covered by Python tests; inject a small IPC fixture for
  // preview cancellation, partial apply, and retry without touching user data.
  await page.route("**/src/mockApi.ts", async (route) => {
    const response = await route.fetch();
    const script = (await response.text())
      .replace("return MOCK_SCAN_PREVIEW;", `return ${JSON.stringify(preview)};`)
      .replace('case "scan.preview":', `case "scan.apply": {
        window.scanApplyPayload = values;
        if (window.failScanApply) throw new Error("test: database write failed");
        const paths = values.operations.flatMap(op => op.save_paths || op.paths || []);
        return { applied: values.operations.length, new_artists: values.operations.length,
          name_changes: 0, save_paths_added: 0, work_ids_added: 0,
          db_path: "mock", artists: MOCK_ARTISTS,
          assigned_folders: values.unmatched_paths.filter(path => paths.includes(path)) };
      }
      case "scan.preview":`);
    await route.fulfill({ response, body: script });
  });
  await page.goto("/");
  await expect(page).toHaveTitle("Pixiv PBD Manager");
  await page.getByRole("button", { name: "扫描", exact: true }).click();
  await expect(page.getByRole("heading", { name: "扫描预览" })).toBeVisible();
}

async function expectUnmatched(page: Page, paths: string[]) {
  await page.getByRole("button", { name: "未识别文件夹", exact: true }).click();
  await expect(page.locator(".unmatchedRow .pathText")).toHaveText(paths);
}

test("closing scan preview keeps unapplied folders visible and cached", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await openScan(page);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expectUnmatched(page, [firstPath, secondPath, unknownPath]);
  await expect(page.locator(".unmatchedRow .numeric")).toHaveText(["3", "2", "1"]);
  await page.getByRole("button", { name: "艺术家", exact: true }).click();
  await page.getByRole("button", { name: "扫描结果", exact: true }).click();
  await expect(page.locator(".scanChangeRow")).toHaveCount(2);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expectUnmatched(page, [firstPath, secondPath, unknownPath]);
  await page.reload();
  await expectUnmatched(page, [firstPath, secondPath, unknownPath]);
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await page.screenshot({ path: join(tmpdir(), "pbd-scan-unmatched.png") });
  expect(errors).toEqual([]);
});

test("partial apply removes only folders actually assigned and persists the rest", async ({ page }) => {
  await openScan(page);
  await page.locator(".scanChangeRow").filter({ hasText: "Second Artist" }).getByRole("checkbox").uncheck();
  await page.getByRole("button", { name: "应用所选 (1)", exact: true }).click();
  await expectUnmatched(page, [secondPath, unknownPath]);
  const request = await page.evaluate(() => Reflect.get(window, "scanApplyPayload"));
  expect(request.unmatched_paths).toEqual([firstPath, secondPath, unknownPath]);
  expect(request.operations.map((op: { artist_id: string }) => op.artist_id)).toEqual(["24681357"]);
  await page.reload();
  await expectUnmatched(page, [secondPath, unknownPath]);
});

test("failed apply keeps folders and scan preview available for retry", async ({ page }) => {
  await openScan(page);
  await page.evaluate(() => Reflect.set(window, "failScanApply", true));
  await page.getByRole("button", { name: "应用所选 (2)", exact: true }).click();
  await expectUnmatched(page, [firstPath, secondPath, unknownPath]);
  await page.getByRole("button", { name: "艺术家", exact: true }).click();
  await page.getByRole("button", { name: "扫描结果", exact: true }).click();
  await page.evaluate(() => Reflect.set(window, "failScanApply", false));
  await page.getByRole("button", { name: "应用所选 (2)", exact: true }).click();
  await expectUnmatched(page, [unknownPath]);
});
