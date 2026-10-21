// Paso 1: abre la página del enlace, cierra avisos de cookies, recorre sus secciones
// y saca capturas (también más abajo en las páginas largas) con el texto y la
// posición de botones, títulos e imágenes.
// Uso: node capturar.js <enlace> <carpeta del trabajo> [máximo de capturas] [--subidas <carpeta>]
// Con --subidas también usa las capturas que subió el usuario (ya pasadas a 1920x1080);
// si la página no deja entrar, el video se hace solo con ellas.
// Escribe contenido.json, o error.json con la causa si la página no deja entrar.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { abrirNavegador } = require('./navegador');

const [enlace, carpeta, maximoTexto] = process.argv.slice(2);
const posSubidas = process.argv.indexOf('--subidas');
const SUBIDAS = posSubidas > 0 && fs.existsSync(process.argv[posSubidas + 1] || '')
  ? fs.readdirSync(process.argv[posSubidas + 1]).filter(a => /^subida-\d+\.jpg$/.test(a))
      .sort((a, b) => parseInt(a.slice(7)) - parseInt(b.slice(7))).map(a => path.join(process.argv[posSubidas + 1], a))
  : [];
const MAXIMO_CAPTURAS = Math.max(3, (+maximoTexto || 10) - SUBIDAS.length);
const MAXIMO_PAGINAS = Math.max(3, Math.ceil(MAXIMO_CAPTURAS * 0.7));
const LIMITE_TOTAL = 4 * 60 * 1000;
const normal = d => d.split('#')[0].replace(/\/index\.html?$/, '/');
const dns = require('dns').promises;
const net = require('net');

function ipPrivada(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return ipPrivada(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

async function esPublica(host) {
  if (net.isIP(host)) return !ipPrivada(host);
  try { return (await dns.lookup(host, { all: true })).every(d => !ipPrivada(d.address)); }
  catch { return false; }
}
// Junta las capturas del usuario con las del recorrido y guarda el resultado.
function terminar(resultado, aviso) {
  for (const origen of SUBIDAS) {
    const numero = resultado.paginas.length + 1;
    const archivo = `pagina-${numero}.jpg`;
    fs.copyFileSync(origen, path.join(carpeta, 'capturas', archivo));
    resultado.paginas.push({ numero, direccion: resultado.enlace, parte: 1, archivo, subida: true,
      titulo: 'Captura subida por el usuario', texto: '', elementos: [] });
  }
  if (!resultado.paginas.length) fallar('No se pudo sacar ninguna captura de la página.');
  const conTexto = resultado.paginas.some(p => p.subida || p.respaldo || p.texto.trim().length > 40 || p.elementos.length > 3);
  if (!conTexto) fallar('La página salió vacía. Puede que pida iniciar sesión: puedes subir tus propias capturas.');
  if (aviso) resultado.aviso = aviso;
  // Aviso para el usuario: de dónde salieron las imágenes del video.
  const tuyas = resultado.paginas.filter(p => p.subida).length, deLaPagina = resultado.paginas.length - tuyas;
  const porLector = resultado.paginas.some(p => p.respaldo);
  const tusCapturas = tuyas === 1 ? 'tu captura' : `tus ${tuyas} capturas`;
  const suyas = deLaPagina === 1 ? '1 captura' : `${deLaPagina} capturas`;
  resultado.nota = !tuyas ? (porLector ? `La página bloqueó al programa; se usaron ${suyas} tomadas con un lector público.` : '')
    : !deLaPagina ? `Se usó solo ${tusCapturas}: la página no dejó sacar las suyas.`
    : `Se combinó ${tusCapturas} con ${suyas} que el programa sacó de la página${porLector ? ' (con un lector público, porque la página bloquea al programa)' : ''}.`;
  fs.writeFileSync(path.join(carpeta, 'contenido.json'), JSON.stringify(resultado, null, 1));
  const deTi = resultado.paginas.filter(p => p.subida).length;
  console.log(JSON.stringify({ avance: 100, texto: deTi ? `${resultado.paginas.length - deTi} capturas de la página + ${deTi} tuyas` : `${resultado.paginas.length} capturas` }));
}

// Respaldo cuando la página no deja entrar al navegador del programa (por ejemplo Cloudflare
// con las computadoras de GitHub): el lector público Jina (r.jina.ai, gratis) la abre desde sus
// servidores y devuelve su texto y una foto. Cada foto alta se corta en dos capturas de 1920x1080.
const ROBOT = /verify you are human|prove your humanity|real person|are you a robot|not a robot|captcha|access denied|attention required|just a moment|checking your browser|security check|unusual traffic|verifica que eres humano|demuestra que eres humano|no eres un robot|tráfico inusual|acceso denegado|verificación de seguridad|un momento|been blocked|blocked by|access to this page has been denied/i;
const JINA = 'https://r.jina.ai/';
async function pedirJina(direccion, formato) {
  const respuesta = await fetch(JINA + direccion, { headers: { 'X-Return-Format': formato }, signal: AbortSignal.timeout(90000) });
  if (!respuesta.ok) throw new Error(`Jina ${respuesta.status}`);
  return formato === 'screenshot' ? Buffer.from(await respuesta.arrayBuffer()) : respuesta.text();
}

async function respaldo(resultado, faltan) {
  if (faltan <= 0) return 0;
  avance(10, 'La página bloquea al programa: se lee con un lector público');
  const inicio = new URL(resultado.enlace);
  const direcciones = [inicio.href];
  const navegador = await abrirNavegador();
  const lienzo = await navegador.newPage({ viewport: { width: 1920, height: 1080 } });
  await lienzo.route('**/*', ruta => ruta.request().url().startsWith('data:') ? ruta.continue() : ruta.abort());
  let hechas = 0;
  try {
    for (let i = 0; i < direcciones.length && hechas < faltan && i < 6; i++) {
      let texto, foto;
      try { [texto, foto] = await Promise.all([pedirJina(direcciones[i], 'markdown'), pedirJina(direcciones[i], 'screenshot')]); }
      catch (error) { if (process.env.DEPURAR) console.error('respaldo', direcciones[i], error.message); continue; }
      if (!foto || foto.length < 5000 || foto[0] !== 0x89) continue;
      const titulo = ((texto.match(/^Title:[ 	]*(\S.*)$/m) || [])[1] || inicio.hostname).trim();
      const cuerpo = texto.split(/Markdown Content:\s*/)[1] || texto;
      // El lector también puede recibir la pantalla de bloqueo: esa no sirve.
      if (ROBOT.test(titulo + ' ' + cuerpo.slice(0, 1500)) && cuerpo.length < 2500) continue;
      // Otras páginas del mismo sitio, para tener más fotos si hacen falta.
      if (i === 0) {
        for (const [, otro] of cuerpo.matchAll(/\]\((https?:[^)\s]+)\)/g)) {
          try {
            const x = new URL(otro);
            if (x.origin === inicio.origin && !x.search && !/\.(pdf|jpe?g|png|gif|svg|webp|zip|mp4|mp3|xml|json)$/i.test(x.pathname) &&
                !/(login|signin|signup|logout|registr|cuenta|account|carrito|cart|checkout)/i.test(x.pathname) &&
                !direcciones.some(d => normal(d) === normal(x.href))) direcciones.push(x.href);
          } catch {}
        }
      }
      const limpio = cuerpo.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*_>|`]+/g, ' ').replace(/\s+/g, ' ').trim();
      await lienzo.setContent(`<body style="margin:0;background:#fff"><img id="f" style="width:1920px;display:block" src="data:image/png;base64,${foto.toString('base64')}"></body>`);
      const alto = await lienzo.evaluate(() => document.getElementById('f').decode().then(() => document.getElementById('f').offsetHeight)).catch(() => 0);
      if (!alto) continue;
      const cortes = alto > 1080 * 1.4 ? [0, alto - 1080] : [0];
      for (let parte = 0; parte < cortes.length && hechas < faltan; parte++) {
        await lienzo.evaluate(y => scrollTo(0, y), cortes[parte]);
        // La parte de abajo se descarta si está casi en blanco (un solo color).
        if (parte > 0) {
          const variada = await lienzo.evaluate(y => {
            const img = document.getElementById('f'), escala = img.naturalWidth / 1920;
            const lienzo = Object.assign(document.createElement('canvas'), { width: 96, height: 54 }), c = lienzo.getContext('2d');
            c.drawImage(img, 0, y * escala, img.naturalWidth, 1080 * escala, 0, 0, 96, 54);
            const d = c.getImageData(0, 0, 96, 54).data;
            let distintos = 0;
            for (let k = 0; k < d.length; k += 4) if (Math.abs(d[k] - d[0]) + Math.abs(d[k + 1] - d[1]) + Math.abs(d[k + 2] - d[2]) > 30) distintos++;
            return distintos / (d.length / 4) > 0.08;
          }, cortes[parte]).catch(() => true);
          if (!variada) continue;
        }
        const numero = resultado.paginas.length + 1, archivo = `pagina-${numero}.jpg`;
        await lienzo.screenshot({ path: path.join(carpeta, 'capturas', archivo), type: 'jpeg', quality: 86 });
        resultado.paginas.push({ numero, direccion: direcciones[i], parte: parte + 1, archivo, respaldo: true, titulo,
          texto: limpio.slice(parte * 2500, parte * 2500 + 2500), elementos: [] });
        hechas++;
        avance(Math.round(Math.min(95, 10 + hechas / faltan * 85)), `Página ${numero}: ${titulo.slice(0, 50)}`);
      }
    }
  } finally {
    await navegador.close().catch(() => {});
  }
  return hechas;
}

// Si la página no dejó entrar, primero se prueba el lector público; si tampoco sale, se usan las capturas del usuario.
async function cerrarConRespaldo(resultado, causa, detalle) {
  fs.mkdirSync(path.join(carpeta, 'capturas'), { recursive: true });
  let hechas = 0;
  try { hechas = await respaldo(resultado, MAXIMO_CAPTURAS - resultado.paginas.length); }
  catch (error) { if (process.env.DEPURAR) console.error('respaldo', error.message); }
  if (hechas) return terminar(resultado, null);
  if (SUBIDAS.length) return terminar(resultado, causa);
  fallar(causa, detalle);
}
const avance = (porcentaje, texto) => console.log(JSON.stringify({ avance: porcentaje, texto }));

const fallar = (causa, detalle) => {
  fs.mkdirSync(carpeta, { recursive: true });
  fs.writeFileSync(path.join(carpeta, 'error.json'), JSON.stringify({ causa, detalle: String(detalle || '').slice(0, 300) }));
  console.error(causa);
  process.exit(2);
};

// Botones de cookies y avisos que tapan la página.
// Los de cookies se tocan donde estén; los genéricos («Cerrar», «OK», «No, gracias», la ×)
// solo dentro de ventanas flotantes, para no apretar botones normales de la página.
const COOKIES = /^(aceptar( todo| todas| todas las cookies| cookies)?|acepto|accept( all| all cookies| cookies)?|agree|i agree|allow all|permitir( todo| todas)?|consent|rechazar( todo| todas)?|reject all|descartar|dismiss)$/i;
const GENERICO = /^(de acuerdo|entendido|ok|okay|got it|continuar|cerrar|close|no, gracias|no gracias|no, thanks|no thanks|ahora no|not now|quizás más tarde|más tarde|maybe later|×|✕|✖|x)$/i;

async function limpiar(pagina) {
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    const tocados = await pagina.evaluate(([COOKIES_TEXTO, GENERICO_TEXTO]) => {
      const cookies = new RegExp(COOKIES_TEXTO, 'i'), generico = new RegExp(GENERICO_TEXTO, 'i');
      const NOMBRE_CERRAR = /(close|cerrar|dismiss|descartar)/i;
      const flotante = e => {
        for (let x = e; x && x !== document.body; x = x.parentElement) {
          if (getComputedStyle(x).position === 'fixed' || x.matches('dialog,[role=dialog],[role=alertdialog],[aria-modal=true]')) return true;
        }
        return false;
      };
      // Que se vea y que no haya otra cosa encima: así no se tocan botones escondidos (carritos fuera de la pantalla).
      const alAlcance = b => {
        const r = b.getBoundingClientRect();
        if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
        const h = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
        return !!h && (b === h || b.contains(h) || h.contains(b));
      };
      // Un enlace que lleva a otra página no se toca.
      const navega = b => b.tagName === 'A' && b.getAttribute('href') && !/^(#|javascript:)/i.test(b.getAttribute('href'));
      let tocados = 0;
      for (const b of document.querySelectorAll('button, a, [role=button], input[type=button], input[type=submit], span, div, svg, i')) {
        if (tocados >= 4) break;
        // Algunas páginas (Amazon) dibujan el texto aparte y ponen un botón invisible encima: se toca ese botón.
        const dentro = !b.matches('button, a, [role=button], input') && b.children.length <= 3 ? b.querySelector('input[type=submit], input[type=button], button') : null;
        const esBoton = b.matches('button, a, [role=button], input') || !!dentro;
        const texto = (b.innerText || b.value || b.textContent || '').trim().replace(/\s+/g, ' ').replace(/[.!¡]+$/, '');
        if (texto.length > 40) continue;
        const etiqueta = `${b.getAttribute('aria-label') || ''} ${b.getAttribute('title') || ''}`;
        const clase = String(b.className && (b.className.baseVal ?? b.className));
        const porCookies = esBoton && cookies.test(texto);
        const porCerrar = (esBoton && generico.test(texto)) || NOMBRE_CERRAR.test(etiqueta) || (texto.length <= 1 && b.children.length <= 2 && NOMBRE_CERRAR.test(clase));
        if (!porCookies && !porCerrar) continue;
        if (porCerrar && !porCookies && !flotante(b)) continue;
        const objetivo = dentro || b;
        if (navega(objetivo) || !(alAlcance(b) || alAlcance(objetivo))) continue;
        try { objetivo.click ? objetivo.click() : objetivo.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); tocados++; } catch {}
      }
      return tocados;
    }, [COOKIES.source, GENERICO.source]).catch(() => 0);
    if (!tocados) break;
    await pagina.waitForTimeout(700);
  }
  // Lo que siga tapando la pantalla se oculta: ventanas emergentes, velos grises y avisos de cookies.
  await pagina.evaluate(() => {
    const area = innerWidth * innerHeight;
    for (const e of document.querySelectorAll('body *')) {
      const s = getComputedStyle(e);
      const dialogo = e.matches('dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true]');
      if (s.position !== 'fixed' && !dialogo) continue;
      if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05) continue;
      const r = e.getBoundingClientRect();
      const ancho = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
      const alto = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
      if (!ancho || !alto) continue;
      const texto = (e.innerText || '').slice(0, 1500);
      const deCookies = s.position === 'fixed' && /cookie|galleta/i.test(texto) && texto.length < 1500 && alto < innerHeight * 0.6;
      if (!deCookies) {
        if (ancho * alto < area * 0.12) continue;                                  // chat y botones flotantes se quedan
        if (r.top <= 2 && alto <= 170 && ancho > innerWidth * 0.8) continue;       // cabecera fija de la página
        // Solo si de verdad está encima del contenido (no un fondo fijo detrás).
        const encima = document.elementFromPoint(Math.max(0, r.left) + ancho / 2, Math.max(0, r.top) + alto / 2);
        if (!encima || !(e === encima || e.contains(encima))) continue;
      }
      e.style.setProperty('display', 'none', 'important');
    }
    // Si un aviso bloqueó el desplazamiento, se libera; si no, no se toca nada.
    for (const e of [document.documentElement, document.body]) if (getComputedStyle(e).overflowY === 'hidden') e.style.overflowY = 'visible';
  }).catch(() => {});
}

async function abrir(pagina, direccion) {
  let respuesta;
  // Primero basta con que el servidor responda; después se espera el contenido lo que se pueda.
  // Así las páginas lentas o muy pesadas igual dan algo que mostrar.
  for (let intento = 0; intento < 2 && !respuesta; intento++) {
    try {
      respuesta = await pagina.goto(direccion, { waitUntil: 'commit', timeout: 60000 });
    } catch (error) {
      if (/ERR_NAME_NOT_RESOLVED/.test(error.message)) return { fallo: 'No existe esa dirección. Revisa que el enlace esté bien escrito.', detalle: error.message };
      if (/ERR_CONNECTION_REFUSED|ERR_ADDRESS_UNREACHABLE/.test(error.message)) return { fallo: 'La página no responde. Puede estar caída.', detalle: error.message };
      if (/ERR_CERT|SSL/.test(error.message)) return { fallo: 'La página tiene un certificado de seguridad inválido.', detalle: error.message };
      if (intento === 1) return { fallo: /timeout/i.test(error.message) ? 'La página tardó demasiado en responder.' : 'No se pudo abrir la página.', detalle: error.message };
      await pagina.waitForTimeout(3000);
    }
  }
  await pagina.waitForLoadState('domcontentloaded', { timeout: 40000 }).catch(() => {});
  await pagina.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await pagina.waitForTimeout(1200);
  const tipo = respuesta && (respuesta.headers()['content-type'] || '');
  if (respuesta && tipo && !/html/i.test(tipo)) return { fallo: 'El enlace no es una página web (es un archivo). Pega el enlace de una página.', detalle: tipo };
  let estado = respuesta ? respuesta.status() : 200;
  // Páginas dormidas (Render, Glitch...) responden 502/503/504 mientras despiertan: se espera y se reintenta.
  for (let espera = 0; espera < 4 && [502, 503, 504].includes(estado); espera++) {
    avance(5, 'La página está despertando, esperando…');
    await pagina.waitForTimeout(15000);
    try { respuesta = await pagina.goto(direccion, { waitUntil: 'commit', timeout: 60000 }); estado = respuesta ? respuesta.status() : 200; }
    catch { break; }
    await pagina.waitForLoadState('domcontentloaded', { timeout: 40000 }).catch(() => {});
  }
  const leer = () => pagina.evaluate(() => document.title + ' ' + (document.body && document.body.innerText || '').slice(0, 3000)).catch(() => '');
  let texto = await leer();
  // Pantallas tipo «Just a moment…» de Cloudflare: a veces se resuelven solas en unos segundos.
  for (let espera = 0; espera < 6 && /just a moment|checking your browser|un momento|verificando/i.test(texto) && texto.length < 1800; espera++) {
    avance(5, 'La página revisa el navegador, esperando…');
    await pagina.waitForTimeout(3000);
    texto = await leer();
    if (respuesta && !/just a moment|checking your browser|un momento|verificando/i.test(texto)) estado = 200;
  }
  if (estado === 404 || estado === 410) return { fallo: `Esa página no existe (código ${estado}). Revisa el enlace.`, detalle: texto.slice(0, 200) };
  if (estado >= 500) return { fallo: `La página no responde (código ${estado}). Puede estar caída o dormida; intenta en unos minutos.`, detalle: texto.slice(0, 200) };
  if (estado >= 400 || ROBOT.test(texto) && texto.length < 1800) {
    return { fallo: `La página no dejó entrar al programa${estado >= 400 ? ` (código ${estado})` : ''}. Algunas páginas bloquean a los robots: puedes subir tus propias capturas.`, detalle: texto.slice(0, 200) };
  }
  await limpiar(pagina);
  // Bajar despacio para que carguen las imágenes que aparecen al hacer scroll.
  await pagina.evaluate(async () => {
    const alto = Math.min(document.documentElement.scrollHeight, innerHeight * 4);
    for (let y = 0; y < alto; y += innerHeight / 2) { scrollTo(0, y); await new Promise(r => setTimeout(r, 180)); }
    scrollTo(0, 0);
  }).catch(() => {});
  await pagina.waitForTimeout(1500);
  // Muchas ventanas («suscríbete», ofertas) salen recién al bajar: se limpia otra vez.
  await limpiar(pagina);
  return {};
}

// Algunas páginas (anuncios, letras que no terminan de cargar) cuelgan la foto normal:
// entonces se saca directo con Chrome, que no espera nada.
async function fotografiar(pagina, archivo) {
  try {
    await pagina.screenshot({ path: archivo, type: 'jpeg', quality: 86, timeout: 8000 });
  } catch {
    const cdp = await pagina.context().newCDPSession(pagina);
    const foto = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 86 });
    fs.writeFileSync(archivo, Buffer.from(foto.data, 'base64'));
    await cdp.detach().catch(() => {});
  }
}

// Barras que quedan pegadas arriba al bajar (menú, cabecera): su alto y cómo esconderlas en la foto.
async function altoMenuPegado(pagina) {
  return pagina.evaluate(() => {
    let alto = 0;
    for (const e of document.querySelectorAll('body *')) {
      const s = getComputedStyle(e);
      if (s.position !== 'fixed' && s.position !== 'sticky') continue;
      const r = e.getBoundingClientRect();
      if (r.top <= 4 && r.height > 20 && r.height < innerHeight * 0.3 && r.width > innerWidth * 0.5 && s.visibility !== 'hidden' && s.display !== 'none') alto = Math.max(alto, r.bottom);
    }
    return Math.round(alto);
  }).catch(() => 0);
}
async function esconderMenuPegado(pagina, esconder) {
  await pagina.evaluate(esconder => {
    if (!esconder) { document.querySelectorAll('[data-menu-escondido]').forEach(e => { e.style.removeProperty('visibility'); e.removeAttribute('data-menu-escondido'); }); return; }
    for (const e of document.querySelectorAll('body *')) {
      const s = getComputedStyle(e);
      if (s.position !== 'fixed' && s.position !== 'sticky') continue;
      const r = e.getBoundingClientRect();
      if (r.top <= 4 && r.height > 20 && r.height < innerHeight * 0.3 && r.width > innerWidth * 0.5) { e.style.setProperty('visibility', 'hidden', 'important'); e.setAttribute('data-menu-escondido', ''); }
    }
  }, esconder).catch(() => {});
}

// Carruseles: se corren de lado (o hacia abajo) para mostrar y señalar las tarjetas que estaban escondidas.
// Si el carrusel no se desliza, se toca su botón «siguiente». Devuelve true si algo cambió en pantalla.
async function correrCarrusel(pagina, usados) {
  return pagina.evaluate(async usados => {
    const PISO = innerHeight - 110;
    const entero = r => r.top >= 0 && r.bottom <= PISO && r.left >= -1 && r.right <= innerWidth + 1;
    const espera = ms => new Promise(r => setTimeout(r, ms));
    const candidatos = [...document.querySelectorAll('body *')].filter(e => {
      if (e.dataset.carruselVisto || usados.includes(e.dataset.carruselId)) return false;
      const s = getComputedStyle(e), r = e.getBoundingClientRect();
      if (r.width < 300 || r.height < 120 || !entero(r)) return false;
      const deLado = s.overflowX !== 'visible' && e.scrollWidth > e.clientWidth + 60 && e.scrollLeft + e.clientWidth < e.scrollWidth - 20;
      const haciaAbajo = /auto|scroll/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 60 && e !== document.scrollingElement;
      return deLado || haciaAbajo;
    });
    for (const c of candidatos) {
      const id = 'c' + Math.random().toString(36).slice(2, 8);
      c.dataset.carruselId = id; c.dataset.carruselVisto = '1';
      const antes = [c.scrollLeft, c.scrollTop];
      const deLado = c.scrollWidth > c.clientWidth + 60;
      if (deLado) c.scrollTo({ left: c.scrollLeft + c.clientWidth * 0.9, behavior: 'instant' });
      else c.scrollTo({ top: c.scrollTop + c.clientHeight * 0.9, behavior: 'instant' });
      await espera(500);
      if (c.scrollLeft !== antes[0] || c.scrollTop !== antes[1]) return id;
      // No se deslizó: se busca su botón «siguiente» cerca (dentro o en el contenedor de arriba).
      const zona = c.parentElement?.parentElement || c.parentElement || c;
      const boton = [...zona.querySelectorAll('button, [role=button], a')].find(b => {
        const t = `${b.getAttribute('aria-label') || ''} ${b.title || ''} ${b.className || ''} ${(b.innerText || '').trim()}`;
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && /(siguiente|next|›|→|❯|>$)/i.test(t) && !(b.tagName === 'A' && b.getAttribute('href') && !/^#/.test(b.getAttribute('href')));
      });
      if (boton) { boton.click(); await espera(900); return id; }
    }
    return null;
  }, usados).catch(() => null);
}

async function medir(pagina) {
  return pagina.evaluate(() => {
    // Lo que tiene otra cosa encima (un menú pegado arriba, una barra) no se ve en la foto: no se señala.
    // Se miran 4 puntos dentro del elemento y se atraviesan las capas transparentes que algunas páginas
    // ponen encima; un elemento fuera de la parte visible de un carrusel tampoco aparece en esos puntos.
    const transparente = x => {
      if (/^(IMG|VIDEO|CANVAS|SVG|PICTURE|IFRAME|INPUT|BUTTON|SELECT|TEXTAREA)$/.test(x.tagName)) return false;
      const s = getComputedStyle(x);
      const fondo = s.backgroundColor.match(/[\d.]+/g);
      if (s.backgroundImage !== 'none' || (fondo && (fondo.length < 4 || +fondo[3] > 0.05))) return false;
      return ![...x.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    };
    const destapado = (e, r) => {
      const antes = e.style.getPropertyValue('pointer-events'), prioridad = e.style.getPropertyPriority('pointer-events');
      e.style.setProperty('pointer-events', 'auto', 'important');
      const puntos = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + r.width * .2, r.top + r.height / 2],
        [r.left + r.width * .8, r.top + r.height / 2], [r.left + r.width / 2, r.top + r.height * .25]];
      let bien = 0;
      for (const [x, y] of puntos) {
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) { bien++; continue; }
        for (const h of document.elementsFromPoint(x, y)) {
          if (h === e || e.contains(h)) { bien++; break; }
          if (!transparente(h)) break;
        }
      }
      if (antes) e.style.setProperty('pointer-events', antes, prioridad); else e.style.removeProperty('pointer-events');
      return bien >= 3;
    };
    // En el video el subtítulo va encima de la franja de abajo de la captura: ahí no se señala nada
    // (esa parte sale más arriba en la captura siguiente).
    const PISO = innerHeight - 110;
    const visible = e => {
      const r = e.getBoundingClientRect(), s = getComputedStyle(e);
      // Entero en la foto: una imagen o un título a medias no se señala (marcaría solo la mitad).
      return r.width > 8 && r.height > 8 && r.top >= 0 && r.left >= -1 && r.right <= innerWidth + 1 && r.bottom <= PISO
        && s.visibility !== 'hidden' && +s.opacity > 0.05 && destapado(e, r);
    };
    const elementos = [];
    // Una imagen o video más alto que la pantalla nunca cabe entero: se señala la parte que se ve,
    // si se ve al menos la mitad de la pantalla de alto.
    const parteVisible = e => {
      if (!/^(IMG|VIDEO)$/.test(e.tagName)) return null;
      const r = e.getBoundingClientRect(), s = getComputedStyle(e);
      if (r.height <= PISO || s.visibility === 'hidden' || +s.opacity <= 0.05) return null;
      const arriba = Math.max(0, r.top), abajo = Math.min(PISO, r.bottom), izq = Math.max(0, r.left), der = Math.min(innerWidth, r.right);
      if (abajo - arriba < PISO * 0.5 || der - izq < 60) return null;
      const recorte = { left: izq, top: arriba, right: der, bottom: abajo, width: der - izq, height: abajo - arriba };
      return destapado(e, recorte) ? recorte : null;
    };
    document.querySelectorAll('h1,h2,h3,button,a,img,video,input,textarea,select,[role=button]').forEach(e => {
      const recorte = parteVisible(e);
      if (!recorte && !visible(e)) return;
      const r = recorte || e.getBoundingClientRect();
      const texto = (e.innerText || e.alt || e.title || e.getAttribute('aria-label') || e.placeholder || '').trim().replace(/\s+/g, ' ');
      if (!texto && e.tagName !== 'IMG' && e.tagName !== 'VIDEO') return;
      // Una imagen que no cargó, o un enlace sin nada a la vista (carruseles), sería un recuadro vacío.
      if (e.tagName === 'IMG' && !(e.complete && e.naturalWidth > 0)) return;
      if (/^(A|BUTTON)$/.test(e.tagName) && !(e.innerText || '').trim() && !e.querySelector('img, svg, video, picture')) return;
      elementos.push({ tipo: e.tagName.toLowerCase(), texto: texto.slice(0, 80),
        caja: [Math.max(0, r.left), Math.max(0, r.top), Math.min(r.width, innerWidth), Math.min(r.height, innerHeight)].map(Math.round) });
    });
    // Datos con cifras (porcentajes, montos, cantidades, fechas): caja justo alrededor del dato,
    // para que el video señale el número del que habla y no el título.
    const datos = [], vistos = new Set();
    const DATO = /(?:S\/\s?|US\$\s?|\$\s?|€\s?)?\d[\d.,]*(?:\s?%|\s(?:por\s?ciento|millones|millón|mil|soles|dólares|euros|kilómetros|km|kv|mw|kw|metros|hectáreas|habitantes|familias|viviendas|personas|localidades|años|horas|minutos)\b)?(?:\s+de\s+(?:soles|dólares|habitantes|personas|familias))?/gi;
    const recorrer = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: n => /\d/.test(n.textContent) && !n.parentElement.closest('script,style,noscript,nav,footer,select,option,time') ? 1 : 2,
    });
    for (let n = recorrer.nextNode(); n && datos.length < 30; n = recorrer.nextNode()) {
      const texto = n.textContent;
      for (const m of texto.matchAll(DATO)) {
        if (m[0].replace(/\D/g, '').length < 2 && !/%/.test(m[0])) continue;
        // Una cifra sola («22») se entiende mejor con las dos palabras de antes («trabajo número 22»).
        let inicio = m.index;
        const fin = m.index + m[0].replace(/[\s.,;:]+$/, '').length;
        if (!/[a-z%$€/]/i.test(m[0])) {
          const antes = texto.slice(Math.max(0, inicio - 30), inicio).match(/(\S+\s+){1,2}$/);
          if (antes) inicio -= antes[0].length;
        }
        const rango = document.createRange();
        rango.setStart(n, inicio); rango.setEnd(n, fin);
        const r = rango.getBoundingClientRect();
        if (r.width < 8 || r.height < 8 || r.top < 0 || r.bottom > PISO || r.left < 0 || r.right > innerWidth) continue;
        const s = getComputedStyle(n.parentElement);
        if (s.visibility === 'hidden' || +s.opacity < .05 || !destapado(n.parentElement, r)) continue;
        const clave = Math.round(r.left) + ':' + Math.round(r.top);
        if (vistos.has(clave)) continue;
        vistos.add(clave);
        const contexto = (texto.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40)).replace(/\s+/g, ' ').trim();
        datos.push({ tipo: 'dato', texto: contexto.slice(0, 100),
          caja: [r.left - 6, r.top - 4, r.width + 12, r.height + 8].map(Math.round) });
      }
    }
    // Párrafos visibles: para señalar una idea que no tiene cifra.
    const parrafos = [...document.body.querySelectorAll('p, li, blockquote, figcaption, div, span')].filter(e => {
      const propio = [...e.childNodes].filter(x => x.nodeType === 3).map(x => x.textContent).join('').trim();
      if (propio.length < 60 || e.closest('nav,footer,script,style')) return false;
      const r = e.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= PISO && r.width > 40 && destapado(e, r);
    }).slice(0, 12).map(e => {
      const r = e.getBoundingClientRect();
      return { tipo: 'parrafo', texto: e.innerText.replace(/\s+/g, ' ').trim().slice(0, 100), caja: [r.left, r.top, r.width, r.height].map(Math.round) };
    });
    const enVista = [...document.body.querySelectorAll('*')].filter(e => {
      const r = e.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0 && e.children.length === 0;
    }).map(e => e.innerText || '').join(' ').replace(/\s+/g, ' ');
    return { titulo: document.title, texto: enVista.slice(0, 2500), elementos: [...elementos.slice(0, 50), ...datos.slice(0, 25), ...parrafos] };
  });
}

(async () => {
  let u;
  try { u = new URL(enlace); } catch { fallar('El enlace no es válido. Debe empezar con http:// o https://'); }
  // Una dirección que no existe se avisa clara antes de abrir el navegador.
  try { await dns.lookup(u.hostname); }
  catch { if (SUBIDAS.length) { fs.mkdirSync(path.join(carpeta, 'capturas'), { recursive: true }); return terminar({ enlace, paginas: [] }, 'La dirección no existe'); }
          fallar('No existe esa dirección. Revisa que el enlace esté bien escrito.'); }
  fs.mkdirSync(path.join(carpeta, 'capturas'), { recursive: true });
  const navegador = await abrirNavegador();
  const contexto = await navegador.newContext({
    viewport: { width: 1920, height: 1080 }, locale: 'es-PE', timezoneId: 'America/Lima',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
  });
  // Que el navegador se parezca a uno normal: algunas páginas cierran la puerta a los robots evidentes.
  await contexto.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['es-PE', 'es', 'en'] });
  });
  await contexto.setExtraHTTPHeaders({ 'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8' });
  const pagina = await contexto.newPage();
  pagina.on('dialog', d => d.dismiss().catch(() => {}));
  // Nada de redes privadas ni archivos locales, aunque la página redirija o cargue cosas de ahí.
  const revisadas = new Map();
  await contexto.route('**/*', async ruta => {
    let x;
    try { x = new URL(ruta.request().url()); } catch { return ruta.abort(); }
    if (x.protocol === 'data:' || x.protocol === 'blob:') return ruta.continue();
    if (!/^https?:$/.test(x.protocol)) return ruta.abort();
    if (!revisadas.has(x.hostname)) revisadas.set(x.hostname, esPublica(x.hostname));
    return (await revisadas.get(x.hostname)) ? ruta.continue() : ruta.abort();
  });
  // Solo marca el límite; unref() hace que no impida terminar antes.
  const reloj = setTimeout(() => { console.error('tiempo agotado'); }, LIMITE_TOTAL);
  reloj.unref();
  const empezo = Date.now();
  const pendientes = [u.href];
  const vistas = new Set();
  const resultado = { enlace: u.href, paginas: [] };
  let paginasVistas = 0;

  while (pendientes.length && resultado.paginas.length < MAXIMO_CAPTURAS && paginasVistas < MAXIMO_PAGINAS && Date.now() - empezo < LIMITE_TOTAL) {
    const direccion = normal(pendientes.shift());
    if (vistas.has(direccion)) continue;
    vistas.add(direccion);
    const abierta = await abrir(pagina, direccion);
    if (abierta.fallo) {
      if (!resultado.paginas.length) {
        await navegador.close();
        // Una dirección mal escrita, un 404 o un archivo no se arreglan con el lector público.
        if (/no dejó entrar|tardó demasiado|No se pudo abrir|no responde/.test(abierta.fallo)) return cerrarConRespaldo(resultado, abierta.fallo, abierta.detalle);
        if (SUBIDAS.length) return terminar(resultado, abierta.fallo);
        fallar(abierta.fallo, abierta.detalle);
      }
      continue;
    }
    paginasVistas++;
    const forma = await pagina.evaluate(() => ({
      alto: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
      // Párrafos largos: señal de artículo, noticia o blog (página que informa sobre un tema).
      // Bloques con texto largo propio (párrafos aunque la página no use <p>).
      parrafos: [...document.body.querySelectorAll('*')].filter(e => !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(e.tagName) &&
        [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim().length > 80).length,
    })).catch(() => ({ alto: 1080, parrafos: 0 }));
    const esArticulo = resultado.paginas.length === 0 && forma.parrafos >= 8 && forma.alto > 1080 * 3;
    if (process.env.DEPURAR) console.error('forma', pagina.url(), JSON.stringify(forma), esArticulo);
    // Un artículo se recorre entero de arriba a abajo y no se sale a otras páginas (el tema está ahí).
    // En las demás, la primera página guarda hasta 3 partes y las siguientes 1 o 2.
    // Al bajar, el menú pegado arriba tapa la parte de arriba: cada paso baja menos para no perder datos.
    const menu = await altoMenuPegado(pagina);
    const paso = Math.max(600, 1080 - menu - 140);
    const carruselesPagina = [];
    let posiciones;
    if (esArticulo) {
      const cuantas = Math.min(MAXIMO_CAPTURAS, Math.max(3, Math.floor(forma.alto / paso)));
      const ultima = Math.max(0, Math.min(forma.alto, 1080 * 40) - 1080);
      posiciones = Array.from({ length: cuantas }, (_, i) => Math.round(i / Math.max(1, cuantas - 1) * ultima));
    } else {
      const partes = Math.min(resultado.paginas.length === 0 ? 3 : 2, Math.max(1, Math.round(forma.alto / 1080)));
      posiciones = Array.from({ length: partes }, (_, i) => i * paso);
    }
    // Cada captura empieza justo arriba de una imagen grande o de un título cercano: así las portadas salen enteras.
    posiciones = await pagina.evaluate(lista => {
      const arriba = [...document.querySelectorAll('img, picture, video, figure, h2, h3')].map(e => {
        const r = e.getBoundingClientRect();
        const grande = /IMG|PICTURE|VIDEO|FIGURE/.test(e.tagName) ? r.width > 220 && r.height > 140 && r.height < innerHeight - 160 : r.width > 120;
        return grande ? Math.round(r.top + scrollY) : null;
      }).filter(y => y !== null).sort((a, b) => a - b);
      const usadas = [];
      return lista.map((y, i) => {
        if (i === 0 && y === 0) { usadas.push(0); return 0; }
        const cerca = arriba.filter(t => Math.abs(t - 24 - y) < 340 && !usadas.some(u => Math.abs(u - (t - 24)) < 400));
        const elegido = cerca.length ? cerca.reduce((a, b) => Math.abs(a - 24 - y) <= Math.abs(b - 24 - y) ? a : b) - 24 : y;
        const final = Math.max(0, elegido);
        usadas.push(final);
        return final;
      });
    }, posiciones).catch(() => posiciones);
    for (let parte = 0; parte < posiciones.length && resultado.paginas.length < MAXIMO_CAPTURAS; parte++) {
      // Sin desplazamiento suave: la página queda quieta en su lugar antes de la foto.
      await pagina.evaluate(y => scrollTo({ top: y, behavior: 'instant' }), posiciones[parte]).catch(() => {});
      await pagina.waitForTimeout(450);
      // Se esperan las letras de la página: si cambian después de medir, las cajas quedan corridas.
      await pagina.evaluate(() => Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 4000))])).catch(() => {});
      await pagina.waitForTimeout(150);
      // Justo antes de la foto, por si salió una ventana con el tiempo o al bajar.
      await limpiar(pagina);
      // Más abajo del comienzo, el menú pegado arriba taparía datos: se esconde para esta foto.
      await esconderMenuPegado(pagina, posiciones[parte] > 0);
      const numero = resultado.paginas.length + 1;
      const archivo = `pagina-${numero}.jpg`;
      // Primero la foto y enseguida la medida, para que las cajas coincidan con lo que se ve.
      await fotografiar(pagina, path.join(carpeta, 'capturas', archivo));
      const datos = await medir(pagina).catch(() => null);
      if (!datos) break;
      resultado.paginas.push({ numero, direccion: pagina.url(), parte: parte + 1, archivo, ...datos });
      avance(Math.round(resultado.paginas.length / MAXIMO_CAPTURAS * 100), `Página ${numero}: ${datos.titulo.slice(0, 50)}`);
      // Si en esta parte hay un carrusel con tarjetas escondidas, se corre y se saca otra foto (hasta 2 por página).
      while (carruselesPagina.length < 2 && resultado.paginas.length < MAXIMO_CAPTURAS) {
        const corrido = await correrCarrusel(pagina, carruselesPagina);
        if (!corrido) break;
        carruselesPagina.push(corrido);
        await pagina.evaluate(() => Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 2000))])).catch(() => {});
        const n2 = resultado.paginas.length + 1, archivo2 = `pagina-${n2}.jpg`;
        await fotografiar(pagina, path.join(carpeta, 'capturas', archivo2));
        const datos2 = await medir(pagina).catch(() => null);
        if (!datos2) break;
        resultado.paginas.push({ numero: n2, direccion: pagina.url(), parte: parte + 1, archivo: archivo2, carrusel: true, ...datos2 });
        avance(Math.round(resultado.paginas.length / MAXIMO_CAPTURAS * 100), `Página ${n2}: carrusel de ${datos2.titulo.slice(0, 40)}`);
      }
    }
    if (esArticulo) { resultado.articulo = true; break; }
    // Enlaces internos: primero menú, cabecera y pie; sin parámetros ni archivos.
    const enlaces = await pagina.evaluate(() => [...document.querySelectorAll('nav a[href], header a[href], [role=navigation] a[href], aside a[href], footer a[href], a[href]')].map(a => a.href)).catch(() => []);
    const carpetaInicio = u.pathname.replace(/[^/]*$/, '');
    for (const otro of enlaces) {
      try {
        const x = new URL(otro);
        if (x.origin === u.origin && x.pathname.startsWith(carpetaInicio) && !x.search &&
            !/\.(pdf|jpe?g|png|gif|svg|webp|zip|rar|mp4|mp3|xml|json|docx?|xlsx?)$/i.test(x.pathname) &&
            !/(login|signin|signup|logout|registr|cuenta|account|carrito|cart|checkout)/i.test(x.pathname) &&
            !vistas.has(normal(x.href)) && !pendientes.includes(x.href)) pendientes.push(x.href);
      } catch {}
    }
  }
  clearTimeout(reloj);
  await navegador.close();
  // Si lo único que se vio fue una página vacía, se prueba el lector público y, si no, las capturas del usuario.
  const vacia = !resultado.paginas.some(p => p.texto.trim().length > 40 || p.elementos.length > 3);
  if (vacia) {
    resultado.paginas = [];
    return cerrarConRespaldo(resultado, 'La página salió vacía. Puede que pida iniciar sesión: puedes subir tus propias capturas.');
  }
  terminar(resultado, null);
})().catch(error => {
  return cerrarConRespaldo({ enlace, paginas: [] }, 'Falló al recorrer la página.', error.message)
    .catch(() => fallar('Falló al recorrer la página.', error.message));
});
