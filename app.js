const DEFAULT_API_URL = "https://script.google.com/macros/s/AKfycbzxa18PFnkhZ4iaj6x17ekbOFhMZTkPJH33uZx1wM1ebjWIsA_wuPFNtCJEcZjVjgbxLA/exec";
const API_URL_KEY = "personal-record-api-url";
const ACCOUNT_NAME_KEY = "personal-record-account-name";
const ACCOUNT_EMAIL_KEY = "personal-record-account-email";
const SHEET_URL_KEY = "personal-record-sheet-url";
const APP_FILE_NAME = "개인 기록장";
const APP_VERSION = "v10.0.0";
let API_URL = localStorage.getItem(API_URL_KEY) || DEFAULT_API_URL;
let accountName = localStorage.getItem(ACCOUNT_NAME_KEY) || "";
let accountEmail = localStorage.getItem(ACCOUNT_EMAIL_KEY) || "";
let sheetUrl = localStorage.getItem(SHEET_URL_KEY) || "";
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
async function syncList(){
  if(!API_URL)return;
  const out=await api("list");
  records=out.data||[];
  saveLocal();
}
function renderCategories(){const list=["전체",...cats()];$("categoryBar").innerHTML=list.map(c=>`<button class="chip ${c===selectedCategory?"active":""}" data-category="${esc(c)}">${esc(c)}</button>`).join("");$("categoryOptions").innerHTML=cats().map(c=>`<option value="${esc(c)}"></option>`).join("")}
function filtered(){const q=$("searchInput").value.trim().toLowerCase();return records.filter(r=>(selectedCategory==="전체"||r.category===selectedCategory)&&(!q||[r.category,r.title,r.content,r.memo].some(v=>(v||"").toLowerCase().includes(q)))).sort((a,b)=>(b.date||"").localeCompare(a.date||"")||String(b.id).localeCompare(String(a.id)))}
function renderList(){const data=filtered();const header='<div class="record-header" aria-hidden="true"><span>작성일</span><span>분류</span><span>제목</span></div>';const rows=data.map(r=>`<button class="record-card" data-id="${esc(r.id)}"><span class="record-date">${esc(formatDate(r.date))}</span><span class="category">${esc(r.category||"")}</span><span class="record-title">${esc(r.title||"제목 없음")}</span></button>`).join("");$("recordList").innerHTML=data.length?header+rows:"";$("emptyState").hidden=data.length!==0}
function render(){renderCategories();renderList()}
function resetForm(r=null){$("recordId").value=r?.id||"";$("dateInput").value=r?.date||today();$("categoryInput").value=r?.category||(selectedCategory!=="전체"?selectedCategory:"");$("titleInput").value=r?.title||"";$("contentInput").value=r?.content||"";$("memoInput").value=r?.memo||"";$("editorTitle").textContent=r?"기록 수정":"기록 작성"}
function openEditor(r=null){resetForm(r);$("editorDialog").showModal()}
function openDetail(id){selectedId=id;const r=records.find(x=>x.id===id);if(!r)return;$("detailBody").innerHTML=`<div class="detail-meta">${formatDate(r.date)}</div><div class="detail-category">${esc(r.category)}</div><h3>${esc(r.title||"제목 없음")}</h3><div class="detail-section"><div class="detail-content">${esc(r.content||"")}</div></div>${r.memo?`<div class="detail-section"><strong>메모</strong><div class="detail-memo">${esc(r.memo)}</div></div>`:""}`;$("detailDialog").showModal()}
function validSheetUrl(url){return !url||/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[^\s/]+(?:\/[^\s]*)?$/.test(url)}
function openSettings(){
  $("accountNameInput").value=accountName;
  $("accountEmailInput").value=accountEmail;
  $("sheetUrlInput").value=sheetUrl;
  $("settingsStatus").textContent=API_URL?`현재 연결: ${accountName||accountEmail||"Google 계정"}`:"백업 연결 안 됨";
  $("settingsDialog").showModal();
}
$("settingsBtn").onclick=openSettings;
$("settingsCancelBtn").onclick=()=>$ ("settingsDialog").close();
$("testBackupBtn").onclick=async()=>{
  const url=$("sheetUrlInput").value.trim();
  if(!validSheetUrl(url)){$("settingsStatus").textContent="Google Sheets URL을 확인해주세요.";return}
  $("settingsStatus").textContent="연결 확인 중...";
  try{const out=await api("list");$("settingsStatus").textContent=`연결 성공 · 기록 ${out.data?.length||0}건`}
  catch(err){$("settingsStatus").textContent="연결 실패: "+err.message}
};
$("settingsForm").onsubmit=async e=>{
  e.preventDefault();
  const name=$("accountNameInput").value.trim();
  const email=$("accountEmailInput").value.trim();
  const url=$("sheetUrlInput").value.trim().replace(/\s+/g,"");
  if(!validSheetUrl(url)){alert("Google Sheets URL을 확인해주세요.");return}
  accountName=name;accountEmail=email;sheetUrl=url;
  localStorage.setItem(ACCOUNT_NAME_KEY,accountName);
  localStorage.setItem(ACCOUNT_EMAIL_KEY,accountEmail);
  localStorage.setItem(SHEET_URL_KEY,sheetUrl);
  $("settingsDialog").close();
  try{await syncList();render()}catch(err){alert("Google Sheets 연결 실패. 설정을 확인해주세요.")}
};
$("newBtn").onclick=()=>openEditor();$("cancelBtn").onclick=()=>$ ("editorDialog").close();$("detailCloseBtn").onclick=()=>$ ("detailDialog").close();$("searchInput").oninput=renderList;
$("categoryBar").onclick=e=>{const b=e.target.closest("[data-category]");if(!b)return;selectedCategory=b.dataset.category;render()};$("recordList").onclick=e=>{const b=e.target.closest("[data-id]");if(b)openDetail(b.dataset.id)};
$("recordForm").onsubmit=async e=>{e.preventDefault();const id=$("recordId").value;const data={id:id||crypto.randomUUID(),date:$("dateInput").value,category:$("categoryInput").value.trim(),title:$("titleInput").value.trim(),content:$("contentInput").value.trim(),memo:$("memoInput").value.trim()};if(!data.category)return alert("분류를 입력해주세요.");if(!data.title&&!data.content&&!data.memo)return alert("제목, 내용 또는 메모 중 하나는 입력해주세요.");try{if(usingApi){await api(id?"update":"create",data)}if(id)records=records.map(r=>r.id===id?data:r);else records.push(data);saveLocal();$("editorDialog").close();render()}catch(err){alert("저장 실패: "+err.message)}};
$("editBtn").onclick=()=>{const r=records.find(x=>x.id===selectedId);$("detailDialog").close();if(r)openEditor(r)};
$("deleteBtn").onclick=async()=>{const r=records.find(x=>x.id===selectedId);if(!r)return;if(!confirm(`"${r.title||"제목 없음"}" 기록을 삭제할까요?`))return;try{if(usingApi)await api("delete",{id:r.id});records=records.filter(x=>x.id!==selectedId);saveLocal();$("detailDialog").close();render()}catch(err){alert("삭제 실패: "+err.message)}};
async function init(){try{if(API_URL)await syncList()}catch(err){alert("Google Sheets 연결 실패. 설정을 확인해주세요.")}render()}
init();
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(console.error));
