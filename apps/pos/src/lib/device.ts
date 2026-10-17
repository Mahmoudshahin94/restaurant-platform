import { invoke } from '@tauri-apps/api/core';

export interface AppInfo {
  version: string;
  os: string;
  arch: string;
}

/** True inside the Tauri desktop shell; false in a plain browser (development, E2E tests). */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Build and host facts from the native shell (`app_info` command in src-tauri/src/lib.rs). */
export async function appInfo(): Promise<AppInfo | null> {
  if (!isTauri()) return null;
  return invoke<AppInfo>('app_info');
}
