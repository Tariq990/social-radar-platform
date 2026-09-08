import { Capacitor, registerPlugin } from '@capacitor/core';

import { getApiBaseUrl } from './api';

export interface InstalledAndroidVersion {
  versionCode: number;
  versionName: string;
  canInstallPackages: boolean;
}

export interface AndroidUpdateDecision {
  channel: 'android-alpha';
  installedVersionCode: number;
  updateAvailable: boolean;
  updateRequired: boolean;
  versionCode?: number;
  versionName?: string;
  minSupportedVersionCode?: number;
  mandatory?: boolean;
  sha256?: string;
  sizeBytes?: number;
  publishedAt?: string;
  downloadPath?: string | null;
}

interface NativeAppUpdatePlugin {
  getInstalledVersion(): Promise<InstalledAndroidVersion>;
  installUpdate(options: {
    url: string;
    sha256: string;
    versionCode: number;
  }): Promise<{
    started: boolean;
    permissionRequired: boolean;
  }>;
}

const NativeAppUpdate = registerPlugin<NativeAppUpdatePlugin>('AppUpdate');

export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function getInstalledAndroidVersion(): Promise<InstalledAndroidVersion> {
  if (!isNativeAndroid()) {
    return { versionCode: Number.MAX_SAFE_INTEGER, versionName: 'web', canInstallPackages: false };
  }
  return await NativeAppUpdate.getInstalledVersion();
}

export async function checkAndroidUpdate(): Promise<{
  installed: InstalledAndroidVersion;
  decision: AndroidUpdateDecision;
}> {
  const installed = await getInstalledAndroidVersion();
  const baseUrl = getApiBaseUrl().replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Android update check is missing the backend base URL');

  const response = await fetch(
    `${baseUrl}/api/app/update?versionCode=${encodeURIComponent(String(installed.versionCode))}`,
    { credentials: 'omit', cache: 'no-store' }
  );
  const raw = await response.text();
  let body: any = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  if (!response.ok) throw new Error(body?.error || `Update check failed with HTTP ${response.status}`);

  return { installed, decision: body as AndroidUpdateDecision };
}

export async function installAndroidUpdate(decision: AndroidUpdateDecision): Promise<{
  started: boolean;
  permissionRequired: boolean;
}> {
  if (!isNativeAndroid()) throw new Error('In-app APK installation is available only on Android');
  if (!decision.updateRequired || !decision.versionCode || !decision.sha256 || !decision.downloadPath) {
    throw new Error('Mandatory update metadata is incomplete');
  }

  const baseUrl = getApiBaseUrl().replace(/\/+$/, '');
  const url = new URL(decision.downloadPath, `${baseUrl}/`).toString();
  return await NativeAppUpdate.installUpdate({
    url,
    sha256: decision.sha256,
    versionCode: decision.versionCode
  });
}
