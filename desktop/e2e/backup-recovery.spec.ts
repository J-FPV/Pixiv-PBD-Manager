import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("backup creation, category preview and destructive confirmations", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/");
  await expect(page).toHaveTitle("Pixiv PBD Manager");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "备份与恢复", exact: true }).click();
  await expect(page.locator(".recoveryTable tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "立即备份" }).click();
  await expect(page.locator(".recoveryTable tbody tr")).toHaveCount(2);
  await page.getByRole("button", { name: "恢复预览", exact: true }).first().click();
  const modal = page.locator(".recoveryRestoreModal");
  await expect(modal.locator(".recoveryCategories label").first()).toHaveCSS("flex-direction", "row");
  await expect(modal.locator('input[type="checkbox"]').first()).toHaveCSS("width", "16px");
  await modal.getByLabel("艺术家数据库", { exact: true }).uncheck();
  await modal.getByLabel("设置", { exact: true }).uncheck();
  await modal.getByRole("button", { name: "恢复预览", exact: true }).click();
  await expect(modal.locator(".recoveryPreviewBody")).toContainText("图片标注");
  await expect(modal.locator(".recoveryPreviewBody")).toContainText("待匹配标注 1");
  await modal.locator("details summary").click();
  await expect(modal.locator(".recoveryDifference")).toContainText("101000001_p1.jpg");
  await modal.getByRole("button", { name: "恢复", exact: true }).click();
  await expect(page.locator(".confirmModal")).toContainText("后续修改会被回退");
  await page.locator(".confirmModal").getByRole("button", { name: "取消", exact: true }).click();
  for (const [width, height, theme] of [[1365, 900, "light"], [980, 660, "dark"], [680, 660, "dark"]] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    const bounds = await modal.boundingBox();
    expect(bounds!.height).toBeLessThanOrEqual(height);
    expect(bounds!.width).toBeLessThanOrEqual(width);
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    await page.screenshot({ path: join(tmpdir(), "pbd-backup-qa", `preview-${width}-${theme}.png`) });
  }
  await modal.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "删除", exact: true }).first().click();
  await expect(page.locator(".confirmModal")).toContainText("不影响当前图库数据");
  await page.locator(".confirmModal").getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.locator(".recoveryTable tbody tr")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("an image edit can be undone without losing detail selection", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "图库", exact: true }).click();
  await page.getByRole("button", { name: /101000001_p1\.jpg/ }).click();
  const favorite = page.locator(".libraryFavoriteButton");
  await favorite.click();
  await expect(favorite).toHaveClass(/active/);
  await expect(page.locator(".recoveryToast")).toBeVisible();
  await page.locator(".recoveryToast").getByRole("button", { name: /撤销:/ }).click();
  await expect(favorite).not.toHaveClass(/active/);
  await expect(page.getByRole("heading", { name: "101000001_p1.jpg" })).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "备份与恢复", exact: true }).click();
  await expect(page.locator(".recoveryHistory")).toContainText("已撤销");
});

test("confirmed restore reloads before allowing further writes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "备份与恢复", exact: true }).click();
  await page.getByRole("button", { name: "恢复预览", exact: true }).first().click();
  const modal = page.locator(".recoveryRestoreModal");
  await modal.getByRole("button", { name: "恢复预览", exact: true }).click();
  await modal.getByRole("button", { name: "恢复", exact: true }).click();
  const reloaded = page.waitForEvent("load");
  await page.locator(".confirmModal").getByRole("button", { name: "恢复", exact: true }).click();
  await reloaded;
  await expect(modal).toHaveCount(0);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "备份与恢复", exact: true }).click();
  await page.getByRole("button", { name: "立即备份" }).click();
  await expect(page.locator(".recoveryTable tbody tr")).toHaveCount(2);
});
