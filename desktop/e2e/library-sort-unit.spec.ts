import { expect, test } from "@playwright/test";
import { MOCK_LIBRARY_IMAGES } from "../src/mockData";
import type { LibraryImage, LibrarySortKey } from "../src/types";
import { DEFAULT_LIBRARY_SORT, normalizeLibrarySort, sortLibraryImages } from "../src/utils/librarySort";

const image = (filename: string, patch: Partial<LibraryImage> = {}): LibraryImage => ({
  ...MOCK_LIBRARY_IMAGES[0], filename, path: `C:\\images\\${filename}`, ...patch
});
const names = (images: LibraryImage[]) => images.map((row) => row.filename);

const pairs: [LibrarySortKey, Partial<LibraryImage>, Partial<LibraryImage>][] = [
  ["created", { created_ns: 100 }, { created_ns: 200 }],
  ["modified", { mtime_ns: 100 }, { mtime_ns: 200 }],
  ["size", { size_bytes: 10 }, { size_bytes: 20 }],
  ["pixels", { width: 10, height: 30 }, { width: 20, height: 20 }],
  ["rating", { rating: 0 }, { rating: 5 }]
];

for (const [key, low, high] of pairs) {
  test(`${key} sorts numerically in both directions without mutating input`, () => {
    const rows = [image("10.jpg", high), image("2.jpg", low)];
    expect(names(sortLibraryImages(rows, { key, direction: "asc" }, "zh"))).toEqual(["2.jpg", "10.jpg"]);
    expect(names(sortLibraryImages(rows, { key, direction: "desc" }, "zh"))).toEqual(["10.jpg", "2.jpg"]);
    expect(names(rows)).toEqual(["10.jpg", "2.jpg"]);
  });
}

test("natural filename ordering supports Unicode, case, and Pixiv pages", () => {
  for (const prefix of ["", "\u661f\u7a7a", "\u30a4\u30e9\u30b9\u30c8", "12345678_p"]) {
    const rows = [image(`${prefix}10.jpg`), image(`${prefix}2.jpg`)];
    expect(names(sortLibraryImages(rows, { key: "filename", direction: "asc" }, "zh")))
      .toEqual([`${prefix}2.jpg`, `${prefix}10.jpg`]);
    expect(names(sortLibraryImages(rows, { key: "filename", direction: "desc" }, "zh")))
      .toEqual([`${prefix}10.jpg`, `${prefix}2.jpg`]);
  }
  expect(names(sortLibraryImages([image("a10.jpg"), image("A2.jpg")], { key: "filename", direction: "asc" }, "en")))
    .toEqual(["A2.jpg", "a10.jpg"]);
});

test("missing times and dimensions stay last regardless of direction", () => {
  const cases: [LibrarySortKey, Partial<LibraryImage>][] = [
    ["created", { created_ns: null }], ["modified", { mtime_ns: 0 }],
    ["pixels", { width: 0 }], ["pixels", { height: Number.NaN }]
  ];
  for (const [key, missing] of cases) {
    for (const direction of ["asc", "desc"] as const) {
      const rows = [image("1.jpg", missing), image("2.jpg")];
      expect(names(sortLibraryImages(rows, { key, direction }, "en"))).toEqual(["2.jpg", "1.jpg"]);
    }
  }
});

test("ties use natural filename then exact path and ignore source order", () => {
  const rows = [image("10.jpg"), image("2.jpg", { path: "B/2.jpg" }), image("2.jpg", { path: "A/2.jpg" })];
  for (const direction of ["asc", "desc"] as const) {
    const sort = { key: "rating" as const, direction };
    expect(sortLibraryImages(rows, sort, "en").map((row) => row.path))
      .toEqual(["A/2.jpg", "B/2.jpg", "C:\\images\\10.jpg"]);
    expect(sortLibraryImages([...rows].reverse(), sort, "en")).toEqual(sortLibraryImages(rows, sort, "en"));
  }
});

test("persisted sorting validates both field and direction", () => {
  for (const value of [null, false, [], {}, "filename", { key: "old", direction: "asc" }, { key: "size", direction: "invalid" }]) {
    expect(normalizeLibrarySort(value)).toEqual(DEFAULT_LIBRARY_SORT);
  }
  expect(normalizeLibrarySort({ key: "created", direction: "asc" })).toEqual({ key: "created", direction: "asc" });
});

test("30,000 rows sort within a bounded local budget", () => {
  const rows = Array.from({ length: 30_000 }, (_, index) => image(`${30_000 - index}.jpg`, { rating: index % 6 }));
  const start = performance.now();
  for (const key of ["filename", "rating", "created", "modified", "size", "pixels"] as const) {
    const sorted = sortLibraryImages(rows, { key, direction: "asc" }, "zh");
    expect(sorted).toHaveLength(30_000);
    if (key === "filename") expect(sorted[0].filename).toBe("1.jpg");
  }
  const elapsed = performance.now() - start;
  console.log(`30,000 images / six sorts: ${elapsed.toFixed(0)}ms`);
  expect(elapsed).toBeLessThan(3000);
});
