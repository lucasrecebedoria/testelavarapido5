import { 
  auth, db, onAuthStateChanged, signOut, updatePassword, colUsuarios, colRelatorios, colRelatoriosMensais,
  addDoc, setDoc, getDoc, doc, query, where, getDocs, serverTimestamp, deleteDoc
} from './firebase.js';

const ADMINS = new Set(['12','6266','1778']);

// --- Added: UI enhancements & exports ---
function isAdminUser(){ try{ if(window.CURRENT_USER){ return !!(CURRENT_USER.isAdmin || ADMINS.has(CURRENT_USER.matricula)); } }catch(e){} return ADMINS.has(window.currentUserMatricula || ''); }

function setupWeeklyHeaderForAdmin(){
  if(!isAdminUser()) return;
  const thead = document.querySelector('#tabelaSemanal thead tr');
  if(thead && thead.children.length<6){
    const th = document.createElement('th'); th.textContent = 'Ação';
    thead.appendChild(th);
  }
}

// Export helpers
async function exportTableToPDF(tableSelector, filename){
  const el = document.querySelector(tableSelector);
  if(!el) return;
  const { jsPDF } = window.jspdf;
  const canvas = await html2canvas(el);
  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF('p', 'pt', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgWidth = pageWidth - 40;
  const imgHeight = canvas.height * imgWidth / canvas.width;
  pdf.addImage(imgData, 'PNG', 20, 20, imgWidth, imgHeight);
  pdf.save(filename);
}

function exportTableToExcel(tableSelector, filename){
  const el = document.querySelector(tableSelector);
  if(!el) return;
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.table_to_sheet(el);
  XLSX.utils.book_append_sheet(wb, ws, 'Relatorio');
  XLSX.writeFile(wb, filename);
}

// Toggle painel <2
function initMenos2Toggle(){
  const btn = document.getElementById('toggleMenos2');
  const panel = document.getElementById('painelScroll');
  if(btn && panel){
    let open = false;
    const sync = ()=> btn.textContent = open ? '▴' : '▾';
    sync();
    btn.addEventListener('click', ()=>{
      open = !open;
      panel.style.display = open ? '' : 'none';
      sync();
    });
  }
}


function todayIso(){ return new Date().toISOString().slice(0,10); }
function toBR(dateStr){ // dateStr 'yyyy-mm-dd' -> 'dd/mm/yyyy'
  if(!dateStr) return '';
  const parts = dateStr.split('-'); return `${parts[2]}/${parts[1]}/${parts[0]}`;
}
function formatTimeFromTimestamp(ts){
  if(!ts) return '';
  try{
    // ts might be firestore Timestamp object with toDate()
    if(typeof ts.toDate === 'function') ts = ts.toDate();
    const d = new Date(ts);
    return d.toLocaleTimeString('pt-BR',{hour12:false});
  }catch(e){ return ''; }
}
function fullPrefixVal(){ return '55' + (document.getElementById('prefixo').value || '').padStart(3,'0'); }

function prefixBadgeHtml(prefix){
  const n = parseInt(prefix,10);
  let cls='prefix-default', label=prefix;
  if(n>=55001 && n<=55184){ cls='prefix-green-flag'; }
  else if(n>=55185 && n<=55363){ cls='prefix-red'; }
  else if(n>=55364 && n<=55559){ cls='prefix-blue'; }
  else if(n>=55900){ cls='prefix-purple'; }
  return `<span class="prefix-badge ${cls}">${label}</span>`;
}

let CURRENT_USER = null;
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  const snap = await getDoc(doc(colUsuarios, user.uid));
  if(snap.exists()){ CURRENT_USER = snap.data(); }
  else { CURRENT_USER = { matricula: user.email.split('@')[0], isAdmin: ADMINS.has(user.email.split('@')[0]) }; }
  // set date field
  document.getElementById('data').value = todayIso();
  // btn handlers
  document.getElementById('btnLogout').addEventListener('click', ()=> signOut(auth));
  document.getElementById('btnChangePwd').addEventListener('click', changePasswordHandler);
  document.getElementById('washForm').addEventListener('submit', saveWash);
  document.getElementById('filtroPrefixo').addEventListener('input', filterWeekly);
  document.getElementById('filtroMinCount').addEventListener('input', filterWeekly);

  await loadWeekly();
  await loadMonthlyTotals();
});

async function changePasswordHandler(){
  const nova = prompt('Digite a nova senha (mín 6 caracteres):');
  if(!nova) return;
  try{
    await updatePassword(auth.currentUser, nova);
    alert('Senha alterada com sucesso');
  }catch(err){
    alert('Erro ao alterar senha: ' + err.message);
  }
}

async function saveWash(e){
  e.preventDefault();
  const prefixo = fullPrefixVal();
  const tipo = document.getElementById('tipo').value;
  const dataLav = document.getElementById('data').value;
  if(!/^\d{5}$/.test(prefixo)){ alert('Prefixo inválido'); return; }
  const payload = { prefixo, tipo, data: dataLav, created_at: serverTimestamp(), user_matricula: CURRENT_USER?.matricula || 'desconhecido' };
  await addDoc(colRelatorios, payload);
  // also add to monthly aggregation
  const ym = dataLav.slice(0,7);
  await addDoc(colRelatoriosMensais, { ...payload, ym });
  document.getElementById('saveMsg').textContent = 'Salvo!';
  // clear editable fields
  try{ document.getElementById('prefixo').value = ''; }catch(e){}
  try{ document.getElementById('tipo').selectedIndex = 0; }catch(e){}
  try{ document.getElementById('data').value = todayIso(); }catch(e){}
  try{ document.getElementById('filtroPrefixo').value=''; document.getElementById('filtroMinCount').value=''; }catch(e){}
  setTimeout(()=>{ document.getElementById('saveMsg').textContent=''; }, 1500);
  setTimeout(()=> document.getElementById('saveMsg').textContent='',1500);
  await loadWeekly();
  await loadMonthlyTotals();
}

function getWeekBounds(date){
  const d = new Date(date);
  const day = (d.getDay()+6)%7; // 0=Monday
  const monday = new Date(d); monday.setDate(d.getDate()-day);
  const sunday = new Date(monday); sunday.setDate(monday.getDate()+6);
  const toISO = (x)=> x.toISOString().slice(0,10);
  return { from: toISO(monday), to: toISO(sunday) };
}

let lastWeekRows = []; // cache for filtering counts

async function loadWeekly(){
  const tbody = document.querySelector('#tabelaSemanal tbody');
  tbody.innerHTML = '';
  const { from, to } = getWeekBounds(new Date());
  const q1 = query(colRelatorios, where('data','>=',from), where('data','<=',to));
  const snap = await getDocs(q1);
  const rows = [];
  snap.forEach(docsnap=>{
    const d = docsnap.data();
    const created = d.created_at ? (typeof d.created_at.toDate === 'function' ? d.created_at.toDate() : new Date(d.created_at)) : new Date();
    rows.push({ data: d.data, hora: formatTimeFromTimestamp(created), prefixo: d.prefixo, tipo: d.tipo, user: d.user_matricula });
  });
  // sort by date+hora
  rows.sort((a,b)=> (a.data+a.hora).localeCompare(b.data+b.hora));
  lastWeekRows = rows;
  // compute counts per prefix for the week
  const counts = {};
  rows.forEach(r=> counts[r.prefixo] = (counts[r.prefixo]||0)+1);

  for(const r of rows){
    const dateBR = toBR(r.data);
    const prefHTML = prefixBadgeHtml(r.prefixo);
    const tipoHTML = r.tipo === 'Lavagem Simples' ? '<span class="badge badge-yellow">Simples</span>' : (r.tipo==='Higienização'?'<span class="badge badge-lightgreen">Higienização</span>':'<span class="badge badge-pink">Exceções</span>');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${dateBR}</td><td>${r.hora}</td><td>${prefHTML}</td><td>${tipoHTML}</td><td>${r.user}</td>`;
    tbody.appendChild(tr);
  }

  // fill painel <2 (include prefills of 001-559 and 900-1000)
  await fillLessThanTwo(counts);
  filterWeekly(); // apply current filters
}

async function fillLessThanTwo(counts){
  // counts: { prefixo: number }
  const tbody = document.querySelector('#tabelaMenos2 tbody');
  tbody.innerHTML = '';
  // build list: 001..559 and 900..1000 as suffixes -> full prefixed
  const list = [];
  for(let i=1;i<=559;i++){ list.push(('000'+i).slice(-3)); }
  for(let i=900;i<=1000;i++){ list.push(('000'+i).slice(-3)); }
  // unique and sort
  const entries = list.map(s=> '55'+s);
  entries.forEach(px=>{
    const c = counts[px] || 0;
    if(c < 2){
      const prefHTML = prefixBadgeHtml(px);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${prefHTML}</td><td>${c}</td><td>${CURRENT_USER?.isAdmin ? '<button class="metal btn-outline btn-remove">Remover</button>' : '-'}</td>`;
      tbody.appendChild(tr);
    }
  });
  // admin remove action (UI only)
  tbody.querySelectorAll('.btn-remove').forEach(btn=> btn.addEventListener('click', (e)=> e.target.closest('tr').remove()));
}

function filterWeekly(){
  const val = document.getElementById('filtroPrefixo').value.trim();
  const raw = document.getElementById('filtroMinCount').value; const minCount = Number(raw ? raw : 0);
  // compute counts for current week from lastWeekRows
  const counts = {};
  lastWeekRows.forEach(r=> counts[r.prefixo] = (counts[r.prefixo]||0)+1);
  const trs = document.querySelectorAll('#tabelaSemanal tbody tr');
  trs.forEach(tr=>{
    const pxCell = tr.children[2].textContent;
    const px = pxCell.trim();
    const meetsPrefix = !val || px.includes(val);
    const meetsCount = (counts[px]||0) >= minCount;
    tr.style.display = (meetsPrefix && meetsCount) ? '' : 'none';
  });
}

async function loadMonthlyTotals(){
  const ym = new Date().toISOString().slice(0,7);
  const q1 = query(colRelatoriosMensais, where('ym','==', ym));
  const snap = await getDocs(q1);
  let simples=0,hig=0,exc=0;
  snap.forEach(d=>{
    const t = d.data().tipo;
    if(t==='Lavagem Simples') simples++;
    else if(t==='Higienização') hig++;
    else exc++;
  });
  document.getElementById('cntSimples').textContent = simples;
  document.getElementById('cntHig').textContent = hig;
  document.getElementById('cntExc').textContent = exc;
}


// init extras
document.getElementById('btnWeeklyPdf')?.addEventListener('click', ()=> exportTableToPDF('#tabelaSemanal', 'relatorio-semanal.pdf'));
document.getElementById('btnWeeklyExcel')?.addEventListener('click', ()=> exportTableToExcel('#tabelaSemanal', 'relatorio-semanal.xlsx'));
initMenos2Toggle();


// === Added: filter for Menos de 2 ===
document.getElementById('filtroMenos2')?.addEventListener('input', ()=>{
  const val = (document.getElementById('filtroMenos2').value || '').trim();
  const trs = document.querySelectorAll('#tabelaMenos2 tbody tr');
  trs.forEach(tr=>{
    const px = tr.children[0]?.textContent?.trim() || '';
    tr.style.display = (!val || px.includes(val)) ? '' : 'none';
  });
});
