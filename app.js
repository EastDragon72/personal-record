const GOOGLE_CLIENT_ID = "847293687996-dm48c53ag6cavp3bgocm9pb8r0cogseq.apps.googleusercontent.com";
const ACCOUNT_NAME_KEY = "personal-record-account-name";
const ACCOUNT_EMAIL_KEY = "personal-record-account-email";
const SHEET_URL_KEY = "personal-record-sheet-url";
const APP_FILE_NAME = "개인 기록장";
const APP_VERSION = "v11.4.4";
const STORAGE_KEY = "personal-records-v2";
const GOOGLE_SHEET_TAB = "기록";
const GOOGLE_SCOPES = "openid email profile https://www.googleapis.com/auth/spreadsheets";

let accountName = localStorage.getItem(ACCOUNT_NAME_KEY) || "";
let accountEmail = localStorage.getItem(ACCOUNT_EMAIL_KEY) || "";
let sheetUrl = localStorage.getItem(SHEET_URL_KEY) || "";
let accessToken = "";
let tokenExpiresAt = 0;
let tokenClient = null;
let silentTokenPromise = null;
let records = loadLocal();
let selectedCategory = "전체";
let selectedId = null;

const $ = id => document.getElementById(id);
function loadLocal(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]")}catch{return[]}}
function saveLocal(){localStorage.setItem(STORAGE_KEY,JSON.stringify(records))}
function today(){const d=new Date(),offset=d.getTimezoneOffset();return new Date(d.getTime()-offset*60000).toISOString().slice(0,10)}
function esc(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function formatDate(v){return v||""}
function cats(){return [...new Set(records.map(r=>r.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ko"))}
function validSheetUrl(url){return /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[^\s/]+(?:\/[^\s]*)?$/.test(url)}
function sheetIdFromUrl(url){const m=url.match(/\/spreadsheets\/d\/([^/]+)/);return m?m[1]:""}
function initGoogleClient(){
  if(!window.google?.accounts?.oauth2) return false;
  if(!tokenClient){
    tokenClient=google.accounts.oauth2.initTokenClient({
      client_id:GOOGLE_CLIENT_ID,
      scope:GOOGLE_SCOPES,
      callback:()=>{}
    });
  }
  return true;
}

function requestGoogleToken(force=false){
  if(!initGoogleClient()) return Promise.reject(new Error("Google 로그인 기능을 불러오는 중입니다. 잠시 후 다시 눌러주세요."));
  if(!force && accessToken && Date.now() < tokenExpiresAt - 60000) return Promise.resolve(accessToken);
  if(!force && silentTokenPromise) return silentTokenPromise;
  const prompt=force?"select_account":"none";
  const run=new Promise((resolve,reject)=>{
    tokenClient.callback=(resp)=>{
      if(resp.error){reject(new Error(resp.error_description||"Google 로그인에 실패했습니다."));return}
      accessToken=resp.access_token||"";
      tokenExpiresAt=Date.now()+((Number(resp.expires_in)||3600)*1000);
      resolve(accessToken);
    };
    // force=true는 사용자가 누른 연결/전환 버튼에서만 호출합니다.
    tokenClient.requestAccessToken({prompt});
  });
  if(!force){
    silentTokenPromise=run.finally(()=>{silentTokenPromise=null});
    return silentTokenPromise;
  }
  return run;
}

async function getToken(force=false){
  if(!force && accessToken && Date.now() < tokenExpiresAt - 60000) return accessToken;
  return requestGoogleToken(force);
}

async function googleFetch(url,options={}){
  let token=await getToken(false);
  const headers={...(options.headers||{}),Authorization:"Bearer "+token};
  let res=await fetch(url,{...options,headers,cache:"no-store"});
  if(res.status===401){accessToken="";tokenExpiresAt=0;token=await getToken(false);res=await fetch(url,{...options,headers:{...(options.headers||{}),Authorization:"Bearer "+token},cache:"no-store"})}
  if(!res.ok){let msg="Google 서버 오류 ("+res.status+")";try{const e=await res.json();msg=e.error?.message||msg}catch{}throw new Error(msg)}
  return res;
}

async function googleUser(){
  const res=await googleFetch("https://openidconnect.googleapis.com/v1/userinfo");
  return res.json();
}

async function ensureSheet(){
  const id=sheetIdFromUrl(sheetUrl); if(!id)throw new Error("Google Sheets URL을 확인해주세요.");
  const metaRes=await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}?fields=sheets(properties(sheetId,title))`);
  const meta=await metaRes.json();
  const found=(meta.sheets||[]).find(s=>s.properties?.title===GOOGLE_SHEET_TAB);
  if(!found){
    await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}:batchUpdate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({requests:[{addSheet:{properties:{title:GOOGLE_SHEET_TAB}}}]})});
  }
  const headerRes=await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent("'"+GOOGLE_SHEET_TAB+"'!A1:F1")}`);
  const header=(await headerRes.json()).values?.[0]||[];
  if(header.join("|")!=="id|date|category|title|content|memo"){
    await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent("'"+GOOGLE_SHEET_TAB+"'!A1:F1")}?valueInputOption=RAW`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({range:`'${GOOGLE_SHEET_TAB}'!A1:F1`,majorDimension:"ROWS",values:[["id","date","category","title","content","memo"]]})});
  }
}

async function googleList(){
  await ensureSheet(); const id=sheetIdFromUrl(sheetUrl);
  const res=await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent("'"+GOOGLE_SHEET_TAB+"'!A2:F")}`);
  const rows=(await res.json()).values||[];
  return rows.filter(r=>r.some(v=>v!=="")).map(r=>({id:String(r[0]||""),date:String(r[1]||"").slice(0,10),category:String(r[2]||""),title:String(r[3]||""),content:String(r[4]||""),memo:String(r[5]||"")}));
}

async function googleCreate(data){
  await ensureSheet(); const id=sheetIdFromUrl(sheetUrl);
  await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent("'"+GOOGLE_SHEET_TAB+"'!A:F")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({values:[[data.id,data.date,data.category,data.title,data.content,data.memo]]})});
}

async function googleFindRow(id){
  const rows=await googleList(); const idx=rows.findIndex(r=>String(r.id)===String(id)); return idx<0?-1:idx+2;
}
async function googleUpdate(data){
  const row=await googleFindRow(data.id); if(row<0)throw new Error("수정할 기록을 찾지 못했습니다.");
  const sid=sheetIdFromUrl(sheetUrl);
  await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sid)}/values/${encodeURIComponent("'"+GOOGLE_SHEET_TAB+"'!A"+row+":F"+row)}?valueInputOption=RAW`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({range:`'${GOOGLE_SHEET_TAB}'!A${row}:F${row}`,majorDimension:"ROWS",values:[[data.id,data.date,data.category,data.title,data.content,data.memo]]})});
}
async function googleDelete(id){
  const row=await googleFindRow(id); if(row<0)throw new Error("삭제할 기록을 찾지 못했습니다.");
  const sid=sheetIdFromUrl(sheetUrl); const metaRes=await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sid)}?fields=sheets(properties(sheetId,title))`); const meta=await metaRes.json(); const sh=(meta.sheets||[]).find(s=>s.properties?.title===GOOGLE_SHEET_TAB); if(!sh)throw new Error("기록 시트를 찾지 못했습니다.");
  await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sid)}:batchUpdate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({requests:[{deleteDimension:{range:{sheetId:sh.properties.sheetId,dimension:"ROWS",startIndex:row-1,endIndex:row}}}]})});
}

async function connectGoogle(force=true){
  const url=$("sheetUrlInput").value.trim().replace(/\s+/g,"");
  if(!validSheetUrl(url)){$("settingsStatus").textContent="Google Sheets URL을 먼저 입력해주세요.";return false}
  sheetUrl=url; $("settingsStatus").textContent="Google 계정 연결 중...";
  try{
    // 사용자 버튼 클릭 직후 OAuth 팝업을 호출합니다.
    await requestGoogleToken(force);
    const user=await googleUser();
    accountEmail=user.email||accountEmail;
    if(!$("accountNameInput").value.trim()) accountName=user.name||user.given_name||"";
    $("accountEmailInput").value=accountEmail;
    if(!$("accountNameInput").value.trim()) $("accountNameInput").value=accountName;
    await ensureSheet();
    localStorage.setItem(SHEET_URL_KEY,sheetUrl);localStorage.setItem(ACCOUNT_EMAIL_KEY,accountEmail);localStorage.setItem(ACCOUNT_NAME_KEY,accountName);
    $("settingsStatus").textContent="연결됨 · "+accountEmail;
    return true;
  }catch(err){$("settingsStatus").textContent="연결 실패: "+err.message;return false}
}

async function syncList(){if(!sheetUrl||!validSheetUrl(sheetUrl))return;records=await googleList();saveLocal()}
function renderCategories(){const list=["전체",...cats()];$("categoryBar").innerHTML=list.map(c=>`<button class="chip ${c===selectedCategory?"active":""}" data-category="${esc(c)}">${esc(c)}</button>`).join("");$("categoryOptions").innerHTML=cats().map(c=>`<option value="${esc(c)}"></option>`).join("")}
function filtered(){const q=$("searchInput").value.trim().toLowerCase();return records.filter(r=>(selectedCategory==="전체"||r.category===selectedCategory)&&(!q||[r.category,r.title,r.content,r.memo].some(v=>(v||"").toLowerCase().includes(q)))).sort((a,b)=>(b.date||"").localeCompare(a.date||"")||String(b.id).localeCompare(String(a.id)))}
function renderList(){const data=filtered();const header='<div class="record-header" aria-hidden="true"><span>작성일</span><span>분류</span><span>제목</span></div>';const rows=data.map(r=>`<button class="record-card" data-id="${esc(r.id)}"><span class="record-date">${esc(formatDate(r.date))}</span><span class="category">${esc(r.category||"")}</span><span class="record-title">${esc(r.title||"제목 없음")}</span></button>`).join("");$("recordList").innerHTML=data.length?header+rows:"";$("emptyState").hidden=data.length!==0}
function render(){renderCategories();renderList()}
function resetForm(r=null){$("recordId").value=r?.id||"";$("dateInput").value=r?.date||today();$("categoryInput").value=r?.category||(selectedCategory!=="전체"?selectedCategory:"");$("titleInput").value=r?.title||"";$("contentInput").value=r?.content||"";$("memoInput").value=r?.memo||"";$("editorTitle").textContent=r?"기록 수정":"기록 작성"}
function openEditor(r=null){resetForm(r);$("editorDialog").showModal()}
function openDetail(id){selectedId=id;const r=records.find(x=>x.id===id);if(!r)return;$("detailBody").innerHTML=`<div class="detail-meta">${formatDate(r.date)}</div><div class="detail-category">${esc(r.category)}</div><h3>${esc(r.title||"제목 없음")}</h3><div class="detail-section"><div class="detail-content">${esc(r.content||"")}</div></div>${r.memo?`<div class="detail-section"><strong>메모</strong><div class="detail-memo">${esc(r.memo)}</div></div>`:""}`;$("detailDialog").showModal()}
function openSettings(){ $("accountNameInput").value=accountName;$("accountEmailInput").value=accountEmail;$("sheetUrlInput").value=sheetUrl;$("settingsStatus").textContent=accountEmail?("연결 계정: "+accountEmail):"Google 계정 연결 필요";$("settingsDialog").showModal() }

$("settingsBtn").onclick=openSettings;
$("settingsCancelBtn").onclick=()=>$("settingsDialog").close();
$("connectGoogleBtn").onclick=()=>connectGoogle(true);
$("testBackupBtn").onclick=async()=>{if(await connectGoogle(false)){try{const data=await googleList();$("settingsStatus").textContent=`연결 성공 · 기록 ${data.length}건`}catch(err){$("settingsStatus").textContent="연결 실패: "+err.message}}};
$("settingsForm").onsubmit=async e=>{
  e.preventDefault();
  const url=$("sheetUrlInput").value.trim().replace(/\s+/g,"");
  if(!validSheetUrl(url)){ $("settingsStatus").textContent="Google Sheets URL을 확인해주세요."; return; }
  accountName=$("accountNameInput").value.trim();
  accountEmail=$("accountEmailInput").value.trim()||accountEmail;
  sheetUrl=url;
  localStorage.setItem(ACCOUNT_NAME_KEY,accountName);
  localStorage.setItem(ACCOUNT_EMAIL_KEY,accountEmail);
  localStorage.setItem(SHEET_URL_KEY,sheetUrl);
  // 이미 연결된 경우에만 시트를 확인합니다. 저장 버튼에서는 OAuth를 다시 호출하지 않습니다.
  if(accessToken){
    $("settingsStatus").textContent="저장 중...";
    try{ await ensureSheet(); await syncList(); render(); $("settingsDialog").close(); }
    catch(err){ $("settingsStatus").textContent="시트 저장 실패: "+err.message; }
  }else{
    $("settingsDialog").close();
  }
};
$("newBtn").onclick=()=>openEditor();$("cancelBtn").onclick=()=>$("editorDialog").close();$("detailCloseBtn").onclick=()=>$("detailDialog").close();$("searchInput").oninput=renderList;
$("categoryBar").onclick=e=>{const b=e.target.closest("[data-category]");if(!b)return;selectedCategory=b.dataset.category;render()};$("recordList").onclick=e=>{const b=e.target.closest("[data-id]");if(b)openDetail(b.dataset.id)};
$("recordForm").onsubmit=async e=>{e.preventDefault();const id=$("recordId").value;const data={id:id||crypto.randomUUID(),date:$("dateInput").value,category:$("categoryInput").value.trim(),title:$("titleInput").value.trim(),content:$("contentInput").value.trim(),memo:$("memoInput").value.trim()};if(!data.category)return alert("분류를 입력해주세요.");if(!data.title&&!data.content&&!data.memo)return alert("제목, 내용 또는 메모 중 하나는 입력해주세요.");try{if(!sheetUrl)throw new Error("설정에서 Google 계정을 연결해주세요.");if(id)await googleUpdate(data);else await googleCreate(data);records=id?records.map(r=>r.id===id?data:r):[...records,data];saveLocal();$("editorDialog").close();render()}catch(err){alert("저장 실패: "+err.message)}};
$("editBtn").onclick=()=>{const r=records.find(x=>x.id===selectedId);$("detailDialog").close();if(r)openEditor(r)};
$("deleteBtn").onclick=async()=>{const r=records.find(x=>x.id===selectedId);if(!r)return;if(!confirm(`"${r.title||"제목 없음"}" 기록을 삭제할까요?`))return;try{await googleDelete(r.id);records=records.filter(x=>x.id!==selectedId);saveLocal();$("detailDialog").close();render()}catch(err){alert("삭제 실패: "+err.message)}};

async function init(){
  render();
  // 저장된 계정/시트가 있으면 사용자 동작 없이 조용히 토큰을 갱신합니다.
  // 성공하면 최신 Google Sheets 목록을 가져오고, 실패해도 기존 로컬 목록은 그대로 표시합니다.
  const started=Date.now();
  const timer=setInterval(async()=>{
    if(initGoogleClient()){
      clearInterval(timer);
      if(sheetUrl&&validSheetUrl(sheetUrl)){
        try{ await getToken(false); await syncList(); render(); }
        catch(err){ console.log("자동 Google 연결 생략:",err.message); }
      }
    }else if(Date.now()-started>10000){
      clearInterval(timer);
    }
  },100);
}
init();
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(console.error));
