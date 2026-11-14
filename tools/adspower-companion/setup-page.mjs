const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))

export function setupPage(token,{configured=false,message='',error=false,port=50325,site,version}={}){
 const form=`<form method="post" action="/setup" autocomplete="off">
  <input type="hidden" name="csrf" value="${escape(token)}">
  <label for="key">Clé API AdsPower</label><input type="password" id="key" name="apiKey" required minlength="8" maxlength="512" autocomplete="off">
  <details><summary>Port de connexion</summary><label for="port">Port indiqué dans AdsPower</label><input type="number" id="port" name="port" value="${escape(port)}" min="1024" max="65535" required></details>
  <button>Vérifier et enregistrer sur ce PC</button>
 </form>`
 return `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
 <title>Connexion AdsPower · Stock Vinted</title>
 <style>body{background:#f4f7f6;color:#173e35;font:16px system-ui;margin:0;padding:32px 16px}main{max-width:600px;margin:5vh auto;background:white;border:1px solid #dde7e2;border-radius:24px;padding:32px}p{line-height:1.6;color:#52675f}label{display:block;margin:20px 0 8px;font-weight:600}input{box-sizing:border-box;width:100%;padding:14px;border:1px solid #bacdc3;border-radius:10px;font:inherit}button,a{display:inline-block;padding:14px 20px;border:0;border-radius:10px;background:#087f6b;color:white;font:600 15px system-ui;text-decoration:none;margin-top:20px}small{display:block;color:#64756d;margin-top:12px}.notice{background:#e9f6ef;padding:15px;border-radius:12px}.error{background:#fff0ef;color:#8f2525}details{margin-top:24px}summary{cursor:pointer;font-weight:600}a.secondary{background:#edf3f0;color:#173e35;margin-left:8px}</style>
 <main><small>STOCK VINTED · CONNECTEUR PC ${escape(version)}</small>
 <h1>${configured?'Ta connexion AdsPower est déjà enregistrée.':'Relier AdsPower à ton assistant'}</h1>
 ${message?`<p role="${error?'alert':'status'}" class="notice${error?' error':''}">${escape(message)}</p>`:''}
 ${configured?`<p>La même connexion sert à l’onglet AdsPower et à l’Assistant PC de Stock Vinted. Tu n’as pas besoin de recopier ta clé.</p>
 <a href="${site}/ylavint#assistant-pc">Ouvrir l’Assistant PC</a><a class="secondary" href="${site}/#adspower">Mes profils AdsPower</a>
 <details${error?' open':''}><summary>Modifier la connexion enregistrée</summary><p>La connexion actuelle est conservée tant que la nouvelle n’a pas été vérifiée.</p>${form}</details>`:
 `<p>Ouvre les réglages API d’AdsPower, puis renseigne ta clé existante et le port indiqué. Cette connexion servira aussi à l’onglet AdsPower du site.</p>${form}`}
 <small>La clé reste protégée sur ce PC et sera retrouvée lors des prochaines mises à jour du connecteur. Cette page ne démarre aucun profil.</small>
 </main></html>`
}
