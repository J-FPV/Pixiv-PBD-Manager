import {
  PROGRESS_LIBRARY_DONE,
  PROGRESS_LIBRARY_START,
  PROGRESS_SCAN_DONE,
  PROGRESS_SCAN_FILES,
  PROGRESS_SCAN_START,
  PROGRESS_SIMILAR_DONE,
  PROGRESS_SIMILAR_FILES,
  PROGRESS_SIMILAR_START
} from "./events";
import {
  MOCK_ARTISTS,
  MOCK_CLEANUP,
  MOCK_LIBRARY_IMAGES,
  MOCK_SCAN_PREVIEW,
  MOCK_SETTINGS,
  MOCK_SIMILAR_RESULT,
  mockImageDataUrl
} from "./mockData";
import type { ApiEvent, ImageThumbnailPayload, LibraryImage, SettingsPayload } from "./types";

interface MockOptions {
  signal?: AbortSignal;
  onStart?: (controls: { pause: () => void; resume: () => void }) => void;
}

function emitProgress(onEvent: ((event: ApiEvent) => void) | undefined, key: string, payload: Record<string, unknown>) {
  onEvent?.({ type: "progress", key, payload });
}

function currentSettings(payload: object): SettingsPayload {
  const settings = (payload as { settings?: SettingsPayload["settings"] }).settings;
  return settings ? { ...MOCK_SETTINGS, settings: { ...MOCK_SETTINGS.settings, ...settings } } : MOCK_SETTINGS;
}

function imageForPath(path: string): LibraryImage {
  return MOCK_LIBRARY_IMAGES.find((image) => image.path === path) || MOCK_LIBRARY_IMAGES[0];
}

function mockCommand(commandName: string, payload: object, onEvent?: (event: ApiEvent) => void): unknown {
  const values = payload as Record<string, unknown>;
  switch (commandName) {
    case "settings.get":
    case "settings.save":
    case "cookie.revoke":
      return currentSettings(payload);
    case "artists.list":
      return { artists: MOCK_ARTISTS, tags: ["reference", "background"], db_path: "C:\\Mock\\artists.json", project_root: "C:\\PixivPbdManager" };
    case "cleanup.list":
      return MOCK_CLEANUP;
    case "library.list":
      return { images: MOCK_LIBRARY_IMAGES, needs_scan: false, db_path: "C:\\Mock\\library_index.json" };
    case "library.scan":
      emitProgress(onEvent, PROGRESS_LIBRARY_START, { total_files: MOCK_LIBRARY_IMAGES.length });
      emitProgress(onEvent, PROGRESS_LIBRARY_DONE, { indexed: MOCK_LIBRARY_IMAGES.length });
      return { files_seen: 4, indexed: 4, reused: 4, changed: 0, errors: 0, error_examples: [], needs_scan: false };
    case "library.set_tags":
      return { image: { ...imageForPath(String(values.path || "")), tags: (values.tags as string[]) || [] } };
    case "library.fetch_tags":
      return { images: MOCK_LIBRARY_IMAGES, errors: [], cancelled: false };
    case "scan.preview":
      emitProgress(onEvent, PROGRESS_SCAN_START, { roots: 1 });
      emitProgress(onEvent, PROGRESS_SCAN_FILES, { files: 128, matched: 127, name_only: 1 });
      emitProgress(onEvent, PROGRESS_SCAN_DONE, { files: 128, matched: 127, name_only: 1 });
      return MOCK_SCAN_PREVIEW;
    case "similar.run":
      emitProgress(onEvent, PROGRESS_SIMILAR_START, { roots: 1 });
      emitProgress(onEvent, PROGRESS_SIMILAR_FILES, { files: 4, total_files: 4, indexed: 4, changed: 4, reused: 0, errors: 0 });
      emitProgress(onEvent, PROGRESS_SIMILAR_DONE, { files: 4, indexed: 4, groups: 1 });
      return MOCK_SIMILAR_RESULT;
    case "image.thumbnail": {
      const path = String(values.path || MOCK_LIBRARY_IMAGES[0].path);
      const image = imageForPath(path);
      return { path, data_url: mockImageDataUrl(path), width: image.width, height: image.height } satisfies ImageThumbnailPayload;
    }
    case "image.difference":
      return { base_path: values.base_path, compare_path: values.compare_path, data_url: mockImageDataUrl("difference"), width: 1200, height: 800 };
    case "file.reveal":
      return { opened: true };
    case "browser.open":
      return { opened: Array.isArray(values.urls) ? values.urls.length : 0 };
    default:
      throw new Error(`Mock backend does not implement ${commandName}`);
  }
}

export async function runMockGuiApi<T>(
  commandName: string,
  payload: object,
  onEvent?: (event: ApiEvent<T>) => void,
  options: MockOptions = {}
): Promise<T> {
  if (options.signal?.aborted) {
    throw new Error(`${commandName} cancelled`);
  }
  options.onStart?.({ pause: () => undefined, resume: () => undefined });
  await Promise.resolve();
  const result = mockCommand(commandName, payload, onEvent as (event: ApiEvent) => void) as T;
  onEvent?.({ type: "result", command: commandName, payload: result });
  return result;
}
