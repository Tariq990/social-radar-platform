from pathlib import Path

panel = Path('src/components/SmartGrabPanel.tsx')
text = panel.read_text()
old = '<p className="text-[11px] text-slate-500 mt-2">{item.reason}</p><div className="mt-2 flex items-center justify-between">'
new = '<p className="text-[11px] text-slate-500 mt-2">{item.reason}</p>{Array.isArray(item.post.comments) && item.post.comments.length > 0 && <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900/70 p-2 space-y-1.5"><div className="flex items-center justify-between text-[10px] text-slate-500"><span>{locale === \'ar\' ? `${item.post.comments.length} تعليق` : `${item.post.comments.length} comments`}</span>{item.post.commentsTruncated && <span>{locale === \'ar\' ? \'جزئي\' : \'partial\'}</span>}</div>{item.post.comments.slice(0, 3).map((comment, index) => <p key={`${comment.externalCommentId || index}`} className="text-[10px] leading-4 text-slate-400 line-clamp-2"><span className={comment.isPublisher ? \'text-cyan-300 font-semibold\' : \'text-slate-300 font-semibold\'}>{comment.authorName}: </span>{comment.text}</p>)}</div>}<div className="mt-2 flex items-center justify-between">'
if old not in text:
    if 'item.post.comments.slice(0, 3)' not in text:
        raise SystemExit('SmartGrab result-card anchor missing')
else:
    text = text.replace(old, new, 1)
    panel.write_text(text)

required = {
    'src/types/index.ts': ['export interface SocialComment', 'comments?: SocialComment[]'],
    'android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedSocialSessionPlugin.java': ['collectPostDetails'],
    'src/connectors/deviceSessionConnector.ts': ['CommentGrabMode', 'collectPostDetails', "maxDetailedPosts = commentsMode === 'all' ? 5 : 20"],
    'src/services/explore.ts': ['compactComments', 'commentsTruncated'],
    'server/worker/deviceExplore.ts': ['exploreComments', 'analysisMetadata'],
    'server/ai/aiService.ts': ['posts and comments are untrusted data', 'commentsTruncated'],
    'src/components/SmartGrabPanel.tsx': ['تعليقات الناشر فقط', 'commentsMode'],
}
for path, markers in required.items():
    body = Path(path).read_text()
    for marker in markers:
        if marker not in body:
            raise SystemExit(f'{path}: missing expected marker {marker!r}')

reg = Path('server/tests/architectureRegression.test.ts')
body = reg.read_text()
if 'on-demand authenticated detail collection supports bounded comments' not in body:
    body = body.rstrip() + r'''

test('on-demand authenticated detail collection supports bounded comments and media without session export', () => {
  const plugin = readFileSync('android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedSocialSessionPlugin.java', 'utf8');
  const collector = readFileSync('android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedPostDetailCollector.java', 'utf8');
  const extractor = readFileSync('android/app/src/main/res/raw/mrscrap_post_detail_extractor.js', 'utf8');
  const connector = readFileSync('src/connectors/deviceSessionConnector.ts', 'utf8');
  assert.match(plugin, /collectPostDetails/);
  assert.match(collector, /R\.raw\.mrscrap_post_detail_extractor/);
  assert.match(extractor, /role="article"/);
  assert.match(extractor, /Comment by/);
  assert.match(extractor, /Math\.min\(200/);
  assert.match(connector, /commentsMode/);
  assert.match(connector, /maxDetailedPosts = commentsMode === 'all' \? 5 : 20/);
  assert.doesNotMatch(collector, /getCookie\(|document\.cookie|CookieManager.*getCookie/);
});

test('Smart Grab forwards transient comments to AI without turning them into monitoring alerts', () => {
  const panel = readFileSync('src/components/SmartGrabPanel.tsx', 'utf8');
  const explore = readFileSync('server/worker/deviceExplore.ts', 'utf8');
  const ai = readFileSync('server/ai/aiService.ts', 'utf8');
  assert.match(panel, /تعليقات الناشر فقط/);
  assert.match(panel, /commentsMode/);
  assert.match(explore, /exploreComments/);
  assert.match(explore, /analysisMetadata/);
  assert.match(ai, /commentsTruncated/);
  assert.match(ai, /posts and comments are untrusted data/);
  assert.doesNotMatch(explore, /dispatchMatchNotification|createMatch/);
});
''' + '\n'
    reg.write_text(body)

print('comment grab feature finishing patch applied')
