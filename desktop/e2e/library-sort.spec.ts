import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function openLibrary(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "图库", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "排序方式" })).toHaveValue("modified");
  await expect(page.locator(".libraryTileOpen").first()).toBeVisible();
}

test("sorting synchronizes filtering, detail navigation, selection, and original-file drag", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => Object.assign(window, {
    dragCalls: [],
    __TAURI_INTERNALS__: { invoke: (command: string, args: unknown) => {
      Reflect.get(window, "dragCalls").push({ command, args });
      return Promise.resolve();
    } }
  }));
  await openLibrary(page);
  const sort = page.getByRole("combobox", { name: "排序方式" });
  const tiles = page.locator(".libraryTileOpen");
  await page.locator(".libraryTileSelect").first().click();
  const facets = await page.locator(".filterChip").allTextContents();
  await sort.selectOption("size");
  await expect(tiles.first()).toHaveAttribute("title", "101000001_p1.jpg");
  expect(await page.locator(".filterChip").allTextContents()).toEqual(facets);
  await expect(page.getByText("已选 1 张", { exact: true })).toBeVisible();
  const checked = page.locator(".libraryTile").filter({ has: page.getByTitle("101000001_p0.jpg", { exact: true }) });
  await expect(checked.locator(".libraryTileSelect")).toHaveAttribute("aria-pressed", "true");
  await page.locator(".libraryToolbar input").fill("101000001");
  await expect(tiles).toHaveCount(2);
  await tiles.first().click();
  await expect(page.getByRole("heading", { name: "101000001_p1.jpg", exact: true })).toBeVisible();
  await expect(page.locator(".libraryDetailMeta")).toContainText("创建时间");
  await page.getByRole("button", { name: "下一张", exact: true }).click();
  await expect(page.getByRole("heading", { name: "101000001_p0.jpg", exact: true })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("heading", { name: "101000001_p1.jpg", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.locator(".libraryTileSelect[aria-pressed=false]").click();
  const box = await tiles.first().boundingBox();
  if (!box) throw new Error("Missing tile");
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 95, box.y + 60, { steps: 4 });
  await page.mouse.up();
  const calls = await page.evaluate(() => Reflect.get(window, "dragCalls"));
  expect(calls.at(-1).args.paths.map((path: string) => path.split("\\").at(-1)))
    .toEqual(["101000001_p1.jpg", "101000001_p0.jpg"]);
  await expect(page.locator(".libraryDetailModal")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("all six fields, default directions, preference persistence, and reset behavior", async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, {
    __TAURI_INTERNALS__: {
      metadata: { currentWindow: { label: "main" } },
      invoke: (command: string) => Promise.resolve(command.endsWith("available_monitors") ? [] : null)
    }
  }));
  await openLibrary(page);
  const sort = page.getByRole("combobox", { name: "排序方式" });
  await expect(sort.locator("option")).toHaveCount(6);
  for (const key of ["created", "modified", "size", "pixels", "rating", "filename"]) {
    await sort.selectOption(key);
    const initial = key === "filename" ? "升序" : "降序";
    const toggled = key === "filename" ? "降序" : "升序";
    await page.getByRole("button", { name: initial, exact: true }).click();
    await expect(page.getByRole("button", { name: toggled, exact: true })).toBeVisible();
  }
  await expect(page.locator(".libraryTileOpen").first()).toHaveAttribute("title", "202000001_p0.jpg");
  await page.getByRole("button", { name: "艺术家", exact: true }).click();
  await page.getByRole("button", { name: "图库", exact: true }).click();
  await expect(sort).toHaveValue("filename");
  await page.reload();
  await expect(sort).toHaveValue("filename");
  await expect(page.getByRole("button", { name: "降序", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "重置窗口布局", exact: true }).click();
  await page.getByRole("button", { name: "图库", exact: true }).click();
  await expect(sort).toHaveValue("filename");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "重置所有设置", exact: true }).click();
  await page.locator(".confirmModal").getByRole("button", { name: "重置所有设置", exact: true }).click();
  await page.getByRole("button", { name: "图库", exact: true }).click();
  await expect(sort).toHaveValue("modified");
  await expect(page.getByRole("button", { name: "降序", exact: true })).toBeVisible();
  await page.reload();
  await expect(sort).toHaveValue("modified");
});

test("30,000-image grid remains virtualized, sorts the full set, and returns to the top", async ({ page }) => {
  test.setTimeout(60_000);
  await page.route("**/src/mockData.ts", async (route) => {
    const response = await route.fetch();
    const script = await response.text();
    await route.fulfill({ response, body: script + `
      const seed = MOCK_LIBRARY_IMAGES[0];
      MOCK_LIBRARY_IMAGES.splice(0, MOCK_LIBRARY_IMAGES.length, ...Array.from({length: 30000}, (_, i) => ({
        ...seed, path: seed.folder + '/' + (i + 1) + '.jpg', filename: (i + 1) + '.jpg',
        mtime_ns: seed.mtime_ns + i * 1000000000, created_ns: seed.created_ns + i * 1000000000
      })));` });
  });
  await openLibrary(page);
  await expect(page.locator(".libraryCount")).toContainText("30000");
  const tiles = page.locator(".libraryTileOpen");
  await expect(tiles.first()).toHaveAttribute("title", "30000.jpg");
  expect(await tiles.count()).toBeLessThan(200);
  const grid = page.locator(".libraryGridScroll");
  await grid.evaluate((element) => { element.scrollTop = 200_000; });
  await expect.poll(() => grid.evaluate((element) => element.scrollTop)).toBeGreaterThan(100_000);
  const start = Date.now();
  await page.getByRole("combobox", { name: "排序方式" }).selectOption("filename");
  await expect(tiles.first()).toHaveAttribute("title", "1.jpg");
  await expect.poll(() => grid.evaluate((element) => element.scrollTop)).toBe(0);
  console.log(`30,000-image browser sort and render: ${Date.now() - start}ms`);
  expect(Date.now() - start).toBeLessThan(3000);
  await page.getByRole("button", { name: "升序", exact: true }).click();
  await expect(tiles.first()).toHaveAttribute("title", "30000.jpg");
  expect(await tiles.count()).toBeLessThan(200);
});

test("sorting controls fit minimum window size and both themes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") errors.push(message.text());
  });
  await openLibrary(page);
  await expect(page).toHaveTitle("Pixiv PBD Manager");
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  for (const [width, height, theme] of [[1365, 900, "light"], [980, 660, "dark"]] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
      document.documentElement.style.colorScheme = value;
    }, theme);
    await page.getByRole("combobox", { name: "排序方式" }).selectOption("created");
    const overflow = await page.locator(".libraryToolbar").evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(overflow).toBe(false);
    for (const control of await page.locator(".libraryToolbar button, .libraryToolbar select").all()) {
      const rect = await control.boundingBox();
      expect(rect?.x).toBeGreaterThanOrEqual(0);
      expect((rect?.x ?? 0) + (rect?.width ?? 0)).toBeLessThanOrEqual(width);
    }
    await page.screenshot({ path: join(tmpdir(), "pbd-sort-qa", `library-${theme}.png`) });
  }
  expect(errors).toEqual([]);
});
