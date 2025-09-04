import { 
  auth, db, onAuthStateChanged, signOut, updatePassword, colUsuarios, colRelatorios, colRelatoriosMensais,
  addDoc, setDoc, getDoc, doc, query, where, getDocs, serverTimestamp, deleteDoc
} from './firebase.js';

const ADMINS = new Set(['12','6266','1778']);

function isAdminUser(){ 
  try{ 
    if(window.CURRENT_USER){ 
      return !!(CURRENT_USER.isAdmin || ADMINS.has(CURRENT_USER.matricula)); 
    } 
  }catch(e){} 
  return ADMINS.has(window.currentUserMatricula || ''); 
}

function todayIso(){ return new Date().toISOString().slice(0,10); }
function toBR(dateStr){ 
  if(!dateStr) return '';
  const parts = dateStr.split('-'); return `${parts[2]}/${parts[1]}/${parts[0]}`;
}
function formatTimeFromTimestamp(ts){
  if(!ts) return '';
  try{
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
  
  document.getElementById('data').value = todayIso();
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
  const ym = dataLav.slice(0,7);
  await addDoc(colRelatoriosMensais, { ...payload, ym });
  document.getElementById('saveMsg').textContent = 'Salvo!';
  try{ document.getElementById('prefixo').value = ''; }catch(e){}
  try{ document.getElementById('tipo').selectedIndex = 0; }catch(e){}
  try{ document.getElementById('data').value = todayIso(); }catch(e){}
  try{ document.getElementById('filtroPrefixo').value=''; document.getElementById('filtroMinCount').value=''; }catch(e){}
  setTimeout(()=>{ document.getElementById('saveMsg').textContent=''; }, 1500);
  await loadWeekly();
  await loadMonthlyTotals();
}

function getWeekBounds(date){
  const d = new Date(date);
  const day = (d.getDay()+6)%7;
  const monday = new Date(d); monday.setDate(d.getDate()-day);
  const sunday = new Date(monday); sunday.setDate(monday.getDate()+6);
  const toISO = (x)=> x.toISOString().slice(0,10);
  return { from: toISO(monday), to: toISO(sunday) };
}

let lastWeekRows = [];

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
  rows.sort((a,b)=> (a.data+a.hora).localeCompare(b.data+b.hora));
  lastWeekRows = rows;
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

  await fillLessThanTwo(counts);
  filterWeekly();
}

async function fillLessThanTwo(counts){
  const tbody = document.querySelector('#tabelaMenos2 tbody');
  tbody.innerHTML = '';

  const list = [];
  for(let i=1;i<=559;i++){ list.push(('000'+i).slice(-3)); }
  for(let i=900;i<=1000;i++){ list.push(('000'+i).slice(-3)); }
  const entries = list.map(s=> '55'+s);

  entries.forEach(px=>{
    const c = counts[px] || 0;
    if(c < 2){
      const prefHTML = prefixBadgeHtml(px);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${prefHTML}</td>
        <td>${c}</td>
        <td>${CURRENT_USER?.isAdmin 
            ? '<button class="metal btn-outline btn-remove">Remover</button>' 
            : '-'}</td>`;
      tbody.appendChild(tr);
    }
  });

  tbody.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', (e)=> {
      e.target.closest('tr').remove();
    });
  });

  applyFiltroMenos2();
}

function filterWeekly(){
  const val = document.getElementById('filtroPrefixo').value.trim();
  const raw = document.getElementById('filtroMinCount').value; const minCount = Number(raw ? raw : 0);
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

document.getElementById('btnWeeklyPdf')?.addEventListener('click', ()=> exportTableToPDF('#tabelaSemanal', 'relatorio-semanal.pdf'));
document.getElementById('btnWeeklyExcel')?.addEventListener('click', ()=> exportTableToExcel('#tabelaSemanal', 'relatorio-semanal.xlsx'));
initMenos2Toggle();

function applyFiltroMenos2(){
  const val = (document.getElementById('filtroMenos2').value || '').trim();
  const trs = document.querySelectorAll('#tabelaMenos2 tbody tr');
  trs.forEach(tr=>{
    const px = tr.children[0]?.textContent?.trim() || '';
    tr.style.display = (!val || px.includes(val)) ? '' : 'none';
  });
}

document.getElementById('filtroMenos2')?.addEventListener('input', applyFiltroMenos2);

// utilitários de export
async function exportTableToPDF(tableSelector, filename){
  const el = document.querySelector(tableSelector);
  if(!el) return;
  const { jsPDF } = window.jspdf;
  const canvas = await html2canvas(el);
  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF('p', 'pt', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
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
