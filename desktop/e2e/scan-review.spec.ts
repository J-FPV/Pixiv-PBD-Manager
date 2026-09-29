import { expect, test } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("review filters, evidence, confirmation and restart", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto("/");
  await page.evaluate(() => sessionStorage.setItem("pbd-mock-review", JSON.stringify([
    { path: "C:\\Art\\Pending", count: 10, status: "awaiting_confirmation", revision: "1", updated_at: 1700000000,
      candidates: [{ artist_id: "12345", name: "Preview Artist", source: "online_pid" }],
      queries: [{ pid: "10000001", status: "resolved", artist_id: "12345", name: "Preview Artist", error: "" }],
      samples: { "10000001": "C:\\Art\\Pending\\10000001_p0.jpg" } },
    { path: "C:\\Art\\Mixed", count: 2, status: "conflict", revision: "2", updated_at: 1700000000,
      candidates: [{ artist_id: "11111", name: "One", source: "online_pid" }, { artist_id: "22222", name: "Two", source: "online_pid" }], queries: [] }
  ])));
  await page.getByRole("button", { name: "待处理", exact: true }).click();
  await expect(page.locator(".reviewRow")).toHaveCount(2);
  await page.getByRole("combobox", { name: "全部状态" }).selectOption("conflict");
  await page.getByRole("button", { name: "识别证据", exact: true }).click();
  await expect(page.getByText("样本包含不同作者，请核实或手动指定。")).toBeVisible();
  await expect(page.getByRole("button", { name: "确认归属", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("combobox", { name: "全部状态" }).selectOption("awaiting_confirmation");
  await page.getByRole("button", { name: "识别证据", exact: true }).click();
  await expect(page.getByText("已查询 1 / 30 个 PID")).toBeVisible();
  await expect(page.locator(".reviewSample img")).toBeVisible();
  await page.screenshot({ path: join(tmpdir(), "pbd-review-evidence.png") });
  await page.getByRole("button", { name: "确认归属", exact: true }).click();
  await expect(page.getByText(/将此文件夹归属/)).toBeVisible();
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "待处理", exact: true }).click();
  await expect(page.locator(".reviewRow")).toHaveCount(1);
  await expect(page.locator(".reviewRow")).toContainText("Mixed");
  expect(errors).toEqual([]);
});
