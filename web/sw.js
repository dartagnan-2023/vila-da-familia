// ---------------------------------------------------------------------------
// O carteiro do Pipo.
//
// Este arquivo roda FORA da página — continua vivo com o jogo fechado, com o
// navegador fechado, com o celular no bolso. É a única coisa que alcança a
// pessoa depois que ela saiu. `new Notification()` morre junto com a aba; isto
// não morre.
//
// De propósito ele NÃO intercepta `fetch`: o jogo se atualiza sozinho comparando
// versao.js com versao.json, e um cache aqui dentro quebraria exatamente isso.
// Este service worker só faz uma coisa: receber o recado e mostrar.
// ---------------------------------------------------------------------------

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data?.json() ?? {}; } catch { d = { corpo: e.data?.text() ?? '' }; }
  const titulo = d.titulo || 'Vila Raízes';
  e.waitUntil(self.registration.showNotification(titulo, {
    body: d.corpo || '',
    icon: d.icone || './icone-192.png',
    badge: './icone-192.png',
    tag: d.tag || 'pipo',          // um recado novo substitui o anterior
    renotify: true,
    data: { url: d.url || './index.html' },
  }));
});

// Tocar no aviso tem que cair DENTRO do jogo, não numa aba em branco. Se a
// pessoa já está com o jogo aberto em algum lugar, traz aquela aba pra frente.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const destino = new URL(e.notification.data?.url ?? './index.html', self.location.href).href;
  e.waitUntil((async () => {
    const abas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const aba of abas) {
      if (aba.url.startsWith(self.location.href.replace(/sw\.js$/, ''))) {
        await aba.focus();
        aba.postMessage({ de: 'pipo', url: destino });
        return;
      }
    }
    await self.clients.openWindow(destino);
  })());
});
