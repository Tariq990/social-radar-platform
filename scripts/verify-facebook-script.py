"""Validate the actual Java-emitted collector script, not the text-block source.
Run with JAVA_HOME set to JDK 21 and Node available on PATH.
"""
from pathlib import Path
import os
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
source = (root / "android/app/src/main/java/com/mrscrap/socialradar/FacebookGraphqlWebViewCollector.java").read_text()
block = source.split('return """', 1)[1].split('"""', 1)[0]
java = str(Path(os.environ["JAVA_HOME"]) / "bin/java")
with tempfile.TemporaryDirectory() as directory:
    folder = Path(directory)
    probe = folder / "ScriptProbe.java"
    probe.write_text('public class ScriptProbe { public static void main(String[] args) { System.out.print("""' + block + '"""); }}')
    emitted = subprocess.run([java, str(probe)], check=True, capture_output=True, text=True).stdout
    script = folder / "collector.cjs"
    script.write_text(emitted)
    subprocess.run(["node", "--check", str(script)], check=True)
    print("PASS: Java-emitted JavaScript syntax")
    runtime = folder / "runtime.cjs"
    runtime.write_text(r"""
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const script = fs.readFileSync(process.argv[2], 'utf8')
  .replace('__LIMIT__', '10').replace('__REQUESTED__', JSON.stringify('https://www.facebook.com/profile.php?id=123456789'));
const story = id => ({post_id:id, message:{text:'fixture'}, creation_time:1700000000});
function context(fetch) {
  const c = {URL, URLSearchParams, fetch, location:{hostname:'www.facebook.com',pathname:'/profile.php',href:'https://www.facebook.com/profile.php?id=123456789'},
    document:{querySelector:()=>null,querySelectorAll:()=>[],documentElement:{innerHTML:''},title:'Fixture | Facebook'}};
  c.window = c; return vm.createContext(c);
}
async function settle(c, maxTurns=40) {
  let result = null;
  for (let i=0; i<maxTurns; i++) {
    result = JSON.parse(vm.runInContext(script,c));
    if (!result?.pending) return result;
    await new Promise(resolve=>setImmediate(resolve));
  }
  return result;
}
(async () => {
  let calls = 0;
  const c = context(async (url, options) => {
    calls++; assert.equal(url, '/api/graphql/'); assert.equal(options.credentials, 'include');
    assert.equal(JSON.parse(new URLSearchParams(options.body).get('variables')).id, '123456789');
    return {ok:true,text:async()=>[
      JSON.stringify({data:{node:{timeline_list_feed_units:{edges:[{node:story('111')}],page_info:{has_next_page:false}}}}}),
      JSON.stringify({data:{node:story('222')}})
    ].join('\n')};
  });
  const first=JSON.parse(vm.runInContext(script,c));
  assert.equal(first.pending,true);
  const result=await settle(c);
  assert.ok(result && Array.isArray(result.posts), 'collector did not settle to a post result');
  assert.equal(result.posts.length,2); assert.equal(calls,1);
  assert.equal(result.source.displayName,'Fixture');
  console.log('PASS: actual emitted script fetch and multiline response parser');

  const failed=context(async()=>{throw new Error('private transport detail')});
  const failedFirst=JSON.parse(vm.runInContext(script,failed));
  assert.equal(failedFirst.pending,true);
  const failedResult=await settle(failed);
  assert.equal(failedResult.error,'GRAPHQL_FETCH_FAILED');
  console.log('PASS: transport failure exposes only safe error code');
})().catch(error=>{console.error(error);process.exit(1)});
""")
    subprocess.run(["node", str(runtime), str(script)], check=True)
