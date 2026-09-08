export interface AndroidReleaseMetadata {
  channel: 'android-alpha';
  versionCode: number;
  versionName: string;
  minSupportedVersionCode: number;
  mandatory: boolean;
  sha256: string;
  sizeBytes: number;
  publishedAt: string;
}

export interface AndroidUpdateDecision extends AndroidReleaseMetadata {
  installedVersionCode: number;
  updateAvailable: boolean;
  updateRequired: boolean;
}

export function buildAndroidUpdateDecision(
  installedVersionCode: number,
  release: AndroidReleaseMetadata
): AndroidUpdateDecision {
  if (!Number.isInteger(installedVersionCode) || installedVersionCode < 1) {
    throw new Error('installedVersionCode must be a positive integer');
  }
  if (!Number.isInteger(release.versionCode) || release.versionCode < 1) {
    throw new Error('release versionCode must be a positive integer');
  }
  if (!Number.isInteger(release.minSupportedVersionCode) || release.minSupportedVersionCode < 1) {
    throw new Error('minSupportedVersionCode must be a positive integer');
  }

  const updateAvailable = release.versionCode > installedVersionCode;
  const updateRequired = updateAvailable && (
    release.mandatory || installedVersionCode < release.minSupportedVersionCode
  );

  return {
    ...release,
    installedVersionCode,
    updateAvailable,
    updateRequired
  };
}
