import { 
  auth, db, onAuthStateChanged, signOut, updatePassword, colUsuarios, colRelatorios, colRelatoriosMensais,
  addDoc, setDoc, getDoc, doc, query, where, getDocs, serverTimestamp, deleteDoc
} from './firebase.js';

const ADMINS = new Set(['12','6266','1778']);

function isAdminUser(){ 
  try{ if(window.CURRENT_USER){ return !!(CURRENT_USER.isAdmin || ADMINS.has(CURRENT_USER.matricula)); } }
  catch(e){} 
  return ADMINS.has(window.currentUserMatricula || ''); 
}

function todayIso(){ return new Date().toISOString().slice(0,10); }
function toBR(dateStr){ if(!dateStr) return ''; const parts = dateStr.split('-'); return `${parts[2]}/${parts[1]}/${parts[0]}`; }

function formatTimeFromTimestamp(ts){
  if(!ts) return '';
  try{
    if(typeof ts.toDate === 'function') ts = ts.toDate();
    const d = new Date(ts);
    return d.toLocaleTimeString('pt-BR',{hour12:false});
  }catch(e){ return ''; }
}

function horaBadge(horaStr){
  if(!horaStr) return '';
  const [h] = horaStr.split(':').map(x=>parseInt(x));
  if(h>=6 && h<12) return `<span class="badge badge-babyblue">${horaStr}</span>`;
  if(h>=12 && h<18) return `<span class="badge badge-lightorange">${horaStr}</span>`;
  if(h>=18 && h<=23) return `<span class="badge badge-darkblue">${horaStr}</span>`;
  return `<span class="badge badge-purple">${horaStr}</span>`;
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
  try{ await updatePassword(auth.currentUser, nova); alert('Senha alterada com sucesso'); }
  catch(err){ alert('Erro ao alterar senha: ' + err.message); }
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
  document.getElementById('prefixo').value = '';
  document.getElementById('tipo').selectedIndex = 0;
  document.getElementById('data').value = todayIso();
  setTimeout(()=>{ document.getElementById('saveMsg').textContent=''; },1500);
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
    rows.push({ id: docsnap.id, data: d.data, created: d.created_at, prefixo: d.prefixo, tipo: d.tipo, user: d.user_matricula });
  });
  rows.sort((a,b)=> (a.data+formatTimeFromTimestamp(a.created)).localeCompare(b.data+formatTimeFromTimestamp(b.created)));
  lastWeekRows = rows;

  for(const r of rows){
    const dateBR = toBR(r.data);
    const horaStr = formatTimeFromTimestamp(r.created);
    const horaHTML = horaBadge(horaStr);
    const prefHTML = prefixBadgeHtml(r.prefixo);
    const tipoHTML = r.tipo === 'Lavagem Simples' ? '<span class="badge badge-yellow">Simples</span>' : (r.tipo==='Higienização'?'<span class="badge badge-lightgreen">Higienização</span>':'<span class="badge badge-pink">Exceções</span>');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${dateBR}</td><td>${horaHTML}</td><td>${prefHTML}</td><td>${tipoHTML}</td><td>${r.user}</td>`;
    if(isAdminUser()){
      const td = document.createElement('td');
      td.innerHTML = `<button class="trash-btn" data-id="${r.id}">🗑</button>`;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll('.trash-btn').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      const id = e.target.dataset.id;
      if(confirm('Excluir este lançamento?')){
        await deleteDoc(doc(colRelatorios, id));
        loadWeekly();
      }
    });
  });
  filterWeekly();
}

function filterWeekly(){
  const val = document.getElementById('filtroPrefixo').value.trim();
  const minCount = Number(document.getElementById('filtroMinCount').value||0);
  const counts = {};
  lastWeekRows.forEach(r=> counts[r.prefixo]=(counts[r.prefixo]||0)+1);
  document.querySelectorAll('#tabelaSemanal tbody tr').forEach(tr=>{
    const px = tr.children[2].textContent.trim();
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
