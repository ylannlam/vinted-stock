const {last} = await chrome.storage.local.get(['last'])
const labels = {ok: 'aucune restriction', restricted: 'compte restreint', blocked: 'compte bloqué', permanent: 'bannissement définitif'}
if (last?.login) document.getElementById('account').textContent = `Compte : ${last.login}`
else document.getElementById('account').textContent = 'Compte : ouvre une page Vinted connectée'
if (last?.at) {
  const [status, until] = String(last.key || '').split('|')
  const state = document.getElementById('state')
  state.textContent = `Dernier relevé : ${labels[status] || '—'}${until ? ` jusqu’au ${until.split('-').reverse().join('/')}` : ''} · ${new Date(last.at).toLocaleString('fr-FR')}`
  state.className = status === 'ok' ? 'ok' : 'bad'
}
if (last?.error) document.getElementById('error').textContent = last.error
