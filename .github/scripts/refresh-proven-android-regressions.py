from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, got {count}: {old!r}")
    p.write_text(text.replace(old, new))


physical = "server/tests/androidPhysicalRegression.test.ts"
replace_once(physical, "assert.match(host, /root\\.addView\\(host, hostParams\\)/);", "assert.match(host, /root\\.addView\\(host, 0, hostParams\\)/);")
replace_once(physical, "assert.match(host, /new FrameLayout\\.LayoutParams\\(48, 48\\)/);", "assert.match(host, /Math\\.max\\(1, width\\)[\\s\\S]*Math\\.max\\(1, height\\)/);")
replace_once(physical, "assert.match(collector, /TIMEOUT_MS = 45_000/);", "assert.match(collector, /TIMEOUT_MS = 75_000/);")
replace_once(physical, "assert.match(collector, /PAGE_STARTED_EXTRACTION_DELAY_MS = 900/);", "assert.match(collector, /PAGE_STARTED_EXTRACTION_DELAY_MS = 3_000/);")
replace_once(physical, "assert.match(collector, /EVALUATION_WATCHDOG_MS = 2_500/);", "assert.match(collector, /EVALUATION_WATCHDOG_MS = 10_000/);")
replace_once(physical, "assert.match(plugin, /FacebookGraphqlWebViewCollector\\.collect/);", "assert.match(plugin, /AuthenticatedWebCollector\\.collect\\(foregroundContext\\(\\), url, limit, terminal\\)/);\n  assert.match(plugin, /primary=dom/);")

architecture = "server/tests/architectureRegression.test.ts"
replace_once(architecture, "assert.match(collector, /SURFACE_FALLBACK_ATTEMPT\\s*=\\s*4/);", "assert.match(collector, /SURFACE_FALLBACK_ATTEMPT\\s*=\\s*20/);")
replace_once(architecture, "assert.match(host, /root\\.addView\\(host, hostParams\\)/);", "assert.match(host, /root\\.addView\\(host, 0, hostParams\\)/);")
replace_once(architecture, "assert.match(plugin, /FacebookGraphqlWebViewCollector\\.collect\\(foregroundContext\\(\\)/);", "assert.match(plugin, /AuthenticatedWebCollector\\.collect\\(foregroundContext\\(\\), url, limit, terminal\\)/);\n  assert.match(plugin, /primary=dom/);")

print("PROVEN_ANDROID_REGRESSION_EXPECTATIONS_REFRESHED=1")
