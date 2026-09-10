from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, got {count}: {old!r}")
    p.write_text(text.replace(old, new, 1))


api = "src/services/api.ts"
replace_once(
    api,
    "const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\\/+$/, '');\nconst DEVICE_AUTH_STORAGE_KEY = 'mrscrap_backend_device_auth_v1';",
    "const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\\/+$/, '');\nconst DEFAULT_ANDROID_API_BASE_URL = 'https://mr-scrap-api-live.onrender.com';\nconst DEVICE_AUTH_STORAGE_KEY = 'mrscrap_backend_device_auth_v1';"
)
replace_once(
    api,
    '''export function getApiBaseUrl(): string {\n  return API_BASE_URL;\n}\n\nfunction apiUrl(path: string): string {\n  if (!path.startsWith('/')) path = `/${path}`;\n  if (isNativeAndroid() && !API_BASE_URL) {\n    throw new Error('Android build is missing VITE_API_BASE_URL. Rebuild the app with the public HTTPS backend origin.');\n  }\n  return `${API_BASE_URL}${path}`;\n}''',
    '''function resolvedApiBaseUrl(): string {\n  return API_BASE_URL || (isNativeAndroid() ? DEFAULT_ANDROID_API_BASE_URL : '');\n}\n\nexport function getApiBaseUrl(): string {\n  return resolvedApiBaseUrl();\n}\n\nfunction apiUrl(path: string): string {\n  if (!path.startsWith('/')) path = `/${path}`;\n  const baseUrl = resolvedApiBaseUrl();\n  if (isNativeAndroid() && !baseUrl) {\n    throw new Error('Android build is missing a public HTTPS backend origin.');\n  }\n  return `${baseUrl}${path}`;\n}'''
)
replace_once(
    api,
    "  const controller = new AbortController();\n  const timeout = globalThis.setTimeout(() => controller.abort(), 6_000);",
    "  const controller = new AbortController();\n  const timeoutMs = isNativeAndroid() ? 15_000 : 6_000;\n  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);"
)

radar = "src/context/RadarContext.tsx"
replace_once(
    radar,
    "  const loadDatabaseState = async () => {",
    "  const loadDatabaseState = async (attempt: number = 0) => {"
)
replace_once(
    radar,
    '''    } catch (error) {\n      console.warn('[RadarProvider] Backend state load failed', error);\n      setBackendStatus('offline');\n      setSources([]); setRules([]); setMatches([]);\n    }\n  };''',
    '''    } catch (error) {\n      console.warn('[RadarProvider] Backend state load failed', error);\n      if (attempt < 1) {\n        await new Promise(resolve => globalThis.setTimeout(resolve, 1_200));\n        return loadDatabaseState(attempt + 1);\n      }\n      setBackendStatus('offline');\n      setSources([]); setRules([]); setMatches([]);\n    }\n  };'''
)

architecture = "server/tests/architectureRegression.test.ts"
marker = "test('device session status is reconciled after persisted source hydration', () => {"
text = Path(architecture).read_text()
if marker not in text:
    raise RuntimeError('architecture insertion marker missing')
insert = '''test('native Android bootstrap has a deterministic public API origin and retries one transient cold-start failure', () => {\n  const api = read('src/services/api.ts');\n  const radar = read('src/context/RadarContext.tsx');\n  assert.match(api, /DEFAULT_ANDROID_API_BASE_URL = 'https:\\/\\/mr-scrap-api-live\\.onrender\\.com'/);\n  assert.match(api, /API_BASE_URL \\|\\| \\(isNativeAndroid\\(\\) \\? DEFAULT_ANDROID_API_BASE_URL : ''\\)/);\n  assert.match(api, /isNativeAndroid\\(\\) \\? 15_000 : 6_000/);\n  assert.match(radar, /loadDatabaseState = async \\(attempt: number = 0\\)/);\n  assert.match(radar, /if \\(attempt < 1\\)[\\s\\S]*loadDatabaseState\\(attempt \\+ 1\\)/);\n});\n\n'''
Path(architecture).write_text(text.replace(marker, insert + marker, 1))

print('V157_NATIVE_API_BOOTSTRAP_FIX_APPLIED=1')
