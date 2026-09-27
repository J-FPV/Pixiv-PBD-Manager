import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MOCK_LIBRARY_IMAGES } from "../src/mockData";
import { applyLibraryMetadataPatch, mergeAnnotationResponse } from "../src/hooks/useLibraryMetadata";

test("annotation response revisions and patches preserve independent copies", () => {
  const original = { ...MOCK_LIBRARY_IMAGES[0], annotation_revision: 8, rating: 5 };
  const stale = { ...original, annotation_revision: 3, rating: 1 };
  expect(mergeAnnotationResponse(original, stale).rating).toBe(5);
  expect(mergeAnnotationResponse(original, { ...stale, image_id: "different-copy" }).rating).toBe(1);
  const edited = applyLibraryMetadataPatch(original, { tags: ["new"], favorite: false, rating: 2 });
  expect(edited.tags).toEqual(["new"]);
  expect(original.rating).toBe(5);
});

test("unverified recovery requires confirmation and restores annotations onto only the chosen image", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "图库", exact: true }).click();
  await page.getByRole("button", { name: "更多 (2)" }).click();
  await page.getByRole("button", { name: "待恢复标注 (2)" }).click();
  const modal = page.getByRole("dialog", { name: "待恢复标注", exact: true });
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: /reference-original/ }).click();
  await expect(modal.getByText("尚未验证内容", { exact: true })).toBeVisible();
  const target = modal.getByRole("listbox", { name: "恢复到图片" });
  await target.selectOption("mock-101000001-1");
  await modal.getByRole("button", { name: "恢复标注" }).click();
  await expect(page.locator(".confirmModal")).toContainText("无法确认两张图片是否相同");
  await page.locator(".confirmModal").getByRole("button", { name: "取消" }).click();
  await expect(modal.getByRole("heading")).toContainText("(2)");
  await modal.getByRole("button", { name: "恢复标注" }).click();
  await page.locator(".confirmModal").getByRole("button", { name: "恢复标注" }).click();
  await expect(modal.getByRole("status")).toHaveText("标注已恢复");
  await expect(modal.getByRole("heading")).toContainText("(1)");
  await modal.locator("footer").getByRole("button", { name: "关闭" }).click();
  await page.getByRole("button", { name: /101000001_p1\.jpg/ }).click();
  await expect(page.locator(".libraryFavoriteButton")).toHaveClass(/active/);
  await expect(page.locator(".libraryDetailMeta")).toContainText("composition");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "更多 (1)" }).click();
  await page.getByRole("button", { name: "待恢复标注 (1)" }).click();
  await modal.getByRole("button", { name: /sketch-original/ }).click();
  await expect(target.locator('option[value="unlinked-1"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("rapid metadata edits survive background tag refresh and library reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "图库", exact: true }).click();
  await page.getByRole("button", { name: /101000001_p1\.jpg/ }).click();
  const favorite = page.locator(".libraryFavoriteButton");
  await favorite.click();
  await page.locator(".libraryMarkerButtons .used").click();
  await expect(favorite).toHaveClass(/active/, { timeout: 100 });
  await expect(page.locator(".libraryMarkerButtons .used")).toHaveClass(/active/, { timeout: 100 });
  await expect(page.getByText("已更新 1 张图片")).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.locator(".libraryToolbar button").filter({ hasText: "抓取 Pixiv 标签" }).click();
  await page.getByRole("button", { name: "重新扫描", exact: true }).click();
  await page.getByRole("button", { name: /101000001_p1\.jpg/ }).click();
  await expect(favorite).toHaveClass(/active/);
  await expect(page.locator(".libraryMarkerButtons .used")).toHaveClass(/active/);
});

test("recovery modal stays readable at minimum window sizes in both themes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/");
  await page.getByRole("button", { name: "图库", exact: true }).click();
  await page.getByRole("button", { name: "更多 (2)" }).click();
  await page.getByRole("button", { name: "待恢复标注 (2)" }).click();
  const modal = page.getByRole("dialog", { name: "待恢复标注" });
  await modal.getByRole("button", { name: /reference-original/ }).click();
  await modal.getByRole("listbox").selectOption("mock-101000001-1");
  for (const [width, height, theme] of [[1365, 900, "light"], [980, 660, "dark"], [680, 660, "dark"]] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await expect(page).toHaveTitle("Pixiv PBD Manager");
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    const bounds = await modal.boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(width);
    expect(bounds!.height).toBeLessThanOrEqual(height);
    expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(modal.locator(".annotationRecoveryBody")).toHaveCSS("overflow-y", "auto");
    const body = await modal.locator(".annotationRecoveryBody").boundingBox();
    const footer = await modal.locator("footer").boundingBox();
    expect(body!.y + body!.height).toBeLessThanOrEqual(footer!.y);
    await page.screenshot({ path: join(tmpdir(), "pbd-annotations-qa", `recovery-${width}-${theme}.png`) });
  }
  expect(errors).toEqual([]);
});
