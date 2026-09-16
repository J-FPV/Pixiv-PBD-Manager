import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

async function dragTile(page: Page, tile: Locator, distance = 35) {
  const box = await tile.boundingBox();
  if (!box) throw new Error("Missing tile");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + distance, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const calls: { command: string; paths: string[] }[] = [];
    Object.assign(window, {
      dragCalls: calls,
      failDrag: false,
      __TAURI_INTERNALS__: {
        invoke: (command: string, args: { paths: string[] }) => {
          calls.push({ command, paths: args.paths });
          if (Reflect.get(window, "failDrag")) return Promise.reject("Original file is missing");
          return Promise.resolve();
        }
      }
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "图库", exact: true }).click();
  await expect(page.locator(".libraryTileOpen").first()).toBeVisible();
});

test("dragging exports original paths, preserves selection, and does not open the preview", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const tiles = page.locator(".libraryTileOpen");
  await expect(page).toHaveTitle("Pixiv PBD Manager");
  await expect(tiles.first().locator("img")).toHaveAttribute("draggable", "false");
  await dragTile(page, tiles.first());
  const first = await page.evaluate(() => Reflect.get(window, "dragCalls"));
  expect(first).toHaveLength(1);
  expect(first[0].command).toBe("drag_original_files");
  expect(first[0].paths).toHaveLength(1);
  expect(first[0].paths[0]).toMatch(/101000001_p0\.jpg$/);
  expect(first[0].paths[0]).not.toMatch(/thumb:|thumb\.localhost|data:|blob:/);
  await expect(page.locator(".libraryDetailModal")).toHaveCount(0);

  await page.locator(".libraryTileSelect").nth(0).click();
  await page.locator(".libraryTileSelect").nth(1).click();
  await dragTile(page, tiles.first());
  const batch = await page.evaluate(() => Reflect.get(window, "dragCalls"));
  expect(batch).toHaveLength(2);
  expect(batch[1].paths).toHaveLength(2);
  await expect(page.getByText("已选 2 张")).toBeVisible();
  await dragTile(page, tiles.nth(2));
  const unselected = await page.evaluate(() => Reflect.get(window, "dragCalls"));
  expect(unselected[2].paths).toHaveLength(1);
  await expect(page.locator(".libraryDetailModal")).toHaveCount(0);
  await tiles.first().click();
  await expect(page.getByRole("heading", { name: "101000001_p0.jpg" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("small mouse movement still clicks, and native failures are visible and recoverable", async ({ page }) => {
  const tile = page.locator(".libraryTileOpen").first();
  await dragTile(page, tile, 2);
  await expect(page.getByRole("heading", { name: "101000001_p0.jpg" })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "dragCalls"))).toEqual([]);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.evaluate(() => Reflect.set(window, "failDrag", true));
  await dragTile(page, tile);
  await expect(page.getByRole("alert")).toContainText("原图拖出失败");
  await expect(page.locator(".libraryDetailModal")).toHaveCount(0);
  await page.getByRole("alert").getByRole("button", { name: "关闭" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await tile.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "101000001_p0.jpg" })).toBeVisible();
});
