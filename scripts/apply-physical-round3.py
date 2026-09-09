from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise SystemExit(f"expected exactly one match in {path}, got {text.count(old)}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedSocialSessionPlugin.java",
    "AuthenticatedWebCollector.collect(foregroundContext(), url, limit, new AuthenticatedWebCollector.Callback() {",
    "FacebookGraphqlWebViewCollector.collect(foregroundContext(), url, limit, new AuthenticatedWebCollector.Callback() {",
)

replace_once(
    "server/tests/androidPhysicalRegression.test.ts",
    """  assert.match(plugin, /MRSCRAP_FLOW/);\n  assert.match(plugin, /event=collect_source_enter/);\n});\n""",
    """  assert.match(plugin, /MRSCRAP_FLOW/);\n  assert.match(plugin, /event=collect_source_enter/);\n  assert.match(plugin, /FacebookGraphqlWebViewCollector\\.collect/);\n\n  const graphqlCollector = read('android/app/src/main/java/com/mrscrap/socialradar/FacebookGraphqlWebViewCollector.java');\n  assert.match(graphqlCollector, /ProfileCometTimelineFeedRefetchQuery/);\n  assert.match(graphqlCollector, /27465012859856795/);\n  assert.match(graphqlCollector, /\\/api\\/graphql\\//);\n  assert.match(graphqlCollector, /timeline_list_feed_units/);\n  assert.match(graphqlCollector, /credentials:'include'/);\n  assert.doesNotMatch(graphqlCollector, /getCookie\\(/);\n});\n""",
)

replace_once(
    "server/tests/architectureRegression.test.ts",
    "assert.match(plugin, /AuthenticatedWebCollector\\.collect\\(foregroundContext\\(\\)/);",
    "assert.match(plugin, /FacebookGraphqlWebViewCollector\\.collect\\(foregroundContext\\(\\)/);",
)
