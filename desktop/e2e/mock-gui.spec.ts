import { expect, test } from "@playwright/test";

test("mock backend covers the primary desktop flows", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });
  await page.goto("/");

  await expect(page).toHaveTitle("Pixiv PBD Manager");
  await expect(page.getByText("Sample Artist", { exact: true })).toBeVisible();
  await expect(page.getByText("Studio Example", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "图库" }).click();
  await expect(page.getByRole("button", { name: /101000001_p0\.jpg/ })).toBeVisible();
  await page.getByRole("button", { name: /101000001_p0\.jpg/ }).click();
  await expect(page.getByRole("heading", { name: "101000001_p0.jpg" })).toBeVisible();
  await expect(page.locator(".libraryDetailCounter")).toHaveText("1 / 4");

  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("heading", { name: "101000001_p1.jpg" })).toBeVisible();
  await page.getByRole("button", { name: "隐藏详情" }).click();
  await expect(page.locator(".libraryDetailMeta")).toHaveCount(0);
  await page.getByRole("button", { name: "显示详情" }).click();
  await page.getByRole("button", { name: "关闭" }).click();
  await page.getByRole("button", { name: "选择图片" }).first().click();
  await expect(page.getByText("已选 1 张")).toBeVisible();
  await page.getByRole("button", { name: "批量编辑" }).click();
  await expect(page.getByRole("heading", { name: "批量编辑" })).toBeVisible();
  await page.getByRole("combobox").selectOption("5");
  await page.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page.getByText("已更新 1 张图片")).toBeVisible();
  await page.getByRole("button", { name: "图库体检", exact: true }).click();
  await expect(page.getByRole("heading", { name: "图库体检" })).toBeVisible();
  await expect(page.getByText("数据库可读取，共 2 位艺术家。")).toBeVisible();
  await page.getByRole("button", { name: "返回图库" }).click();

  await page.getByRole("button", { name: "艺术家" }).click();
  await page.getByRole("button", { name: "扫描", exact: true }).click();
  await expect(page.getByRole("heading", { name: "扫描预览" })).toBeVisible();
  await expect(page.getByText("识别依据", { exact: true })).toBeVisible();
  await expect(page.getByText("在线查询作品 ID", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();

  await page.getByRole("button", { name: "相似图片" }).click();
  await page.getByRole("button", { name: "查找相似图片" }).click();
  await expect(page.getByText(/4 files.*1 groups/i)).toBeVisible();
  expect(browserErrors).toEqual([]);
});
