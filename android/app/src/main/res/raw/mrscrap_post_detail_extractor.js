(() => {
  const normalizeName = value => String(value || '')
    .normalize('NFKC')
    .replace(/^@/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const abs = value => {
    try { return new URL(value, location.href).href; }
    catch { return ''; }
  };

  const isAllowedSocialUrl = value => {
    try {
      const u = new URL(value);
      const h = u.hostname.toLowerCase();
      return (u.protocol === 'https:' || u.protocol === 'http:') && (
        h === 'facebook.com' || h.endsWith('.facebook.com') || h === 'fb.com' || h.endsWith('.fb.com') || h === 'fb.watch' ||
        h === 'instagram.com' || h.endsWith('.instagram.com') || h === 'instagr.am' || h.endsWith('.instagr.am')
      );
    } catch { return false; }
  };

  const platform = () => {
    const h = location.hostname.toLowerCase();
    return h.includes('instagram') || h.includes('instagr.am') ? 'instagram' : 'facebook';
  };

  const imageUrl = img => {
    if (!img) return '';
    const direct = img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src') || '';
    if (direct) return abs(direct);
    const srcset = img.getAttribute('srcset') || '';
    if (!srcset) return '';
    return abs(srcset.split(',')[0].trim().split(/\s+/)[0]);
  };

  const isHttpMedia = value => /^https?:\/\//i.test(value || '');

  const commentLabel = node => (node?.getAttribute?.('aria-label') || '').trim();
  const isFacebookCommentArticle = node => {
    if (!node?.matches?.('[role="article"]')) return false;
    const label = commentLabel(node);
    return /^comment by\s+/i.test(label) || /^تعليق\s+(?:بواسطة|من)\s+/i.test(label) || /\bcomment by\b/i.test(label);
  };

  const instagramCommentCandidates = () => {
    if (platform() !== 'instagram') return [];
    return [...document.querySelectorAll('main ul li, [role="dialog"] ul li')].filter(node => {
      const text = (node.innerText || '').trim();
      if (text.length < 3 || text.length > 12000) return false;
      const links = [...node.querySelectorAll('a[href]')];
      return links.some(link => {
        try {
          const u = new URL(link.href, location.href);
          const h = u.hostname.toLowerCase();
          const parts = u.pathname.split('/').filter(Boolean);
          return (h === 'instagram.com' || h.endsWith('.instagram.com')) && parts.length === 1 && Boolean((link.innerText || '').trim());
        } catch { return false; }
      });
    });
  };

  const facebookPhotoListComments = () => [...document.querySelectorAll('[role="dialog"] [role="listitem"]')].filter(node => {
    const text = (node.innerText || '').trim();
    if (text.length < 3 || text.length > 12000) return false;
    const profileLink = [...node.querySelectorAll('a[href]')].some(anchor => {
      try {
        const u = new URL(anchor.href, location.href);
        const h = u.hostname.toLowerCase();
        const parts = u.pathname.split('/').filter(Boolean);
        return (h === 'facebook.com' || h.endsWith('.facebook.com')) &&
          (parts.length === 1 || u.pathname.toLowerCase() === '/profile.php');
      } catch { return false; }
    });
    return profileLink;
  });

  const commentNodes = () => {
    const facebook = [...document.querySelectorAll('[role="article"][aria-label]')].filter(isFacebookCommentArticle);
    if (facebook.length) return facebook;
    if (platform() === 'facebook') return facebookPhotoListComments();
    return instagramCommentCandidates();
  };

  const actionLine = line => {
    const value = String(line || '').trim();
    if (!value) return true;
    return /^(like|reply|share|follow|edited|hide|report|see translation|send|more|تعجبني|أعجبني|رد|مشاركة|متابعة|تم التعديل|إخفاء|إبلاغ|عرض الترجمة)$/i.test(value) ||
      /^(view|see|show)\s+\d*\s*(more\s+)?repl/i.test(value) ||
      /^(view|see|show)\s+\d*\s*(more\s+)?comments?/i.test(value) ||
      /^عرض\s+.*(رد|تعليق)/i.test(value) ||
      /^\d+[\d,.]*\s*(likes?|reactions?|replies?|تعليقات?|ردود?|إعجابات?)?$/i.test(value) ||
      /^(a few seconds ago|about a minute ago|just now|yesterday|today|\d+\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago)$/i.test(value) ||
      /^(الآن|منذ\s+.*|أمس|اليوم)$/i.test(value);
  };

  const findAuthorAnchor = node => {
    const p = platform();
    for (const anchor of node?.querySelectorAll?.('a[href]') || []) {
      const name = (anchor.innerText || anchor.getAttribute('aria-label') || '').trim();
      if (!name || name.length > 255 || actionLine(name)) continue;
      try {
        const u = new URL(anchor.href, location.href);
        const h = u.hostname.toLowerCase();
        const parts = u.pathname.split('/').filter(Boolean);
        if (p === 'facebook') {
          const same = h === 'facebook.com' || h.endsWith('.facebook.com');
          const profile = parts.length === 1 || u.pathname.toLowerCase().endsWith('/profile.php') || u.pathname.toLowerCase() === '/profile.php';
          if (same && profile) return anchor;
        } else {
          const same = h === 'instagram.com' || h.endsWith('.instagram.com');
          if (same && parts.length === 1) return anchor;
        }
      } catch {}
    }
    return null;
  };

  const parseAuthorFromLabel = label => {
    let value = String(label || '').trim();
    value = value.replace(/^comment by\s+/i, '').replace(/^تعليق\s+(?:بواسطة|من)\s+/i, '');
    value = value.replace(/\s+(?:a few seconds ago|about a minute ago|just now|yesterday|today|\d+\s*(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago).*$/i, '');
    value = value.replace(/\s+منذ\s+.*$/i, '');
    return value.trim().slice(0, 255);
  };

  const publishedLabelFrom = (label, authorName) => {
    const raw = String(label || '').trim();
    if (!raw) return '';
    const prefixes = [`Comment by ${authorName}`, `تعليق بواسطة ${authorName}`, `تعليق من ${authorName}`];
    for (const prefix of prefixes) {
      if (raw.toLowerCase().startsWith(prefix.toLowerCase())) return raw.slice(prefix.length).trim().slice(0, 200);
    }
    return '';
  };

  const commentDepth = node => {
    let depth = 0;
    let parent = node?.parentElement || null;
    const listItemMode = Boolean(node?.matches?.('[role="listitem"]'));
    while (parent && depth < 4) {
      if (isFacebookCommentArticle(parent) || (listItemMode && parent.matches?.('[role="listitem"]'))) depth++;
      parent = parent.parentElement;
    }
    return depth;
  };

  const facebookListItemAuthor = (node, anchor) => {
    if (!node?.matches?.('[role="listitem"]')) return '';
    const root = anchor || node;
    const leaves = [...root.querySelectorAll('div,span')].filter(item => {
      const value = (item.innerText || '').replace(/\s+/g, ' ').trim();
      return value && value.length <= 255 && !item.querySelector('*') && !actionLine(value);
    });
    const preferred = leaves.find(item => item.tagName === 'DIV') || leaves[0];
    return (preferred?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 255);
  };

  const textWithoutNestedComments = (node, authorName) => {
    if (!node) return '';
    const clone = node.cloneNode(true);
    for (const nested of [...clone.querySelectorAll('[role="article"][aria-label]')]) {
      if (isFacebookCommentArticle(nested)) nested.remove();
    }
    if (node.matches?.('[role="listitem"]')) {
      for (const nested of [...clone.querySelectorAll('[role="listitem"]')]) nested.remove();
    }
    const lines = String(clone.innerText || '')
      .split(/\n+/)
      .map(line => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const output = [];
    const seen = new Set();
    const authorKey = normalizeName(authorName);
    for (const line of lines) {
      if (normalizeName(line) === authorKey || actionLine(line)) continue;
      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(line);
    }
    return output.join('\n').trim().slice(0, 5000);
  };

  const commentPermalink = node => {
    for (const anchor of node?.querySelectorAll?.('a[href]') || []) {
      const href = abs(anchor.getAttribute('href') || anchor.href || '');
      if (!isAllowedSocialUrl(href)) continue;
      try {
        const u = new URL(href);
        if (u.searchParams.has('comment_id') || u.searchParams.has('reply_comment_id')) return href;
      } catch {}
    }
    return '';
  };

  const commentId = value => {
    try {
      const u = new URL(value);
      return (u.searchParams.get('comment_id') || u.searchParams.get('reply_comment_id') || '').slice(0, 512);
    } catch { return ''; }
  };

  const commentMedia = (node, authorAvatar) => {
    const media = [];
    const seen = new Set();
    for (const img of [...(node?.querySelectorAll?.('img') || [])].slice(0, 12)) {
      const src = imageUrl(img);
      if (!isHttpMedia(src) || src === authorAvatar || seen.has(src)) continue;
      const r = img.getBoundingClientRect?.();
      const w = Number(img.naturalWidth || img.width || r?.width || 0);
      const h = Number(img.naturalHeight || img.height || r?.height || 0);
      if (w && h && w < 64 && h < 64) continue;
      seen.add(src);
      media.push({ type: 'image', url: src });
      if (media.length >= 4) break;
    }
    return media;
  };

  const collectPostMedia = nodes => {
    const media = [];
    const seen = new Set();
    const isInsideComment = element => nodes.some(node => node === element || node.contains?.(element));
    let videoPresent = false;

    for (const video of [...document.querySelectorAll('video')].slice(0, 8)) {
      if (isInsideComment(video)) continue;
      videoPresent = true;
      const src = abs(video.currentSrc || video.getAttribute('src') || video.querySelector('source[src]')?.getAttribute('src') || '');
      if (isHttpMedia(src) && !seen.has(src)) {
        seen.add(src);
        media.push({ type: 'video', url: src });
      }
      const poster = abs(video.getAttribute('poster') || '');
      if (isHttpMedia(poster) && !seen.has(poster)) {
        seen.add(poster);
        media.push({ type: 'image', url: poster });
      }
    }

    for (const img of [...document.querySelectorAll('main img, [role="main"] img, [role="dialog"] img, img')].slice(0, 250)) {
      if (isInsideComment(img)) continue;
      const src = imageUrl(img);
      if (!isHttpMedia(src) || seen.has(src)) continue;
      const r = img.getBoundingClientRect?.();
      const w = Number(img.naturalWidth || img.width || r?.width || 0);
      const h = Number(img.naturalHeight || img.height || r?.height || 0);
      const alt = ((img.getAttribute('alt') || '') + ' ' + (img.getAttribute('aria-label') || '')).toLowerCase();
      if ((w && h && w < 120 && h < 120) && !/(photo|image|صورة)/i.test(alt)) continue;
      if (!w && !h && !/(fbcdn|scontent|cdninstagram)/i.test(src)) continue;
      seen.add(src);
      media.push({ type: 'image', url: src });
      if (media.length >= 12) break;
    }
    return { media, videoPresent };
  };

  const expandPattern = text => /(view|see|show).*(comments?|repl)|عرض.*(تعليق|رد)|المزيد.*(تعليق|رد)/i.test(String(text || '').trim());

  globalThis.__MR_SCRAP_EXPAND_POST_DETAIL__ = () => {
    let clicked = 0;
    for (const element of document.querySelectorAll('[role="button"],button,a')) {
      const text = (element.innerText || element.getAttribute('aria-label') || '').trim();
      if (!text || !expandPattern(text)) continue;
      try {
        element.click();
        clicked++;
        if (clicked >= 8) break;
      } catch {}
    }
    const amount = Math.max(window.innerHeight || 0, 760);
    window.scrollBy(0, Math.round(amount * 1.25));
    return { clicked, scrollY: Math.round(window.scrollY || 0) };
  };

  globalThis.__MR_SCRAP_EXTRACT_POST_DETAIL__ = options => {
    const opts = options && typeof options === 'object' ? options : {};
    const currentPath = location.pathname.toLowerCase();
    const loginForm = Boolean(document.querySelector('form[action*="login"], input[name="email"], input[name="pass"]'));
    if (currentPath.includes('/checkpoint')) return JSON.stringify({ error: 'SESSION_CHECKPOINT' });
    if (currentPath.includes('/login') || loginForm) return JSON.stringify({ error: 'SESSION_REQUIRED' });

    const mode = ['publisher', 'top', 'all'].includes(opts.commentsMode) ? opts.commentsMode : 'none';
    const limit = Math.max(0, Math.min(200, Number(opts.commentLimit) || 0));
    const includeReplies = opts.includeReplies !== false;
    const publisher = normalizeName(opts.publisherName || '');
    const nodes = commentNodes();
    const comments = [];
    const seen = new Set();

    if (mode !== 'none' && limit > 0) {
      for (const node of nodes) {
        const depth = commentDepth(node);
        if (!includeReplies && depth > 0) continue;
        const authorAnchor = findAuthorAnchor(node);
        const label = commentLabel(node);
        const authorName = (facebookListItemAuthor(node, authorAnchor) ||
          (authorAnchor?.innerText || authorAnchor?.getAttribute?.('aria-label') || '').trim() ||
          parseAuthorFromLabel(label)).slice(0, 255);
        if (!authorName) continue;
        const isPublisher = Boolean(publisher) && normalizeName(authorName) === publisher;
        if (mode === 'publisher' && !isPublisher) continue;
        const text = textWithoutNestedComments(node, authorName);
        if (!text) continue;
        const authorUrl = abs(authorAnchor?.getAttribute?.('href') || authorAnchor?.href || '');
        const avatar = imageUrl(node.querySelector('img'));
        const permalink = commentPermalink(node);
        const id = commentId(permalink);
        const key = id || `${normalizeName(authorName)}|${text.slice(0, 500)}|${depth}`;
        if (seen.has(key)) continue;
        seen.add(key);
        comments.push({
          externalCommentId: id || undefined,
          authorName,
          authorUrl: isAllowedSocialUrl(authorUrl) ? authorUrl : undefined,
          authorAvatar: isHttpMedia(avatar) ? avatar : undefined,
          text,
          publishedLabel: publishedLabelFrom(label, authorName) || undefined,
          originalUrl: permalink || undefined,
          isPublisher,
          depth,
          media: commentMedia(node, avatar)
        });
        if (comments.length >= limit) break;
      }
    }

    const { media, videoPresent } = collectPostMedia(nodes);
    const hasMoreControls = [...document.querySelectorAll('[role="button"],button,a')].some(element => {
      const text = (element.innerText || element.getAttribute('aria-label') || '').trim();
      return text && expandPattern(text);
    });

    return JSON.stringify({
      comments,
      commentsTruncated: mode !== 'none' && (comments.length >= limit || hasMoreControls),
      media,
      videoPresent,
      diagnostics: {
        surface: location.hostname,
        commentArticles: nodes.length,
        returnedComments: comments.length,
        hasMoreControls,
        bodyTextLength: (document.body?.innerText || '').length
      }
    });
  };

  return true;
})()
