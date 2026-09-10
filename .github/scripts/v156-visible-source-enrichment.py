from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, got {count}: {old!r}")
    p.write_text(text.replace(old, new))


radar = "src/context/RadarContext.tsx"
replace_once(
    radar,
    '''function withHealedSourceMetadata(source: Source, ingest: unknown): Source {\n  const metadata = (ingest as { sourceMetadata?: IngestSourceMetadata } | null)?.sourceMetadata;\n  if (!metadata) return source;\n  return {\n    ...source,\n    displayName: metadata.displayName?.trim() || source.displayName,\n    avatarUrl: metadata.avatarUrl?.trim() || source.avatarUrl,\n    handle: metadata.handle?.trim() || source.handle\n  };\n}\n\nexport const RadarProvider''',
    '''function withHealedSourceMetadata(source: Source, ingest: unknown): Source {\n  const metadata = (ingest as { sourceMetadata?: IngestSourceMetadata } | null)?.sourceMetadata;\n  if (!metadata) return source;\n  return {\n    ...source,\n    displayName: metadata.displayName?.trim() || source.displayName,\n    avatarUrl: metadata.avatarUrl?.trim() || source.avatarUrl,\n    handle: metadata.handle?.trim() || source.handle\n  };\n}\n\nfunction isGenericVisibleSourceName(value: string | undefined, source: Pick<Source, 'externalId' | 'handle'>): boolean {\n  const normalize = (input?: string) => (input || '').trim().replace(/^@/, '').toLowerCase();\n  const name = normalize(value);\n  const generic = new Set(['facebook', 'instagram', 'page', 'profile', normalize(source.externalId), normalize(source.handle)].filter(Boolean));\n  return !name || generic.has(name);\n}\n\nfunction sourceNeedsVisibleMetadata(source: Source): boolean {\n  return source.connectorType === 'device_session' && (isGenericVisibleSourceName(source.displayName, source) || !source.avatarUrl?.trim());\n}\n\nexport const RadarProvider'''
)
replace_once(
    radar,
    '''  const deviceConnector = useMemo(() => new DeviceSessionConnector(), []);\n\n  const applyDeviceStatus =''',
    '''  const deviceConnector = useMemo(() => new DeviceSessionConnector(), []);\n\n  const enrichVisibleSourceMetadata = async (candidates: Source[]) => {\n    if (!DeviceSessionConnector.isNativeAvailable()) return;\n    let status: NativeSessionStatus;\n    try { status = await DeviceSessionConnector.getLocalSession(); } catch { return; }\n    for (const source of candidates.filter(sourceNeedsVisibleMetadata)) {\n      if (!DeviceSessionConnector.isPlatformConnected(status, source.platform)) continue;\n      try {\n        const resolved = await deviceConnector.resolveSource({ url: source.url });\n        const realName = !isGenericVisibleSourceName(resolved.displayName, source) ? resolved.displayName.trim() : '';\n        const avatarUrl = resolved.avatarUrl?.trim() || '';\n        if (!realName && !avatarUrl) continue;\n        setSources(previous => previous.map(item => item.id === source.id ? {\n          ...item,\n          displayName: realName || item.displayName,\n          avatarUrl: avatarUrl || item.avatarUrl,\n          handle: resolved.handle?.trim() || item.handle,\n          connectorStatus: 'authenticated_monitoring'\n        } : item));\n      } catch { /* keep persisted metadata when the live profile cannot be resolved */ }\n    }\n  };\n\n  const applyDeviceStatus ='''
)
replace_once(
    radar,
    '''      setSources(hydratedSources);\n      setRules(dbRules);''',
    '''      setSources(hydratedSources);\n      void enrichVisibleSourceMetadata(hydratedSources);\n      setRules(dbRules);'''
)

architecture = "server/tests/architectureRegression.test.ts"
marker = "test('PostgreSQL match conflicts return the persisted winner instead of the losing candidate', () => {"
text = Path(architecture).read_text()
if marker not in text:
    raise RuntimeError('architecture insertion marker missing')
insert = '''test('persisted device sources with placeholder identity are visibly enriched from the authenticated device session', () => {\n  const radar = read('src/context/RadarContext.tsx');\n  assert.match(radar, /sourceNeedsVisibleMetadata/);\n  assert.match(radar, /deviceConnector\\.resolveSource\\(\\{ url: source\\.url \\}\\)/);\n  assert.match(radar, /void enrichVisibleSourceMetadata\\(hydratedSources\\)/);\n});\n\n'''
Path(architecture).write_text(text.replace(marker, insert + marker, 1))

print('V156_VISIBLE_SOURCE_ENRICHMENT_APPLIED=1')
