import { DEFAULT_SETTINGS } from "./constants";
import type {
  Artist,
  CleanupSummary,
  LibraryImage,
  ScanPreviewPayload,
  SettingsPayload,
  SimilarResult
} from "./types";

const mockMtime = Date.parse("2026-07-01T12:00:00Z") * 1_000_000;

export const MOCK_ARTISTS: Artist[] = [
  {
    id: "12345678",
    name: "Sample Artist",
    pixiv_url: "https://www.pixiv.net/users/12345678",
    works: 42,
    new_works: 3,
    work_ids: ["101000001", "101000002"],
    new_work_ids: ["101000003", "101000004", "101000005"],
    save_paths: ["C:\\PixivLibrary\\Sample Artist-12345678"],
    download_roots: ["C:\\PixivLibrary"],
    last_seen: "2026-07-01T12:00:00Z",
    last_checked: "2026-07-01T12:00:00Z",
    last_opened: "",
    notes: "",
    favorite: true,
    tags: ["reference"]
  },
  {
    id: "87654321",
    name: "Studio Example",
    pixiv_url: "https://www.pixiv.net/users/87654321",
    works: 18,
    new_works: 0,
    work_ids: ["202000001"],
    new_work_ids: [],
    save_paths: ["C:\\PixivLibrary\\Studio Example-87654321"],
    download_roots: ["C:\\PixivLibrary"],
    last_seen: "2026-06-28T08:00:00Z",
    last_checked: "2026-06-28T08:00:00Z",
    last_opened: "",
    notes: "",
    favorite: false,
    tags: ["background"]
  }
];

function libraryImage(
  filename: string,
  pid: string,
  page: number,
  artist: Artist,
  width: number,
  height: number
): LibraryImage {
  const folder = artist.save_paths[0];
  return {
    path: `${folder}\\${filename}`,
    filename,
    folder,
    size_bytes: 2_400_000 + page * 320_000,
    mtime_ns: mockMtime + page,
    width,
    height,
    resolution: `${width} × ${height}`,
    orientation: height > width ? "portrait" : width > height ? "landscape" : "square",
    format: "jpg",
    pid,
    page,
    artist_id: artist.id,
    artist_name: artist.name,
    artist_tags: artist.tags,
    tags: page === 0 ? ["favorite"] : [],
    pixiv_tags: [{ tag: "オリジナル", translation: "original" }],
    artwork_url: `https://www.pixiv.net/artworks/${pid}`,
    artist_url: artist.pixiv_url
  };
}

export const MOCK_LIBRARY_IMAGES: LibraryImage[] = [
  libraryImage("101000001_p0.jpg", "101000001", 0, MOCK_ARTISTS[0], 1600, 2400),
  libraryImage("101000001_p1.jpg", "101000001", 1, MOCK_ARTISTS[0], 2400, 1600),
  libraryImage("101000002_p0.jpg", "101000002", 0, MOCK_ARTISTS[0], 1800, 1800),
  libraryImage("202000001_p0.jpg", "202000001", 0, MOCK_ARTISTS[1], 1920, 1080)
];

export const MOCK_SETTINGS: SettingsPayload = {
  settings: {
    ...DEFAULT_SETTINGS,
    language: "zh",
    theme: "light",
    download_roots: ["C:\\PixivLibrary"],
    exclude_roots: ["C:\\PixivLibrary\\Excluded"]
  },
  cookie_consent: false,
  pixiv_cookie: "",
  has_cookie: false,
  cookie_storage: "mock",
  project_root: "C:\\PixivPbdManager",
  settings_path: "C:\\PixivPbdManager\\gui_settings.json"
};

export const MOCK_SCAN_PREVIEW: ScanPreviewPayload = {
  changes: [
    {
      id: "new_artist:24681357",
      kind: "new_artist",
      artist_id: "24681357",
      name: "Preview Artist",
      sources: ["folder_name_only:pixiv;resolved_by_work:303000001"],
      match_sources: ["folder_name_only:pixiv;resolved_by_work:303000001"],
      roots: ["C:\\PixivLibrary"],
      save_paths: ["C:\\PixivLibrary\\Preview Artist's illustrations - pixiv"],
      work_ids: ["303000001"]
    }
  ],
  files_seen: 128,
  files_matched: 127,
  excluded_dirs: 1,
  artists: 3,
  name_only_artists: 1,
  resolved_name_only: 1,
  fuzzy_resolved_name_only: 0,
  ssl_fallback_used: 0,
  resolve_errors: [],
  unmatched_folders: []
};

export const MOCK_SIMILAR_RESULT: SimilarResult = {
  roots: ["C:\\PixivLibrary"],
  index_path: "C:\\PixivPbdManager\\image_index.json",
  files_seen: 4,
  indexed: 4,
  reused: 0,
  changed: 4,
  error_count: 0,
  errors: [],
  groups: [
    {
      id: 1,
      kind: "likely",
      signature: "mock-similar-group",
      best_phash_distance: 2,
      best_dhash_distance: 3,
      recommended_keep_path: MOCK_LIBRARY_IMAGES[0].path,
      recommended_remove_paths: [MOCK_LIBRARY_IMAGES[1].path],
      estimated_reclaim_bytes: MOCK_LIBRARY_IMAGES[1].size_bytes,
      entries: MOCK_LIBRARY_IMAGES.slice(0, 2).map((image, index) => ({
        path: image.path,
        size_bytes: image.size_bytes,
        mtime_ns: image.mtime_ns,
        width: image.width,
        height: image.height,
        resolution: image.resolution,
        sha256: `${index + 1}`.repeat(64),
        phash: "0123456789abcdef",
        dhash: "fedcba9876543210"
      }))
    }
  ]
};

export const MOCK_CLEANUP: CleanupSummary = {
  state_path: "C:\\PixivPbdManager\\cleanup_state.json",
  operations: [],
  ignored_groups: []
};

export function mockImageDataUrl(path: string): string {
  const accent = path.includes("202000001") ? "#d66d5a" : path.includes("p1") ? "#4f86c6" : "#18a779";
  const label = path.split(/[\\/]/).pop() || "Mock preview";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#17212b"/><rect x="80" y="80" width="1040" height="640" rx="18" fill="${accent}"/><circle cx="360" cy="350" r="150" fill="#f4d35e"/><path d="M520 620 760 260l280 360z" fill="#f6f7f9" opacity=".9"/><text x="600" y="755" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="34">${label.replace(/[<>&]/g, "")}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
