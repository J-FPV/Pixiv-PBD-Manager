import type { AppSettings } from "../../types";

// Shared settings mutator handed from SettingsView down into each section, so
// the sections don't each re-derive `{ ...settings, [key]: value }`.
export type SettingsUpdate = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
