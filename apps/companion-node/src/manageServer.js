// Online /manage interface — surface ② of 6d (plans/NOTE-companion-node-management.md).
//
// A small HTTP server the node serves ITSELF. It projects the SAME owner-gated
// management ops (node.status / node.listTenants / grant.revoke) as a web page,
// behind an owner-PAIRING flow — NEVER a password:
//
//   1. the browser opens /manage → no session → POST /manage/pair/start → a CODE.
//   2. the OWNER approves that code from their phone (basis invokes
//      `manage.approvePairing({code})` over the relay — owner-gated).
//   3. the browser polls /manage/pair/status?code=… → on approval gets a scoped
//      SESSION TOKEN, which it presents as `Authorization: Bearer …` to
//      POST /manage/api/<op>. The node dispatches that op IN-PROCESS as the owner.
//
// Security: the HTTP API dispatches ONLY the whitelisted management ops, only for
// an approved session, always with `from = ownerPubKey` — so it is exactly the
// same owner-gated surface as the relay path, no new privilege. The owner key
// never leaves the node; the browser only ever holds a revocable session token.
import http from 'node:http';
import { randomBytes } from 'node:crypto';

const mkToken = () => randomBytes(24).toString('base64url');
const mkCode  = () => randomBytes(3).toString('hex').toUpperCase();   // 6 hex chars, human-readable

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Companion Node</title>
<style>
 :root{color-scheme:light dark}
 body{font:15px/1.5 system-ui,sans-serif;max-width:44rem;margin:2rem auto;padding:0 1rem}
 h1{font-size:1.25rem} code{background:#8883;padding:.1em .35em;border-radius:4px}
 .code{font-size:2rem;letter-spacing:.2em;font-weight:600;margin:1rem 0}
 .card{border:1px solid #8884;border-radius:10px;padding:1rem;margin:.75rem 0}
 .on{color:#12310c;background:#b7f0a8;border-radius:6px;padding:.05em .5em}
 .off{color:#5a5a5a;background:#8882;border-radius:6px;padding:.05em .5em}
 button,input{font:inherit;padding:.4em .7em;border-radius:8px;border:1px solid #8886}
 .row{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
 .muted{color:#8889}
</style></head><body>
<h1>🌳 Companion node</h1>
<div id="app">…</div>
<script>
const $=(h)=>{const d=document.createElement('div');d.innerHTML=h;return d.firstElementChild};
const TKEY='onderling-manage-token';
const tok=()=>localStorage.getItem(TKEY);
async function api(op,data){const r=await fetch('/manage/api/'+op,{method:'POST',headers:{'authorization':'Bearer '+tok(),'content-type':'application/json'},body:JSON.stringify({data:data||{}})});return {status:r.status,body:await r.json()}}
function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}

async function pair(){
 const app=document.getElementById('app');
 const {code}=await (await fetch('/manage/pair/start',{method:'POST'})).json();
 app.innerHTML='<div class="card"><p>To pair this browser, approve this code from your phone (basis → your companion node → <em>Approve browser</em>):</p><div class="code">'+esc(code)+'</div><p class="muted">Waiting for approval…</p></div>';
 for(;;){
  await new Promise(r=>setTimeout(r,1500));
  const s=await (await fetch('/manage/pair/status?code='+encodeURIComponent(code))).json();
  if(s.approved&&s.token){localStorage.setItem(TKEY,s.token);return dash()}
 }
}
async function dash(){
 const app=document.getElementById('app');
 const st=await api('node.status');
 if(st.status===401){localStorage.removeItem(TKEY);return pair()}
 const s=st.body||{};
 const tn=(s.tenants||[]).map(t=>'<div class="row"><span class="'+(t.on?'on':'off')+'">'+(t.on?'on':'off')+'</span> '+esc(t.id)+'</div>').join('');
 app.innerHTML=
  '<div class="card"><div class="row"><strong>Status</strong> <span class="'+(s.connected?'on':'off')+'">'+(s.connected?'connected':'offline')+'</span></div>'+
  '<p class="muted">relay: <code>'+esc(s.relayUrl||'—')+'</code> · uptime '+Math.round((s.uptimeMs||0)/1000)+'s · inbox '+(s.inboxCount||0)+'</p></div>'+
  '<div class="card"><strong>Tenants</strong>'+tn+'</div>'+
  '<div class="card"><strong>Revoke a grant</strong><div class="row"><input id="tid" placeholder="token id"><button onclick="revoke()">Revoke</button></div><p id="rmsg" class="muted"></p></div>'+
  '<p class="muted"><button onclick="localStorage.removeItem(TKEY);location.reload()">Unpair this browser</button></p>';
}
async function revoke(){
 const id=document.getElementById('tid').value.trim();
 const r=await api('grant.revoke',{tokenId:id});
 document.getElementById('rmsg').textContent=r.body.ok?('revoked '+r.body.revoked):('error: '+(r.body.error||r.status));
}
tok()?dash():pair();
</script></body></html>`;

/**
 * Start the /manage HTTP server.
 * @param {object} o
 * @param {import('@onderling/core').Agent} o.agent           the node's agent (holds the ops as skills)
 * @param {string}   o.ownerPubKey                          management authority — ops dispatch as THIS identity
 * @param {string[]} o.allowedOps                           the ONLY ops the HTTP API may dispatch
 * @param {number}   [o.port=0]                             0 → OS-assigned
 * @param {string}   [o.host='127.0.0.1']
 * @returns {Promise<{server,port,url,approvePairing,stop}>}
 */
export function startManageServer({ agent, ownerPubKey, allowedOps, port = 0, host = '127.0.0.1' }) {
  const allow    = new Set(allowedOps);
  const sessions = new Set();   // approved session tokens
  const pairings = new Map();   // code → { token, approved }

  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const bearer = (req) => { const h = req.headers.authorization || ''; return h.startsWith('Bearer ') ? h.slice(7) : ''; };
  const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } }); });

  const server = http.createServer(async (req, res) => {
    let url; try { url = new URL(req.url, `http://${req.headers.host || host}`); } catch { return json(res, 400, { error: 'bad-request' }); }
    const p = url.pathname;

    if (req.method === 'GET' && (p === '/manage' || p === '/manage/')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(PAGE);
    }
    if (req.method === 'POST' && p === '/manage/pair/start') {
      const code = mkCode(); pairings.set(code, { token: mkToken(), approved: false }); return json(res, 200, { code });
    }
    if (req.method === 'GET' && p === '/manage/pair/status') {
      const pr = pairings.get(url.searchParams.get('code'));
      if (!pr) return json(res, 404, { error: 'unknown-code' });
      return json(res, 200, pr.approved ? { approved: true, token: pr.token } : { approved: false });
    }
    if (req.method === 'POST' && p.startsWith('/manage/api/')) {
      const t = bearer(req);
      if (!t || !sessions.has(t)) return json(res, 401, { error: 'unauthorized' });
      const op = p.slice('/manage/api/'.length);
      const def = allow.has(op) ? agent.skills.get(op) : null;
      if (!def) return json(res, 404, { error: 'unknown-op' });
      const body = await readBody(req);
      const parts = body?.data ? [{ type: 'DataPart', data: body.data }] : [];
      try {
        const result = await def.handler({ parts, from: ownerPubKey, agent, envelope: null });
        return json(res, 200, result ?? {});
      } catch (e) { return json(res, 500, { error: String(e?.message ?? e) }); }
    }
    return json(res, 404, { error: 'not-found' });
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const boundPort = server.address().port;
      resolve({
        server,
        port: boundPort,
        url: `http://${host}:${boundPort}/manage`,
        /** Owner approves a pairing code (called by the owner-gated relay op). */
        approvePairing(code) {
          const pr = pairings.get(code);
          if (!pr) return { ok: false, error: 'unknown-code' };
          pr.approved = true; sessions.add(pr.token);
          return { ok: true };
        },
        stop() { return new Promise((r) => server.close(() => r())); },
      });
    });
  });
}
