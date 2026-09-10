import { Capacitor, registerPlugin } from '@capacitor/core';

import { getApiBaseUrl } from './api';

const MAX_UPDATE_META_BYTES = 64 * 1024;

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
  const installed = await NativeAppUpdate.getInstalledVersion();
  if (!Number.isInteger(installed?.versionCode) || installed.versionCode < 1 || typeof installed.versionName !== 'string') {
    throw new Error('Android returned invalid installed-version metadata');
  }
  return {
    versionCode: installed.versionCode,
    versionName: installed.versionName.slice(0, 64),
    canInstallPackages: installed.canInstallPackages === true
  };
}

async function readBoundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > MAX_UPDATE_META_BYTES) throw new Error('Update metadata exceeded the safety limit');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let raw = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_UPDATE_META_BYTES) {
        await reader.cancel();
        throw new Error('Update metadata exceeded the safety limit');
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    return raw;
  } finally {
    reader.releaseLock();
  }
}

function normalizeDecision(value: any, installedVersionCode: number): AndroidUpdateDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Update service returned malformed metadata');
  if (value.channel !== 'android-alpha') throw new Error('Update service returned an unexpected release channel');
  if (!Number.isInteger(value.installedVersionCode) || value.installedVersionCode !== installedVersionCode) {
    throw new Error('Update service returned inconsistent installed-version metadata');
  }
  if (typeof value.updateAvailable !== 'boolean' || typeof value.updateRequired !== 'boolean') {
    throw new Error('Update service returned invalid availability metadata');
  }
  if (value.updateRequired && !value.updateAvailable) throw new Error('Update service returned inconsistent mandatory-update metadata');

  if (!value.updateAvailable) {
    return {
      channel: 'android-alpha',
      installedVersionCode,
      updateAvailable: false,
      updateRequired: false,
      downloadPath: null
    };
  }

  if (!Number.isInteger(value.versionCode) || value.versionCode <= installedVersionCode) {
    throw new Error('Update service returned an invalid release version');
  }
  if (typeof value.versionName !== 'string' || !value.versionName.trim() || value.versionName.length > 64) {
    throw new Error('Update service returned an invalid release name');
  }
  if (!Number.isInteger(value.minSupportedVersionCode) || value.minSupportedVersionCode < 1) {
    throw new Error('Update service returned an invalid minimum supported version');
  }
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(value.sha256)) {
    throw new Error('Update service returned an invalid APK hash');
  }
  if (!Number.isFinite(Number(value.sizeBytes)) || Number(value.sizeBytes) < 1) {
    throw new Error('Update service returned an invalid APK size');
  }
  if (typeof value.downloadPath !== 'string' || !value.downloadPath.trim() || value.downloadPath.length > 2048) {
    throw new Error('Update service returned an invalid APK download path');
  }

  return {
    channel: 'android-alpha',
    installedVersionCode,
    updateAvailable: true,
    updateRequired: value.updateRequired,
    versionCode: value.versionCode,
    versionName: value.versionName.trim(),
    minSupportedVersionCode: value.minSupportedVersionCode,
    mandatory: value.mandatory === true,
    sha256: value.sha256.toLowerCase(),
    sizeBytes: Number(value.sizeBytes),
    publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt.slice(0, 100) : undefined,
    downloadPath: value.downloadPath.trim()
  };
}

export async function checkAndroidUpdate(): Promise<{
  installed: InstalledAndroidVersion;
  decision: AndroidUpdateDecision;
}> {
  const installed = await getInstalledAndroidVersion();
  const baseUrl = getApiBaseUrl().replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Android update check is missing the backend base URL');

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 5_000);
  let response: Response;
  try {
    response = await fetch(
      `${baseUrl}/api/app/update?versionCode=${encodeURIComponent(String(installed.versionCode))}`,
      { credentials: 'omit', cache: 'no-store', signal: controller.signal }
    );
    const raw = await readBoundedText(response);
    let body: any = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }
    if (!response.ok) throw new Error(body?.error || `Update check failed with HTTP ${response.status}`);
    return { installed, decision: normalizeDecision(body, installed.versionCode) };
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('Android update check timed out');
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function installAndroidUpdate(decision: AndroidUpdateDecision): Promise<{
  started: boolean;
  permissionRequired: boolean;
}> {
  if (!isNativeAndroid()) throw new Error('In-app APK installation is available only on Android');
  if (!decision.updateRequired || !Number.isInteger(decision.versionCode) || !decision.sha256 || !/^[a-f0-9]{64}$/i.test(decision.sha256) || !decision.downloadPath) {
    throw new Error('Mandatory update metadata is incomplete');
  }

  const baseUrl = getApiBaseUrl().replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Android update install is missing the backend base URL');
  const backendOrigin = new URL(`${baseUrl}/`);
  const url = new URL(decision.downloadPath, backendOrigin);
  if (url.origin !== backendOrigin.origin || url.protocol !== 'https:') {
    throw new Error('Update download must use the MR SCRAP backend HTTPS origin');
  }

  return await NativeAppUpdate.installUpdate({
    url: url.toString(),
    sha256: decision.sha256.toLowerCase(),
    versionCode: decision.versionCode!
  });
}
