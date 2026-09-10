const DEFAULT_API_URL = "https://script.google.com/macros/s/AKfycbzxa18PFnkhZ4iaj6x17ekbOFhMZTkPJH33uZx1wM1ebjWIsA_wuPFNtCJEcZjVjgbxLA/exec";
const API_URL_KEY = "personal-record-api-url";
const ACCOUNT_LABEL_KEY = "personal-record-account-label";
const GOOGLE_CLIENT_ID_KEY = "personal-record-google-client-id";
const GOOGLE_SHEET_ID_KEY = "personal-record-google-sheet-id";
const GOOGLE_SHEET_NAME_KEY = "personal-record-google-sheet-name";
const GOOGLE_ACCOUNT_EMAIL_KEY = "personal-record-google-account-email";
let API_URL = localStorage.getItem(API_URL_KEY) || DEFAULT_API_URL;
let accountLabel = localStorage.getItem(ACCOUNT_LABEL_KEY) || "";
let GOOGLE_CLIENT_ID = localStorage.getItem(GOOGLE_CLIENT_ID_KEY) || "";
let GOOGLE_SHEET_ID = localStorage.getItem(GOOGLE_SHEET_ID_KEY) || "";
let GOOGLE_SHEET_NAME = localStorage.getItem(GOOGLE_SHEET_NAME_KEY) || "";
let GOOGLE_ACCOUNT_EMAIL = localStorage.getItem(GOOGLE_ACCOUNT_EMAIL_KEY) || "";
let googleToken = null;
const STORAGE_KEY = "personal-records-v2";
let records = loadLocal();
let selectedCategory = "전체";
let selectedId = null;
let usingApi = !!API_URL;
const $ = id => document.getElementById(id);
function loadLocal(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]")}catch{return[]}}
function saveLocal(){localStorage.setItem(STORAGE_KEY,JSON.stringify(records))}
function today(){const d=new Date(),offset=d.getTimezoneOffset();return new Date(d.getTime()-offset*60000).toISOString().slice(0,10)}
function esc(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function formatDate(v){return v||""}
function cats(){return [...new Set(records.map(r=>r.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ko"))}
function isGoogleMode(){return !!(GOOGLE_CLIENT_ID&&GOOGLE_SHEET_ID)}

async function api(action,data={}){
  if(!API_URL)return null;
  const payload={...data,action};
  if(action==="create"||action==="update"||action==="delete"){
    await fetch(API_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(payload),cache:"no-store",keepalive:true});
    return {success:true};
  }
  const res=await fetch(API_URL+"?action=list&_="+Date.now(),{method:"GET",cache:"no-store",redirect:"follow"});
  if(!res.ok)throw new Error("Google Sheets 서버 응답 오류 ("+res.status+")");
  const out=await res.json(); if(!out.success)throw new Error(out.message||"서버 오류"); return out;
}

async function getGoogleToken(interactive=false){
  if(!GOOGLE_CLIENT_ID)throw new Error("Google OAuth 클라이언트 ID를 먼저 입력해주세요.");
  if(!window.google?.accounts?.oauth2)throw new Error("Google 로그인 모듈을 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
  return new Promise((resolve,reject)=>{
    const client=google.accounts.oauth2.initTokenClient({client_id:GOOGLE_CLIENT_ID,scope:"openid email profile https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets",callback:(resp)=>{if(resp.error){reject(new Error(resp.error_description||resp.error));return}googleToken=resp.access_token;resolve(googleToken)}});
    client.requestAccessToken({prompt:interactive?"select_account":"none"});
  });
}
async function googleFetch(url,opts={}){const token=await getGoogleToken(false).catch(async()=>await getGoogleToken(true));return fetch(url,{...opts,headers:{...(opts.headers||{}),Authorization:"Bearer "+token}})}
async function googleUserInfo(){const res=await googleFetch("https://www.googleapis.com/oauth2/v3/userinfo");if(!res.ok)throw new Error("Google 계정 정보를 가져오지 못했습니다.");return res.json()}
async function listGoogleSheets(){
  const q=encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
  const url="https://www.googleapis.com/drive/v3/files?q="+q+"&pageSize=100&orderBy=modifiedTime%20desc&fields=files(id,name,modifiedTime)";
  const res=await googleFetch(url); if(!res.ok)throw new Error("Google Sheets 목록을 가져오지 못했습니다."); return (await res.json()).files||[];
}
async function getSpreadsheetMeta(){
  const res=await googleFetch("https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(GOOGLE_SHEET_ID)+"?fields=sheets(properties(sheetId,title))");
  if(!res.ok)throw new Error("선택한 Google Sheet에 접근할 수 없습니다."); return res.json();
}
async function ensureRecordSheet(){
  const meta=await getSpreadsheetMeta();
  let sh=(meta.sheets||[]).find(s=>s.properties.title==="기록");
  if(!sh){
    const r=await googleFetch("https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(GOOGLE_SHEET_ID)+":batchUpdate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({requests:[{addSheet:{properties:{title:"기록"}}}]})});
    if(!r.ok)throw new Error("기록 시트를 만들 수 없습니다.");
    const d=await r.json(); sh=d.replies[0].addSheet;
  }
  const valuesRes=await googleFetch("https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(GOOGLE_SHEET_ID)+"/values/"+encodeURIComponent("기록!A1:F1"));
  const values=(await valuesRes.json()).values||[];
  if(!values.length||values[0].join("|")!=="id|date|category|title|content|memo"){
    const r=await googleFetch("https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(GOOGLE_SHEET_ID)+"/values/"+encodeURIComponent("기록!A1:F1")+"?valueInputOption=RAW",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({range:"기록!A1:F1",majorDimension:"ROWS",values:[["id","date","category","title","content","memo"]]})});
    if(!r.ok)throw new Error("기록 시트의 헤더를 설정하지 못했습니다.");
  }
  return sh.properties.sheetId;
}
async function googleList(){
  await ensureRecordSheet();
  const res=await googleFetch("https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(GOOGLE_SHEET_ID)+"/values/"+encodeURIComponent("기록!A2:F"));
  if(!res.ok)throw new Error("Google Sheet 기록을 읽지 못했습니다.");
  const rows=(await res.json()).values||[];
  return rows.filter(r=>r.some(v=>v!=="")).map(r=>({id:String(r[0]||""),date:String(r[1]||"").slice(0,10),category:String(r[2]||""),title:String(r[3]||""),content:String(r[4]||""),memo:String(r[5]||"")}));
}
async function googleCreate(d){
  await ensureRecordSheet();
  const r=await googleFetch("https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(GOOGLE_SHEET_ID)+"/values/"+encodeURIComponent("기록!A:F")+":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({values:[[d.id,d.date,d.category,d.title,d.content,d.memo]]})});
  if(!r.ok)throw new Error("Google Sheet 저장에 실패했습니다.");
}
async function googleUpdate(d){
  const rows=await googleList(), idx=rows.findIndex(r=>r.id===d.id); if(idx<0)throw new Error("수정할 기록을 찾지 못했습니다.");
  const row=idx+2;
  const r=await googleFetch("https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(GOOGLE_SHEET_ID)+"/values/"+encodeURIComponent("기록!A"+row+":F"+row)+"?valueInputOption=RAW",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({range:"기록!A"+row+":F"+row,majorDimension:"ROWS",values:[[d.id,d.date,d.category,d.title,d.content,d.memo]]})});
  if(!r.ok)throw new Error("Google Sheet 수정에 실패했습니다.");
}
async function googleDelete(id){
  const rows=await googleList(), idx=rows.findIndex(r=>r.id===id); if(idx<0)throw new Error("삭제할 기록을 찾지 못했습니다.");
  const meta=await getSpreadsheetMeta(); const sh=(meta.sheets||[]).find(s=>s.properties.title==="기록"); const row=idx+1;
  const r=await googleFetch("https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(GOOGLE_SHEET_ID)+":batchUpdate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({requests:[{deleteDimension:{range:{sheetId:sh.properties.sheetId,dimension:"ROWS",startIndex:row,endIndex:row+1}}}]})});
  if(!r.ok)throw new Error("Google Sheet 삭제에 실패했습니다.");
}
async function syncList(){
  if(isGoogleMode()){records=await googleList();saveLocal();return}
  if(!API_URL)return; const out=await api("list");records=out.data||[];saveLocal();
}
function renderCategories(){const list=["전체",...cats()];$("categoryBar").innerHTML=list.map(c=>`<button class="chip ${c===selectedCategory?"active":""}" data-category="${esc(c)}">${esc(c)}</button>`).join("");$("categoryOptions").innerHTML=cats().map(c=>`<option value="${esc(c)}"></option>`).join("")}
function filtered(){const q=$("searchInput").value.trim().toLowerCase();return records.filter(r=>(selectedCategory==="전체"||r.category===selectedCategory)&&(!q||[r.category,r.title,r.content,r.memo].some(v=>(v||"").toLowerCase().includes(q)))).sort((a,b)=>(b.date||"").localeCompare(a.date||"")||String(b.id).localeCompare(String(a.id)))}
function renderList(){const data=filtered();const header='<div class="record-header" aria-hidden="true"><span>작성일</span><span>분류</span><span>제목</span></div>';const rows=data.map(r=>`<button class="record-card" data-id="${esc(r.id)}"><span class="record-date">${esc(formatDate(r.date))}</span><span class="category">${esc(r.category||"")}</span><span class="record-title">${esc(r.title||"제목 없음")}</span></button>`).join("");$("recordList").innerHTML=data.length?header+rows:"";$("emptyState").hidden=data.length!==0}
function render(){renderCategories();renderList()}
function resetForm(r=null){$("recordId").value=r?.id||"";$("dateInput").value=r?.date||today();$("categoryInput").value=r?.category||(selectedCategory!=="전체"?selectedCategory:"");$("titleInput").value=r?.title||"";$("contentInput").value=r?.content||"";$("memoInput").value=r?.memo||"";$("editorTitle").textContent=r?"기록 수정":"기록 작성"}
function openEditor(r=null){resetForm(r);$("editorDialog").showModal()}
async function openDetail(id){selectedId=id;const r=records.find(x=>x.id===id);if(!r)return;$("detailBody").innerHTML=`<div class="detail-meta">${formatDate(r.date)}</div><div class="detail-category">${esc(r.category)}</div><h3>${esc(r.title||"제목 없음")}</h3><div class="detail-section"><div class="detail-content">${esc(r.content||"")}</div></div>${r.memo?`<div class="detail-section"><strong>메모</strong><div class="detail-memo">${esc(r.memo)}</div></div>`:""}`;$("detailDialog").showModal()}

function fillSheetOptions(files){const sel=$("sheetSelect");sel.innerHTML='<option value="">백업할 Google Sheet를 선택하세요</option>'+files.map(f=>`<option value="${esc(f.id)}">${esc(f.name)}</option>`).join("");if(GOOGLE_SHEET_ID)sel.value=GOOGLE_SHEET_ID}
async function connectGoogle(interactive=true){
  GOOGLE_CLIENT_ID=$("googleClientIdInput").value.trim();
  if(!GOOGLE_CLIENT_ID){$("settingsStatus").textContent="Google OAuth 클라이언트 ID를 입력해주세요.";return}
  localStorage.setItem(GOOGLE_CLIENT_ID_KEY,GOOGLE_CLIENT_ID);
  $("settingsStatus").textContent="Google 계정을 선택하는 중...";
  try{await getGoogleToken(interactive);const info=await googleUserInfo();GOOGLE_ACCOUNT_EMAIL=info.email||"";localStorage.setItem(GOOGLE_ACCOUNT_EMAIL_KEY,GOOGLE_ACCOUNT_EMAIL);const files=await listGoogleSheets();fillSheetOptions(files);$("googleAccountInfo").textContent=GOOGLE_ACCOUNT_EMAIL?`연결됨: ${GOOGLE_ACCOUNT_EMAIL}`:"Google 계정 연결됨";$("settingsStatus").textContent=`Google Sheets ${files.length}개를 불러왔습니다.`}
  catch(e){$("settingsStatus").textContent="Google 계정 연결 실패: "+e.message}
}
function openSettings(){$("apiUrlInput").value=API_URL||"";$("accountLabelInput").value=accountLabel;$("googleClientIdInput").value=GOOGLE_CLIENT_ID;$("googleAccountInfo").textContent=GOOGLE_ACCOUNT_EMAIL?`연결됨: ${GOOGLE_ACCOUNT_EMAIL}`:"";$("sheetSelect").innerHTML=GOOGLE_SHEET_ID?`<option value="${esc(GOOGLE_SHEET_ID)}">${esc(GOOGLE_SHEET_NAME||"현재 선택한 Sheet")}</option>`:'<option value="">먼저 Google 계정을 선택하세요</option>';$("settingsStatus").textContent=isGoogleMode()?`현재 백업: ${GOOGLE_ACCOUNT_EMAIL||"Google 계정"} · ${GOOGLE_SHEET_NAME||"선택된 Sheet"}`:(API_URL?`현재 백업: ${accountLabel||"기존 Apps Script"}`:"백업 연결 안 됨");$("settingsDialog").showModal()}

$("settingsBtn").onclick=openSettings;
$("settingsCancelBtn").onclick=()=>$("settingsDialog").close();
$("googleConnectBtn").onclick=()=>connectGoogle(true);
$("refreshSheetsBtn").onclick=()=>connectGoogle(false);
$("sheetSelect").onchange=async()=>{const id=$("sheetSelect").value;if(!id)return;const name=$("sheetSelect").selectedOptions[0].textContent;try{GOOGLE_SHEET_ID=id;GOOGLE_SHEET_NAME=name;localStorage.setItem(GOOGLE_SHEET_ID_KEY,id);localStorage.setItem(GOOGLE_SHEET_NAME_KEY,name);await syncList();render();$("settingsStatus").textContent=`선택 완료 · ${name} · ${records.length}건`;}catch(e){$("settingsStatus").textContent="Sheet 연결 실패: "+e.message}}
$("testBackupBtn").onclick=async()=>{const url=$("apiUrlInput").value.trim();if(!url){$("settingsStatus").textContent="백업 연결 주소를 입력해주세요.";return}$("settingsStatus").textContent="연결 확인 중...";try{const res=await fetch(url+"?action=list&_="+Date.now(),{cache:"no-store"});const out=await res.json();if(!out.success)throw new Error(out.message||"서버 오류");$("settingsStatus").textContent=`연결 성공 · 백업 기록 ${out.data?.length||0}건`}catch(err){$("settingsStatus").textContent="연결 실패: "+err.message}};
$("settingsForm").onsubmit=async e=>{e.preventDefault();const url=$("apiUrlInput").value.trim().replace(/\/$/,"");const label=$("accountLabelInput").value.trim();if(url&&!/^https:\/\/script\.google\.com\/macros\/s\/[^\s]+\/exec$/.test(url)){alert("Apps Script 웹 앱의 /exec 주소를 입력해주세요.");return}if($("sheetSelect").value){GOOGLE_SHEET_ID=$("sheetSelect").value;GOOGLE_SHEET_NAME=$("sheetSelect").selectedOptions[0].textContent;localStorage.setItem(GOOGLE_SHEET_ID_KEY,GOOGLE_SHEET_ID);localStorage.setItem(GOOGLE_SHEET_NAME_KEY,GOOGLE_SHEET_NAME)}accountLabel=label;localStorage.setItem(ACCOUNT_LABEL_KEY,accountLabel);if(!GOOGLE_SHEET_ID){API_URL=url;localStorage.setItem(API_URL_KEY,API_URL);usingApi=!!API_URL}$("settingsDialog").close();try{await syncList();render();}catch(err){alert("백업 연결 실패: "+err.message)}};
$("newBtn").onclick=()=>openEditor();$("cancelBtn").onclick=()=>$("editorDialog").close();$("detailCloseBtn").onclick=()=>$("detailDialog").close();$("searchInput").oninput=renderList;
$("categoryBar").onclick=e=>{const b=e.target.closest("[data-category]");if(!b)return;selectedCategory=b.dataset.category;render()};$("recordList").onclick=e=>{const b=e.target.closest("[data-id]");if(b)openDetail(b.dataset.id)};
$("recordForm").onsubmit=async e=>{e.preventDefault();const id=$("recordId").value;const data={id:id||crypto.randomUUID(),date:$("dateInput").value,category:$("categoryInput").value.trim(),title:$("titleInput").value.trim(),content:$("contentInput").value.trim(),memo:$("memoInput").value.trim()};if(!data.category)return alert("분류를 입력해주세요.");if(!data.title&&!data.content&&!data.memo)return alert("제목, 내용 또는 메모 중 하나는 입력해주세요.");try{if(isGoogleMode()){if(id)await googleUpdate(data);else await googleCreate(data)}else if(usingApi){await api(id?"update":"create",data)}if(id)records=records.map(r=>r.id===id?data:r);else records.push(data);saveLocal();$("editorDialog").close();render()}catch(err){alert("저장 실패: "+err.message)}};
$("editBtn").onclick=()=>{const r=records.find(x=>x.id===selectedId);$("detailDialog").close();if(r)openEditor(r)};
$("deleteBtn").onclick=async()=>{const r=records.find(x=>x.id===selectedId);if(!r)return;if(!confirm(`"${r.title||"제목 없음"}" 기록을 삭제할까요?`))return;try{if(isGoogleMode())await googleDelete(r.id);else if(usingApi)await api("delete",{id:r.id});records=records.filter(x=>x.id!==selectedId);saveLocal();$("detailDialog").close();render()}catch(err){alert("삭제 실패: "+err.message)}};
async function init(){try{if(isGoogleMode()){await syncList()}else if(API_URL){await syncList()}}catch(err){alert("Google Sheets 연결 실패. 설정에서 백업 대상을 확인해주세요.")}render()}
init();
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(console.error));
