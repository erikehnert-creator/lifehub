/**
 * Baut LifeHub zu EINER einzelnen HTML-Datei zusammen.
 *
 * Warum: Beim Öffnen per Doppelklick läuft die Seite unter `file://`.
 * Dort blockiert Firefox ES-Module (CORS) und der Browser darf keine
 * Nebendateien nachladen – das Ergebnis wäre ein weißer Bildschirm.
 * Deshalb hier:
 *   - ein klassisches Script-Bündel statt ES-Modulen
 *   - CSS eingebettet
 *   - die SQLite-WASM-Datei als Base64 eingebettet
 *
 * Aufruf:  node scripts/build-single.mjs
 * Ergebnis: LifeHub.html
 */
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = path.join(root, '.single')

console.log('Bündel wird gebaut …')
await build({
  root,
  configFile: false,
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.join(root, 'src'),
      // In der Einzeldatei wird die reine JavaScript-Fassung von SQLite
      // eingebunden statt der WebAssembly-Fassung. Grund: eingeschränkte
      // Browser-Umgebungen auf dem Smartphone (Dateivorschau, In-App-Browser)
      // erlauben WebAssembly teilweise nicht – dort bliebe die App hängen.
      'sql.js': path.join(root, 'node_modules/sql.js/dist/sql-asm.js'),
    },
  },
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2019',
    cssCodeSplit: false,
    minify: 'esbuild',
    lib: {
      entry: path.join(root, 'src/main.tsx'),
      name: 'LifeHub',
      formats: ['iife'],
      fileName: () => 'lifehub.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  logLevel: 'warn',
})

const js = readFileSync(path.join(outDir, 'lifehub.js'), 'utf8')

// Vite benennt die Stildatei im Bibliotheksmodus je nach Version unterschiedlich.
// Deshalb suchen wir sie, statt einen Namen zu raten – ein stilloses Ergebnis
// wäre sonst nicht sofort erkennbar.
const cssFile = readdirSync(outDir).find((f) => f.endsWith('.css'))
if (!cssFile) throw new Error('Keine CSS-Datei im Build gefunden – die Einzeldatei wäre ohne Design.')
const css = readFileSync(path.join(outDir, cssFile), 'utf8')
if (css.length < 5000) throw new Error(`CSS wirkt unvollständig (${css.length} Zeichen).`)
const icon = readFileSync(path.join(root, 'public/icon-192.png')).toString('base64')
const manifest = JSON.parse(readFileSync(path.join(root, 'public/manifest.webmanifest'), 'utf8'))
manifest.icons = [{ src: `data:image/png;base64,${icon}`, sizes: '192x192', type: 'image/png', purpose: 'any maskable' }]
manifest.start_url = '.'
manifest.scope = '.'

const html = `<!doctype html>
<html lang="de" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no">
<meta name="theme-color" content="#f9f9f7">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="LifeHub">
<link rel="icon" href="data:image/png;base64,${icon}">
<link rel="apple-touch-icon" href="data:image/png;base64,${icon}">
<link rel="manifest" href='data:application/manifest+json,${encodeURIComponent(JSON.stringify(manifest))}'>
<title>LifeHub</title>
<style>
${css}
/* Anzeige, solange das Bündel noch startet */
#boot { position: fixed; inset: 0; display: grid; place-items: center;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #52514e; background: #f9f9f7; }
#boot .m { width: 44px; height: 44px; border-radius: 14px; margin: 0 auto 14px;
  background: linear-gradient(135deg,#2a78d6,#4a3aa7); }
</style>
</head>
<body>
<div id="root"></div>
<div id="boot"><div style="text-align:center"><div class="m"></div><div>LifeHub wird geladen …</div></div></div>
<script>
  // Fehler werden festgehalten, damit die Startanzeige sie zeigen kann,
  // statt endlos "wird geladen" anzuzeigen.
  window.__lifehubError = null;
  window.addEventListener('error', function (e) {
    window.__lifehubError = (e && e.message) || 'Unbekannter Fehler';
  });
  window.addEventListener('unhandledrejection', function (e) {
    window.__lifehubError = (e && e.reason && (e.reason.message || String(e.reason))) || 'Unbekannter Fehler';
  });
</script>
<script>
${js}
</script>
<script>
  (function () {
    var started = Date.now();
    var t = setInterval(function () {
      if (document.querySelector('#root > *')) {
        var b = document.getElementById('boot'); if (b) b.remove();
        clearInterval(t);
        return;
      }
      if (Date.now() - started > 12000) {
        clearInterval(t);
        showDiagnose();
      }
    }, 150);

    function check(name, fn) {
      try { return { name: name, ok: !!fn() } } catch (e) { return { name: name, ok: false } }
    }

    function showDiagnose() {
      var b = document.getElementById('boot');
      if (!b || document.querySelector('#root > *')) return;
      var tests = [
        check('JavaScript', function () { return true }),
        check('Lokaler Speicher', function () { localStorage.setItem('lh.t', '1'); localStorage.removeItem('lh.t'); return true }),
        check('Datenbank (IndexedDB)', function () { return typeof indexedDB !== 'undefined' }),
        check('WebAssembly', function () { return typeof WebAssembly !== 'undefined' })
      ];
      var lines = tests.map(function (t) {
        return '<div style="display:flex;gap:8px;align-items:center;margin:2px 0">' +
          '<span style="color:' + (t.ok ? '#0ca30c' : '#d03b3b') + ';font-weight:700">' +
          (t.ok ? '\u2713' : '\u2717') + '</span><span>' + t.name + '</span></div>';
      }).join('');
      var err = window.__lifehubError
        ? '<div style="margin-top:10px;padding:8px 10px;background:rgba(208,59,59,.10);border-radius:8px;' +
          'font-size:12px;word-break:break-word">' + String(window.__lifehubError).slice(0, 300) + '</div>'
        : '';
      b.innerHTML =
        '<div style="max-width:340px;margin:0 auto;padding:22px;text-align:left;line-height:1.5">' +
        '<div style="font-weight:700;font-size:17px;margin-bottom:6px">LifeHub startet hier nicht</div>' +
        '<div style="font-size:13.5px;margin-bottom:14px">Das liegt fast immer an der Umgebung, in der die Datei ' +
        'gerade geöffnet wird &ndash; etwa einer Dateivorschau. Speichere die Datei und öffne sie direkt im Browser ' +
        '(Safari oder Chrome), oder nutze die gehostete Fassung.</div>' +
        '<div style="font-size:13px;font-weight:600;margin-bottom:4px">Was hier verfügbar ist:</div>' +
        lines + err +
        '<button onclick="location.reload()" style="margin-top:14px;padding:9px 14px;border:0;border-radius:8px;' +
        'background:#2a78d6;color:#fff;font:inherit;font-weight:600">Nochmal versuchen</button>' +
        '</div>';
    }
  })();
</script>
<noscript>
  <div style="padding:24px;font-family:system-ui,sans-serif;max-width:420px;margin:0 auto">
    <h2>JavaScript ist deaktiviert</h2>
    <p>LifeHub ist eine Anwendung und braucht JavaScript. Öffne die Datei bitte in Safari oder Chrome.</p>
  </div>
</noscript>
</body>
</html>
`

writeFileSync(path.join(root, 'LifeHub.html'), html)
rmSync(outDir, { recursive: true, force: true })
const mb = (Buffer.byteLength(html) / 1048576).toFixed(2)
console.log(`LifeHub.html erstellt (${mb} MB)`)
