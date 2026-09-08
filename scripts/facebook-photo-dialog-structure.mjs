import fs from 'node:fs';

const BASE='http://127.0.0.1:9222';
const TARGET='https://www.facebook.com/tarik.ziad.3914';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const isFb=u=>{try{const h=new URL(u).hostname.toLowerCase();return h==='facebook.com'||h.endsWith('.facebook.com')}catch{return false}};
function collector(req,limit=10){
  const j=fs.readFileSync('android/app/src/main/java/com/mrscrap/socialradar/AuthenticatedWebCollector.java','utf8');
  const m=j.indexOf('private static String extractionScript('), b=j.indexOf('return """',m), s=j.indexOf('\n',b)+1, e=j.indexOf('\n            """',s);
  if(m<0||b<0||e<0) throw new Error('COLLECTOR_SCRIPT_NOT_FOUND');
  return j.slice(s,e).replace('__LIMIT__',String(limit)).replace('__REQUESTED__',JSON.stringify(req));
}

const targets=await(await fetch(`${BASE}/json/list`)).json();
const target=targets.find(x=>x.type==='page'&&isFb(x.url));
if(!target?.webSocketDebuggerUrl) throw new Error('NO_FACEBOOK_CDP_TAB');
const original=target.url;
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{const z=setTimeout(()=>reject(new Error('OPEN_TIMEOUT')),5000);ws.addEventListener('open',()=>{clearTimeout(z);resolve()},{once:true});ws.addEventListener('error',()=>reject(new Error('SOCKET_ERROR')),{once:true})});
let id=1; const pending=new Map();
ws.addEventListener('message',e=>{let m;try{m=JSON.parse(e.data)}catch{return}if(!m.id||!pending.has(m.id))return;const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(m.error.message||'CDP_ERROR')):p.resolve(m.result)});
function cdp(method,params={},timeout=15000){const call=id++;return new Promise((resolve,reject)=>{const z=setTimeout(()=>{pending.delete(call);reject(new Error('TIMEOUT:'+method))},timeout);pending.set(call,{resolve:v=>{clearTimeout(z);resolve(v)},reject:e=>{clearTimeout(z);reject(e)}});ws.send(JSON.stringify({id:call,method,params}))})}
async function ev(expression){const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error('EVAL_EXCEPTION');return r.result?.value}
async function ready(extra=1000){for(let i=0;i<35;i++){const s=await ev('document.readyState');if(s==='complete'||s==='interactive'){await sleep(extra);return}await sleep(250)}throw new Error('READY_TIMEOUT')}

await cdp('Runtime.enable'); await cdp('Page.enable');
const nav=await ev(`({ua:navigator.userAgent,platform:navigator.platform})`);
const androidUA='Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240905.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/152.0.7977.82 Mobile Safari/537.36';
await cdp('Emulation.setUserAgentOverride',{userAgent:androidUA,platform:'Android'});
await cdp('Emulation.setDeviceMetricsOverride',{width:412,height:915,deviceScaleFactor:2.625,mobile:true,screenWidth:412,screenHeight:915});

let result={clicked:false,dialogs:[]};
try{
  await cdp('Page.navigate',{url:TARGET}); await ready(1300);
  const script=collector(TARGET,10); let best={posts:[]};
  for(let i=0;i<12;i++){
    const raw=await ev(script), parsed=typeof raw==='string'?JSON.parse(raw):raw;
    if((parsed?.posts?.length||0)>(best?.posts?.length||0)) best=parsed;
    if((best?.posts?.length||0)>=10) break;
    await ev(`window.scrollBy(0,Math.round(Math.max(innerHeight||700,700)*1.8))`); await sleep(750);
  }
  const photo=(best.posts||[]).find(p=>{try{return new URL(p.originalUrl).pathname.toLowerCase().includes('/photo')}catch{return false}});
  if(!photo) throw new Error('NO_PHOTO_POST');
  const fbid=(()=>{try{return new URL(photo.originalUrl).searchParams.get('fbid')||''}catch{return''}})();
  result.clicked=Boolean(await ev(`(()=>{const fbid=${JSON.stringify(fbid)},target=${JSON.stringify(photo.originalUrl)};const links=[...document.querySelectorAll('a[href],a[data-href],a[data-url],a[ajaxify]')];const a=links.find(n=>{const raw=n.getAttribute('href')||n.getAttribute('data-href')||n.getAttribute('data-url')||n.getAttribute('ajaxify')||'';try{const u=new URL(raw,location.href);return (fbid&&u.searchParams.get('fbid')===fbid)||u.href===target}catch{return false}});if(!a)return false;a.click();return true})()`));
  await sleep(2500);
  result.dialogs=await ev(`(()=>[...document.querySelectorAll('[role="dialog"]')].map((d,index)=>{
    const all=[...d.querySelectorAll('*')];
    const label=(n)=>String(n.getAttribute?.('aria-label')||'').toLowerCase();
    const text=(n)=>String(n.innerText||'').trim();
    const profileAnchors=[...d.querySelectorAll('a[href]')].filter(a=>{try{const u=new URL(a.href,location.href),h=u.hostname.toLowerCase(),parts=u.pathname.split('/').filter(Boolean);return (h==='facebook.com'||h.endsWith('.facebook.com'))&&(parts.length===1||u.pathname.toLowerCase()==='/profile.php')}catch{return false}});
    return {
      index,
      elements:all.length,
      bodyTextLength:text(d).length,
      roleArticles:d.querySelectorAll('[role="article"]').length,
      roleArticlesWithAria:d.querySelectorAll('[role="article"][aria-label]').length,
      ariaLabels:d.querySelectorAll('[aria-label]').length,
      ariaCommentLike:all.filter(n=>/(comment|تعليق)/i.test(label(n))).length,
      ariaReplyLike:all.filter(n=>/(reply|replies|رد|ردود)/i.test(label(n))).length,
      textCommentControlLike:all.filter(n=>/(view|see|show).*comment|تعليق|comments?/i.test(text(n))&&text(n).length<180).length,
      textReplyControlLike:all.filter(n=>/(view|see|show).*repl|ردود?|repl(y|ies)/i.test(text(n))&&text(n).length<180).length,
      listItems:d.querySelectorAll('li').length,
      buttons:d.querySelectorAll('button,[role="button"]').length,
      profileAnchors:profileAnchors.length,
      images:d.querySelectorAll('img').length,
      videos:d.querySelectorAll('video').length,
      genericArticleCandidates:all.filter(n=>{const t=text(n);return t.length>=3&&t.length<=5000&&n.querySelector?.('a[href]')&&n.children?.length>0}).length
    };
  }))()`);
}finally{
  try{await cdp('Emulation.clearDeviceMetricsOverride')}catch{}
  try{if(nav?.ua)await cdp('Emulation.setUserAgentOverride',{userAgent:nav.ua,platform:nav.platform||'Linux x86_64'})}catch{}
  try{await cdp('Page.navigate',{url:original})}catch{}
  ws.close();
}
console.log('FACEBOOK_PHOTO_DIALOG_STRUCTURE');
console.log(JSON.stringify(result,null,2));
