import { auth, db, colRelatorios, onAuthStateChanged, signOut, addDoc, collection, serverTimestamp, deleteDoc, doc } from './firebase.js';

const tabelaSemanal = document.getElementById('tabelaSemanal').querySelector('tbody');

function renderRow(item, userIsAdmin) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${item.data}</td>
    <td><span class="badge ${getHoraBadge(item.hora)}">${item.hora}</span></td>
    <td>${item.prefixo}</td>
    <td>${item.tipo}</td>
    <td>${item.usuario}</td>
    <td>${userIsAdmin ? '<span class="icon-trash" data-id="'+item.id+'">🗑</span>' : ''}</td>
  `;
  tabelaSemanal.appendChild(tr);
}

function getHoraBadge(hora) {
  if (!hora) return '';
  const h = parseInt(hora.split(':')[0]);
  if (h >= 6 && h < 12) return 'badge-hora-bebe';
  if (h >= 12 && h < 18) return 'badge-hora-laranja';
  if (h >= 18 && h < 24) return 'badge-hora-azulescuro';
  return 'badge-hora-roxo';
}

tabelaSemanal.addEventListener('click', async e => {
  if (e.target.classList.contains('icon-trash')) {
    const id = e.target.getAttribute('data-id');
    if (confirm('Excluir este lançamento?')) {
      await deleteDoc(doc(db, 'relatorios', id));
      e.target.closest('tr').remove();
    }
  }
});
