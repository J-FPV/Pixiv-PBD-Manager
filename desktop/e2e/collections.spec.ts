import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function openLibrary(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "图库", exact: true }).click();
  await expect(page.locator(".libraryTileOpen").first()).toBeVisible();
}

async function create(page: Page, kind: "smart" | "project", name: string) {
  await page.locator(".collectionsPane section").nth(kind === "smart" ? 0 : 1).getByTitle("新建合集").click();
  await page.getByRole("dialog").getByLabel("合集名称").fill(name);
  await page.getByRole("dialog").getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("smart rules remain explicit, survive restart, and refresh date conditions", async ({ page }) => {
  await openLibrary(page);
  const search = page.locator(".libraryToolbar input");
  await search.fill("101000001");
  await expect(page.locator(".libraryTileOpen")).toHaveCount(2);
  await create(page, "smart", "背景参考");
  await search.fill("202000001");
  await expect(page.locator(".libraryTileOpen")).toHaveCount(1);
  await page.getByRole("button", { name: "全部图片", exact: true }).click();
  await page.getByRole("button", { name: "背景参考", exact: true }).click();
  await expect(search).toHaveValue("101000001");
  await search.fill("202000001");
  await page.getByRole("button", { name: "更新合集条件", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "背景参考", exact: true }).click();
  await expect(search).toHaveValue("202000001");
  await page.getByLabel("最近加入图库", { exact: true }).check();
  await expect(page.getByRole("spinbutton", { name: "天", exact: true })).toHaveValue("30");
  await expect(page.locator(".libraryTileOpen")).toHaveCount(0);
  await page.getByLabel("最近加入图库", { exact: true }).uncheck();
  await expect(page.locator(".libraryTileOpen")).toHaveCount(1);
});

test("projects retain selections, export all original members despite search, and delete only after confirmation", async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, {
    dragCalls: [],
    __TAURI_INTERNALS__: { invoke: (command: string, args: unknown) => {
      Reflect.get(window, "dragCalls").push({ command, args }); return Promise.resolve();
    } }
  }));
  await openLibrary(page);
  await page.locator(".libraryTileSelect").nth(0).click();
  await page.locator(".libraryTileSelect").nth(1).click();
  await create(page, "project", "Project A");
  await page.getByRole("combobox", { name: "加入项目", exact: true }).selectOption({ label: "Project A" });
  await page.getByRole("button", { name: "加入项目", exact: true }).click();
  await expect(page.locator(".libraryTileOpen")).toHaveCount(2);
  await page.locator(".libraryToolbar input").fill("p0");
  await expect(page.locator(".libraryTileOpen")).toHaveCount(1);
  const handle = page.getByRole("button", { name: "拖出合集原图", exact: true });
  const box = await handle.boundingBox();
  if (!box) throw new Error("Missing collection drag handle");
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down(); await page.mouse.move(box.x + 45, box.y + 10, { steps: 4 }); await page.mouse.up();
  const calls = await page.evaluate(() => Reflect.get(window, "dragCalls"));
  expect(calls.at(-1).command).toBe("drag_original_files");
  expect(calls.at(-1).args.paths).toHaveLength(2);
  expect(calls.at(-1).args.paths.every((path: string) => !/thumb|blob:|data:/.test(path))).toBe(true);
  const row = page.locator(".collectionLine").filter({ hasText: "Project A" });
  await row.getByTitle("重命名", { exact: true }).click();
  await page.getByRole("dialog").getByLabel("合集名称").fill("Project B");
  await page.getByRole("dialog").getByRole("button", { name: "确定", exact: true }).click();
  await page.locator(".collectionLine").filter({ hasText: "Project B" }).getByTitle("删除合集", { exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("不会删除原图");
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByTitle("Project B", { exact: true })).toBeVisible();
});

test("30,000-image smart collections stay virtualized and reject oversized drag without truncation", async ({ page }) => {
  test.setTimeout(60_000);
  await page.route("**/src/mockData.ts", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      const seed = MOCK_LIBRARY_IMAGES[0];
      MOCK_LIBRARY_IMAGES.splice(0, MOCK_LIBRARY_IMAGES.length, ...Array.from({length: 30000}, (_, i) => ({
        ...seed, image_id: 'image-' + i, path: seed.folder + '/' + i + '.jpg', filename: i + '.jpg',
        first_seen_ns: i < 15000 ? Date.now() * 1000000 : null, markers: i % 2 ? ['used'] : []
      })));` });
  });
  await openLibrary(page);
  await page.getByLabel("最近加入图库", { exact: true }).check();
  await page.getByLabel("不含已用过", { exact: true }).check();
  await expect(page.locator(".libraryCount")).toContainText("7500");
  await create(page, "smart", "Recent unused");
  const start = Date.now();
  await page.getByRole("button", { name: "全部图片", exact: true }).click();
  await page.getByRole("button", { name: "Recent unused", exact: true }).click();
  await expect(page.locator(".libraryCount")).toContainText("7500");
  expect(Date.now() - start).toBeLessThan(3000);
  expect(await page.locator(".libraryTileOpen").count()).toBeLessThan(200);
  await page.getByRole("button", { name: "拖出合集原图", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("超过 1,000 张");
  for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width: 980, height: 660 });
    await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme);
    expect(await page.locator(".collectionActionBar").evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
    await page.screenshot({ path: join(tmpdir(), `pbd-collections-${theme}.png`) });
  }
});

for (const size of [1000, 1001]) test(`project original drag boundary: ${size}`, async ({ page }) => {
  await page.addInitScript((size) => {
    Object.assign(window, { dragCalls: [], __TAURI_INTERNALS__: { invoke: (command: string, args: unknown) => {
      Reflect.get(window, "dragCalls").push({ command, args }); return Promise.resolve();
    } } });
    const members = Array.from({ length: size }, (_, i) => ({ store_id: "mock-store", image_id: `id-${i}`, path: `C:\\Originals\\${i}.png`, available: true, status: "linked" }));
    localStorage.setItem("pbd-mock-collections", JSON.stringify({ store_id: "mock-store", collections: [{
      id: "a".repeat(32), name: "Boundary", kind: "project", filters: {}, sort: { key: "modified", direction: "desc" }, members, member_count: size, revision: "1"
    }] }));
  }, size);
  await openLibrary(page);
  await page.getByTitle("Boundary", { exact: true }).click();
  const handle = page.getByRole("button", { name: "拖出合集原图", exact: true });
  const box = await handle.boundingBox();
  if (!box) throw new Error("Missing drag handle");
  await page.mouse.move(box.x + 10, box.y + 10); await page.mouse.down();
  await page.mouse.move(box.x + 45, box.y + 10, { steps: 4 }); await page.mouse.up();
  const calls = await page.evaluate(() => Reflect.get(window, "dragCalls"));
  if (size === 1000) expect(calls.at(-1).args.paths).toHaveLength(1000);
  else { expect(calls).toHaveLength(0); await expect(page.getByRole("alert")).toContainText("超过 1,000 张"); }
});
