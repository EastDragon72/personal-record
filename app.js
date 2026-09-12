/* 기록장 v12.0 - Supabase edition
 * Supabase project URL과 publishable/anon key를 아래 두 값에 넣어주세요.
 */
const SUPABASE_URL = "https://sxoxtdwipxdxkmmdfskb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_9mDd0oL0hlTtfxN4gXOH-A_S2grqf8K";
const APP_FILE_NAME = "개인 기록장";
const APP_VERSION = "v12.2.0";
const STORAGE_KEY = "personal-records-v2";
const ACCOUNT_NAME_KEY = "personal-record-account-name";
const ACCOUNT_EMAIL_KEY = "personal-record-account-email";

let supabaseClient = null;
let accountName = localStorage.getItem(ACCOUNT_NAME_KEY) || "";
let accountEmail = localStorage.getItem(ACCOUNT_EMAIL_KEY) || "";
let records = loadLocal();
let selectedCategory = "전체";
let selectedId = null;
let currentUser = null;

const $ = id => document.getElementById(id);
function loadLocal(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]")}catch{return[]}}
function saveLocal(){localStorage.setItem(STORAGE_KEY,JSON.stringify(records))}
function today(){const d=new Date(),offset=d.getTimezoneOffset();return new Date(d.getTime()-offset*60000).toISOString().slice(0,10)}
function esc(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function formatDate(v){return v||""}
function cats(){return [...new Set(records.map(r=>r.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ko"))}
function isConfigured(){return !SUPABASE_URL.includes("YOUR-PROJECT") && !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE")}
function initSupabase(){if(!window.supabase?.createClient)return false;if(!supabaseClient&&isConfigured())supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);return !!supabaseClient}

async function getSession(){if(!initSupabase())throw new Error("Supabase 설정이 아직 완료되지 않았습니다.");const {data,error}=await supabaseClient.auth.getSession();if(error)throw error;return data.session}
async function signInGoogle(force=false){if(!initSupabase()){openSettings();throw new Error("Supabase 설정이 필요합니다.")}
  const {error}=await supabaseClient.auth.signInWithOAuth({provider:"google",options:{redirectTo:location.origin+location.pathname,queryParams:{prompt:force?"select_account":"select_account"}}});
  if(error)throw error;
}
async function signOutGoogle(){if(!supabaseClient)return;const {error}=await supabaseClient.auth.signOut();if(error)throw error;currentUser=null;accountName="";accountEmail="";localStorage.removeItem(ACCOUNT_NAME_KEY);localStorage.removeItem(ACCOUNT_EMAIL_KEY);records=loadLocal();render()}

async function loadUser(){const session=await getSession();currentUser=session?.user||null;if(currentUser){accountEmail=currentUser.email||accountEmail;accountName=currentUser.user_metadata?.full_name||currentUser.user_metadata?.name||accountName;localStorage.setItem(ACCOUNT_EMAIL_KEY,accountEmail);localStorage.setItem(ACCOUNT_NAME_KEY,accountName)}return currentUser}

async function supabaseList(){if(!currentUser)await loadUser();if(!currentUser)throw new Error("Google 계정으로 로그인해주세요.");const {data,error}=await supabaseClient.from("notes").select("id,record_date,category,title,content,memo,user_id").order("record_date",{ascending:false}).order("id",{ascending:false});if(error)throw error;return (data||[]).map(r=>({id:r.id,date:r.record_date,category:r.category||"",title:r.title||"",content:r.content||"",memo:r.memo||""}))}
async function supabaseCreate(data){if(!currentUser)await loadUser();const {error}=await supabaseClient.from("notes").insert([{id:data.id,record_date:data.date,category:data.category,title:data.title,content:data.content,memo:data.memo,user_id:currentUser.id}]);if(error)throw error}
async function supabaseUpdate(data){if(!currentUser)await loadUser();const {error}=await supabaseClient.from("notes").update({record_date:data.date,category:data.category,title:data.title,content:data.content,memo:data.memo}).eq("id",data.id).eq("user_id",currentUser.id);if(error)throw error}
async function supabaseDelete(id){if(!currentUser)await loadUser();const {error}=await supabaseClient.from("notes").delete().eq("id",id).eq("user_id",currentUser.id);if(error)throw error}
async function syncList(){if(!initSupabase()||!currentUser)return;records=await supabaseList();saveLocal();render()}

function renderCategories(){const list=["전체",...cats()];$("categoryBar").innerHTML=list.map(c=>`<button class="chip ${c===selectedCategory?"active":""}" data-category="${esc(c)}">${esc(c)}</button>`).join("");$("categoryOptions").innerHTML=cats().map(c=>`<option value="${esc(c)}"></option>`).join("")}
function filtered(){const q=$("searchInput").value.trim().toLowerCase();return records.filter(r=>(selectedCategory==="전체"||r.category===selectedCategory)&&(!q||[r.category,r.title,r.content,r.memo].some(v=>(v||"").toLowerCase().includes(q)))).sort((a,b)=>(b.date||"").localeCompare(a.date||"")||String(b.id).localeCompare(String(a.id)))}
function renderList(){const data=filtered();const header='<div class="record-header" aria-hidden="true"><span>작성일</span><span>분류</span><span>제목</span></div>';const rows=data.map(r=>`<button class="record-card" data-id="${esc(r.id)}"><span class="record-date">${esc(formatDate(r.date))}</span><span class="category">${esc(r.category||"")}</span><span class="record-title">${esc(r.title||"제목 없음")}</span></button>`).join("");$("recordList").innerHTML=data.length?header+rows:"";$("emptyState").hidden=data.length!==0}
function render(){renderCategories();renderList()}
function resetForm(r=null){$("recordId").value=r?.id||"";$("dateInput").value=r?.date||today();$("categoryInput").value=r?.category||(selectedCategory!=="전체"?selectedCategory:"");$("titleInput").value=r?.title||"";$("contentInput").value=r?.content||"";$("memoInput").value=r?.memo||"";$("editorTitle").textContent=r?"기록 수정":"기록 작성"}
function openEditor(r=null){resetForm(r);$("editorDialog").showModal()}
function openDetail(id){selectedId=id;const r=records.find(x=>x.id===id);if(!r)return;$("detailBody").innerHTML=`<div class="detail-meta">${formatDate(r.date)}</div><div class="detail-category">${esc(r.category)}</div><h3>${esc(r.title||"제목 없음")}</h3><div class="detail-section"><div class="detail-content">${esc(r.content||"")}</div></div>${r.memo?`<div class="detail-section"><strong>메모</strong><div class="detail-memo">${esc(r.memo)}</div></div>`:""}`;$("detailDialog").showModal()}
function openSettings(){ $("accountNameInput").value=accountName;$("accountEmailInput").value=accountEmail;$("settingsStatus").textContent=currentUser?"Supabase 연결됨 · "+accountEmail:(isConfigured()?"Google 계정 로그인 필요":"Supabase 설정 필요");$("settingsDialog").showModal() }

$("settingsBtn").onclick=openSettings;
$("settingsCancelBtn").onclick=()=>$("settingsDialog").close();
$("connectGoogleBtn").onclick=async()=>{try{await signInGoogle(true)}catch(err){$("settingsStatus").textContent="로그인 실패: "+err.message}};
$("testBackupBtn").onclick=async()=>{try{if(!currentUser)await loadUser();if(!currentUser){$("settingsStatus").textContent="Google 계정으로 로그인해주세요.";return}const data=await supabaseList();records=data;saveLocal();render();$("settingsStatus").textContent=`연결 성공 · 기록 ${data.length}건`}catch(err){$("settingsStatus").textContent="연결 실패: "+err.message}};
$("settingsForm").onsubmit=e=>{e.preventDefault();accountName=$("accountNameInput").value.trim();localStorage.setItem(ACCOUNT_NAME_KEY,accountName);localStorage.setItem(ACCOUNT_EMAIL_KEY,accountEmail);$("settingsStatus").textContent=currentUser?"저장됨":"저장됨 · Google 로그인 필요";setTimeout(()=>$("settingsDialog").close(),250)};
$("newBtn").onclick=()=>openEditor();$("cancelBtn").onclick=()=>$("editorDialog").close();$("detailCloseBtn").onclick=()=>$("detailDialog").close();$("searchInput").oninput=renderList;
$("categoryBar").onclick=e=>{const b=e.target.closest("[data-category]");if(!b)return;selectedCategory=b.dataset.category;render()};$("recordList").onclick=e=>{const b=e.target.closest("[data-id]");if(b)openDetail(b.dataset.id)};
$("recordForm").onsubmit=async e=>{e.preventDefault();const id=$("recordId").value;const data={id:id||crypto.randomUUID(),date:$("dateInput").value,category:$("categoryInput").value.trim(),title:$("titleInput").value.trim(),content:$("contentInput").value.trim(),memo:$("memoInput").value.trim()};if(!data.category)return alert("분류를 입력해주세요.");if(!data.title&&!data.content&&!data.memo)return alert("제목, 내용 또는 메모 중 하나는 입력해주세요.");try{if(!currentUser)await loadUser();if(!currentUser)throw new Error("설정에서 Google 계정을 연결해주세요.");if(id)await supabaseUpdate(data);else await supabaseCreate(data);records=id?records.map(r=>r.id===id?data:r):[...records,data];saveLocal();$("editorDialog").close();render()}catch(err){alert("저장 실패: "+err.message)}};
$("editBtn").onclick=()=>{const r=records.find(x=>x.id===selectedId);$("detailDialog").close();if(r)openEditor(r)};
$("deleteBtn").onclick=async()=>{const r=records.find(x=>x.id===selectedId);if(!r)return;if(!confirm(`"${r.title||"제목 없음"}" 기록을 삭제할까요?`))return;try{if(!currentUser)await loadUser();if(!currentUser)throw new Error("Google 계정으로 로그인해주세요.");await supabaseDelete(r.id);records=records.filter(x=>x.id!==selectedId);saveLocal();$("detailDialog").close();render()}catch(err){alert("삭제 실패: "+err.message)}};

async function init(){
  render();
  if(!initSupabase())return;
  try{await loadUser();if(currentUser){await syncList();}}catch(err){console.log("Supabase 자동 연결 생략:",err.message)}
  supabaseClient.auth.onAuthStateChange(async(event,session)=>{currentUser=session?.user||null;if(currentUser){accountEmail=currentUser.email||"";accountName=currentUser.user_metadata?.full_name||currentUser.user_metadata?.name||accountName;localStorage.setItem(ACCOUNT_EMAIL_KEY,accountEmail);localStorage.setItem(ACCOUNT_NAME_KEY,accountName);try{await syncList()}catch(e){console.log(e)}}render()});
}
init();
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(console.error));
