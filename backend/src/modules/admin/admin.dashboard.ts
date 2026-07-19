/**
 * Self-contained SaveOnDrive Ops dashboard, served at GET /admin.
 * Same-origin: it talks to /api/v1/* with an admin bearer token.
 */
export const ADMIN_DASHBOARD_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>SaveOnDrive · Ops</title>
<style>
  :root { --blue:#1F6FEB; --dark:#0B2545; --green:#16A34A; --red:#DC2626; --amber:#D97706; --line:#E1E7EF; --bg:#F6F8FB; }
  * { box-sizing:border-box; } body { margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:#0f172a; }
  header { background:var(--dark); color:#fff; padding:14px 20px; display:flex; align-items:center; gap:12px; }
  header .logo { background:var(--blue); border-radius:8px; padding:4px 8px; font-weight:800; }
  main { max-width:1100px; margin:0 auto; padding:20px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:16px; margin-bottom:16px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:12px; }
  .stat { background:#fff; border:1px solid var(--line); border-radius:12px; padding:14px; }
  .stat .label { color:#64748b; font-size:12px; } .stat .value { font-size:22px; font-weight:800; margin-top:4px; }
  h2 { font-size:15px; margin:0 0 12px; } table { width:100%; border-collapse:collapse; font-size:13px; }
  th,td { text-align:left; padding:8px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:#64748b; font-weight:600; } .muted { color:#64748b; }
  button { border:0; border-radius:8px; padding:7px 12px; font-weight:600; cursor:pointer; }
  .btn { background:var(--blue); color:#fff; } .btn-green { background:var(--green); color:#fff; }
  .btn-red { background:var(--red); color:#fff; } .btn-ghost { background:#eef2f7; }
  input,textarea,select { width:100%; padding:9px; border:1px solid var(--line); border-radius:8px; font:inherit; }
  .row { display:flex; gap:8px; } .pill { font-size:11px; padding:2px 8px; border-radius:999px; }
  .pill.warn { background:#FEF3C7; color:var(--amber);} .pill.ok{background:#DCFCE7;color:var(--green);} .pill.bad{background:#FEE2E2;color:var(--red);}
  #login { max-width:360px; margin:60px auto; }
  .hidden { display:none; }
</style>
</head>
<body>
<header><span class="logo">SaveOnDrive</span><strong>Ops Dashboard</strong><span id="who" class="muted" style="margin-left:auto"></span></header>
<main>
  <div id="login" class="card">
    <h2>Admin sign in</h2>
    <p class="muted" style="font-size:13px">Sign in with an ADMIN account.</p>
    <div style="display:grid;gap:10px">
      <input id="email" placeholder="Email" value="admin@saveondrive.co.uk" />
      <input id="password" type="password" placeholder="Password" value="admin12345" />
      <button class="btn" onclick="login()">Sign in</button>
      <div id="loginErr" class="muted" style="color:var(--red)"></div>
    </div>
  </div>

  <div id="app" class="hidden">
    <div class="grid" id="stats"></div>

    <div class="card">
      <h2>Fraud review queue</h2>
      <table><thead><tr><th>When</th><th>User</th><th>Kind</th><th>Score</th><th>Reasons</th><th></th></tr></thead>
      <tbody id="risk"></tbody></table>
    </div>

    <div class="card">
      <h2>KYC pending review</h2>
      <table><thead><tr><th>User</th><th>Submitted</th><th>Document</th><th></th></tr></thead>
      <tbody id="kyc"></tbody></table>
    </div>

    <div class="card">
      <h2>Broadcast notification</h2>
      <div style="display:grid;gap:8px;max-width:520px">
        <input id="bTitle" placeholder="Title" />
        <textarea id="bBody" placeholder="Message" rows="2"></textarea>
        <div class="row">
          <select id="bTier"><option value="">All members</option><option>FREE</option><option>PLUS</option><option>DRIVE</option><option>DRIVE_PLUS</option></select>
          <button class="btn" onclick="broadcast()">Send</button>
        </div>
        <div id="bMsg" class="muted"></div>
      </div>
    </div>

    <div class="card">
      <h2>Users</h2>
      <input id="q" placeholder="Search email…" oninput="loadUsers()" style="max-width:280px;margin-bottom:10px" />
      <table><thead><tr><th>Email</th><th>Tier</th><th>KYC</th><th>Wallet</th><th>Joined</th></tr></thead>
      <tbody id="users"></tbody></table>
    </div>
  </div>
</main>
<script>
const API='/api/v1'; let token=localStorage.getItem('miq_admin');
const gbp=m=>'£'+((m||0)/100).toFixed(2);
const H=()=>({'authorization':'Bearer '+token,'content-type':'application/json'});
async function api(path,opts={}){const r=await fetch(API+path,{...opts,headers:{...H(),...(opts.headers||{})}});if(!r.ok)throw await r.json().catch(()=>({}));return r.json();}
async function login(){
  document.getElementById('loginErr').textContent='';
  try{
    const r=await fetch(API+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:email.value,password:password.value})});
    const d=await r.json(); if(!r.ok) throw d;
    token=d.accessToken; localStorage.setItem('miq_admin',token); boot();
  }catch(e){document.getElementById('loginErr').textContent=(e.error&&e.error.message)||'Sign in failed';}
}
async function boot(){
  try{await loadAll();document.getElementById('login').classList.add('hidden');document.getElementById('app').classList.remove('hidden');}
  catch(e){document.getElementById('loginErr').textContent='Not an admin or session expired';localStorage.removeItem('miq_admin');token=null;}
}
async function loadAll(){await Promise.all([loadStats(),loadRisk(),loadKyc(),loadUsers()]);}
async function loadStats(){
  const s=await api('/admin/stats');
  document.getElementById('who').textContent=s.users+' members';
  const tiles=[['Members',s.users],['KYC verified',s.kyc.verified],['KYC pending',s.kyc.pending],['Review queue',s.risk.reviewQueue],['Blocked',s.risk.blocked],['Cards issued',s.cardsIssued],['Wallet float',gbp(s.walletFloatMinor)],['Member fuel saved',gbp(s.totalMemberFuelSavedMinor)]];
  document.getElementById('stats').innerHTML=tiles.map(t=>'<div class="stat"><div class="label">'+t[0]+'</div><div class="value">'+t[1]+'</div></div>').join('');
}
async function loadRisk(){
  const rows=await api('/admin/risk/queue');
  document.getElementById('risk').innerHTML=rows.length?rows.map(r=>'<tr><td class="muted">'+new Date(r.createdAt).toLocaleString()+'</td><td>'+r.user.email+'</td><td>'+r.kind+'</td><td><span class="pill warn">'+r.score+'</span></td><td class="muted">'+r.reasons.join('; ')+'</td><td class="row"><button class="btn-green" onclick="riskDecide(\\''+r.id+'\\',\\'ALLOW\\')">Approve</button><button class="btn-red" onclick="riskDecide(\\''+r.id+'\\',\\'BLOCK\\')">Block</button></td></tr>').join(''):'<tr><td colspan=6 class=muted>Queue is empty</td></tr>';
}
async function riskDecide(id,decision){await api('/admin/risk/'+id+'/decision',{method:'POST',body:JSON.stringify({decision})});loadRisk();loadStats();}
async function loadKyc(){
  const rows=await api('/admin/kyc/pending');
  document.getElementById('kyc').innerHTML=rows.length?rows.map(r=>'<tr><td>'+r.user.email+'</td><td class="muted">'+(r.submittedAt?new Date(r.submittedAt).toLocaleString():'-')+'</td><td>'+(r.documentType||'-')+'</td><td class="row"><button class="btn-green" onclick="kycDecide(\\''+r.userId+'\\',\\'VERIFIED\\')">Verify</button><button class="btn-red" onclick="kycDecide(\\''+r.userId+'\\',\\'REJECTED\\')">Reject</button></td></tr>').join(''):'<tr><td colspan=4 class=muted>No pending KYC</td></tr>';
}
async function kycDecide(userId,decision){await api('/admin/kyc/'+userId+'/decision',{method:'POST',body:JSON.stringify({decision})});loadKyc();loadStats();}
async function loadUsers(){
  const q=document.getElementById('q').value;
  const rows=await api('/admin/users'+(q?'?q='+encodeURIComponent(q):''));
  const pill=s=>s==='VERIFIED'?'<span class="pill ok">VERIFIED</span>':s==='REJECTED'?'<span class="pill bad">REJECTED</span>':'<span class="pill warn">'+(s||'NONE')+'</span>';
  document.getElementById('users').innerHTML=rows.map(u=>'<tr><td>'+u.email+'</td><td>'+u.tier+'</td><td>'+pill(u.kyc&&u.kyc.status)+'</td><td>'+gbp(u.wallet&&u.wallet.balanceMinor)+'</td><td class="muted">'+new Date(u.createdAt).toLocaleDateString()+'</td></tr>').join('');
}
async function broadcast(){
  const tier=document.getElementById('bTier').value;
  const d=await api('/admin/broadcast',{method:'POST',body:JSON.stringify({title:bTitle.value,body:bBody.value,tier:tier||undefined})});
  document.getElementById('bMsg').textContent='Sent to '+d.sent+' member(s).';bTitle.value='';bBody.value='';
}
if(token) boot();
</script>
</body>
</html>`;
