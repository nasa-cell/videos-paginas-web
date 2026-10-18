// Página de «Explícame la página»: cuenta, pedir videos, ver cómo avanzan y el almacén.
(() => {
  const $ = s => document.querySelector(s);
  const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const escapar = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const leer = k => { try { return localStorage.getItem(k); } catch { return null; } };

  async function api(ruta, opciones = {}) {
    const r = await fetch(ruta, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...opciones });
    let datos = {};
    try { datos = await r.json(); } catch {}
    if (!r.ok) throw Object.assign(new Error(datos.error || (r.status === 401 ? 'Tu sesión se cerró. Vuelve a entrar.' : 'El servidor no respondió. Revisa tu internet.')), { estado: r.status });
    return datos;
  }

  // ---------- Avisos, sonido y efectos ----------
  function avisar(texto, malo = false) {
    const a = document.createElement('div');
    a.className = 'aviso' + (malo ? ' malo' : '');
    a.textContent = texto;
    $('#avisos').appendChild(a);
    setTimeout(() => { a.classList.add('sale'); setTimeout(() => a.remove(), 400); }, malo ? 7000 : 4500);
  }
  let audio = null, sonidoPendiente = false;
  const abrirAudio = () => {
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch {}
    if (sonidoPendiente && audio && audio.state === 'running') { sonidoPendiente = false; campanita(); }
  };
  addEventListener('pointerdown', abrirAudio);
  addEventListener('keydown', abrirAudio);
  function campanita() {
    // Tres notas que suben, como una campanita de «listo».
    if (!audio || audio.state !== 'running') { sonidoPendiente = true; return; }
    [[784, 0], [988, .12], [1319, .24]].forEach(([f, d]) => {
      const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + d;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.25, t + .02); g.gain.exponentialRampToValueAtTime(.001, t + .9);
      o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 1);
    });
  }
  function sonidoError() {
    if (!audio || audio.state !== 'running') return;
    const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
    o.type = 'triangle'; o.frequency.setValueAtTime(330, t); o.frequency.exponentialRampToValueAtTime(180, t + .35);
    g.gain.setValueAtTime(.2, t); g.gain.exponentialRampToValueAtTime(.001, t + .45);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + .5);
  }
  function onda(boton, e) {
    if (quieto || !e.clientX) return;
    const r = boton.getBoundingClientRect(), o = document.createElement('i'), tam = Math.max(r.width, r.height);
    o.className = 'onda'; Object.assign(o.style, { width: tam + 'px', height: tam + 'px', left: e.clientX - r.left - tam / 2 + 'px', top: e.clientY - r.top - tam / 2 + 'px' });
    boton.appendChild(o); setTimeout(() => o.remove(), 650);
  }
  document.addEventListener('click', e => { const b = e.target.closest('.principal, .crear, .secundario'); if (b) onda(b, e); });
  function chispas(elemento) {
    if (quieto) return;
    const cara = elemento.querySelector('i');
    for (let k = 0; k < 8; k++) {
      const c = document.createElement('span'), ang = k / 8 * Math.PI * 2;
      c.className = 'chispa'; c.style.left = cara.offsetLeft + 14 + 'px'; c.style.top = cara.offsetTop + 14 + 'px';
      c.style.setProperty('--x', Math.cos(ang) * 32 + 'px'); c.style.setProperty('--y', Math.sin(ang) * 32 + 'px');
      elemento.appendChild(c); setTimeout(() => c.remove(), 750);
    }
  }
  function estrellitas(caja) {
    if (quieto) return;
    for (let k = 0; k < 16; k++) {
      const s = document.createElement('span'); s.className = 'estrellita'; s.textContent = '✦';
      s.style.left = 5 + Math.random() * 90 + '%'; s.style.top = '0'; s.style.animationDelay = Math.random() * .5 + 's';
      s.style.setProperty('--x', (Math.random() - .5) * 120 + 'px');
      caja.appendChild(s); setTimeout(() => s.remove(), 2200);
    }
  }
  // Títulos que entran palabra por palabra
  document.querySelectorAll('.titulo-animado').forEach(h => {
    let i = 0;
    [...h.childNodes].forEach(n => {
      if (n.nodeType !== 3) { n.style.animationDelay = `${i * .07}s, ${i * .07 + .5}s`; i++; return; }
      const partes = n.textContent.split(/(\s+)/);
      n.replaceWith(...partes.map(p => {
        if (!p.trim()) return document.createTextNode(p);
        const s = document.createElement('span'); s.className = 'palabra'; s.textContent = p; s.style.animationDelay = i++ * .07 + 's'; return s;
      }));
    });
  });

  // ---------- Cuenta ----------
  let usuario = null, proveedores = {};
  const forma = $('#formAcceso');
  let modo = 'entrar';
  function ponerModo(nuevo) {
    modo = nuevo;
    const registro = modo === 'registro';
    document.querySelectorAll('.pestanas button').forEach(b => b.setAttribute('aria-selected', b.dataset.modo === modo));
    forma.querySelectorAll('.solo-registro').forEach(e => e.hidden = !registro);
    forma.clave.autocomplete = registro ? 'new-password' : 'current-password';
    $('#botonAcceso').textContent = registro ? 'Crear mi cuenta' : 'Entrar';
    $('#olvido').hidden = registro || !proveedores.recuperar;
    $('#errorAcceso').textContent = '';
  }
  document.querySelectorAll('.pestanas button').forEach(b => b.addEventListener('click', () => ponerModo(b.dataset.modo)));
  // ---------- Reglas de la contraseña, límites y correo mal escrito ----------
  const reglas = clave => ({
    largo: clave.length >= 8 && clave.length <= 64, numero: /\d/.test(clave), mayus: /[A-ZÁÉÍÓÚÑ]/.test(clave),
    minus: /[a-záéíóúñ]/.test(clave), simbolo: /[^A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ\s]/.test(clave),
  });
  const claveValida = clave => Object.values(reglas(clave)).every(Boolean);
  function pintarReglas(lista, clave) {
    const r = reglas(clave);
    lista.querySelectorAll('li').forEach(li => li.classList.toggle('cumple', r[li.dataset.regla]));
    if (claveValida(clave)) lista.classList.remove('avisa');
  }
  function avisarReglas(lista) {
    lista.classList.add('avisa');
    lista.classList.remove('tiembla'); void lista.offsetWidth; lista.classList.add('tiembla');
  }
  forma.clave.addEventListener('input', () => pintarReglas($('#reqRegistro'), forma.clave.value));
  forma.nombre.addEventListener('input', () => {
    const n = forma.nombre.value.length, c = $('#contadorNombre');
    c.textContent = `${n}/40`; c.classList.toggle('cerca', n >= 34);
  });
  document.querySelectorAll('[data-ojo]').forEach(b => b.addEventListener('click', () => {
    const campo = forma[b.dataset.ojo], ver = campo.type === 'password';
    campo.type = ver ? 'text' : 'password';
    b.textContent = ver ? 'Ocultar' : 'Ver';
    b.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña');
  }));
  // Errores comunes al escribir el dominio del correo
  const DOMINIOS = { 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmail.co': 'gmail.com',
    'gmail.con': 'gmail.com', 'gmaill.com': 'gmail.com', 'gmal.com': 'gmail.com', 'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com',
    'hotmail.co': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'outlok.com': 'outlook.com', 'outlook.co': 'outlook.com', 'yahooo.com': 'yahoo.com',
    'yaho.com': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'icloud.co': 'icloud.com' };
  function sugerirCorreo() {
    const valor = forma.correo.value.trim().toLowerCase(), boton = $('#sugerenciaCorreo');
    const [usuarioCorreo, dominio] = valor.split('@');
    const bueno = dominio && DOMINIOS[dominio];
    boton.hidden = !bueno;
    if (bueno) { boton.dataset.correo = `${usuarioCorreo}@${bueno}`; boton.innerHTML = `¿Quisiste decir <b>${escapar(usuarioCorreo)}@${bueno}</b>?`; }
  }
  forma.correo.addEventListener('blur', sugerirCorreo);
  forma.correo.addEventListener('input', () => { if (!$('#sugerenciaCorreo').hidden) sugerirCorreo(); });
  $('#sugerenciaCorreo').addEventListener('click', e => { forma.correo.value = e.currentTarget.dataset.correo; e.currentTarget.hidden = true; forma.correo.focus(); });

  forma.addEventListener('submit', async e => {
    e.preventDefault();
    const boton = $('#botonAcceso'), error = $('#errorAcceso');
    error.textContent = '';
    const datos = { correo: forma.correo.value.trim(), clave: forma.clave.value, nombre: forma.nombre.value.trim().replace(/\s+/g, ' ') };
    if (modo === 'registro') {
      if (datos.nombre.length < 2) { error.textContent = 'Escribe tu nombre (mínimo 2 letras).'; forma.nombre.focus(); return; }
      if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]+$/.test(datos.nombre)) { error.textContent = 'Tu nombre solo puede tener letras y espacios.'; forma.nombre.focus(); return; }
      if (!claveValida(datos.clave)) { error.textContent = 'La contraseña todavía no cumple todas las reglas.'; avisarReglas($('#reqRegistro')); forma.clave.focus(); return; }
    }
    boton.disabled = true;
    try {
      const r = await api(modo === 'registro' ? '/api/registro' : '/api/entrar', { method: 'POST', body: JSON.stringify(datos) });
      if (r.confirmar) abrirConfirmar(datos);
      else await cargarCuenta();
    } catch (err) { error.textContent = err.message; }
    boton.disabled = false;
  });

  // ---------- Confirmar el correo de una cuenta nueva ----------
  const panelConf = $('#panelConfirmar'), casConf = [...document.querySelectorAll('#casillasConf input')];
  let datosRegistro = null, relojConf = null, confirmando = false;
  function abrirConfirmar(datos) {
    datosRegistro = datos;
    document.querySelector('.acceso:not(.recuperar):not(.confirmar)').hidden = true;
    panelConf.hidden = false;
    panelConf.classList.remove('entra'); void panelConf.offsetWidth; panelConf.classList.add('paso-rec', 'entra');
    $('#explicaConfirmar').textContent = `Te mandamos un código de 6 números a ${datos.correo}. Puede tardar un minuto; revisa también la carpeta de spam.`;
    casConf.forEach(c => { c.value = ''; c.classList.remove('lleno'); });
    $('#casillasConf').classList.remove('bien', 'mal');
    $('#errorConfirmar').textContent = '';
    contarReenvio($('#reenviarConfirmar'), relojConf, r => relojConf = r);
    setTimeout(() => casConf[0].focus(), 60);
  }
  function contarReenvio(boton, anterior, guardarReloj) {
    clearInterval(anterior);
    let falta = 60;
    boton.disabled = true; boton.textContent = `Reenviar código en ${falta} s`;
    guardarReloj(setInterval(() => {
      falta--;
      if (falta <= 0) { clearInterval(relojConf); boton.disabled = false; boton.textContent = 'Reenviar código'; }
      else boton.textContent = `Reenviar código en ${falta} s`;
    }, 1000));
  }
  $('#volverRegistro').addEventListener('click', () => {
    panelConf.hidden = true;
    document.querySelector('.acceso:not(.recuperar):not(.confirmar)').hidden = false;
    ponerModo('registro');
  });
  $('#reenviarConfirmar').addEventListener('click', async () => {
    try { await api('/api/registro', { method: 'POST', body: JSON.stringify(datosRegistro) }); avisar('Te mandamos un código nuevo.'); abrirConfirmar(datosRegistro); }
    catch (err) { $('#errorConfirmar').textContent = err.message; }
  });
  casConf.forEach((c, i) => {
    c.addEventListener('input', () => {
      const cifras = c.value.replace(/\D/g, '');
      if (cifras.length > 1) { repartirConf(cifras, i); return; }
      c.value = cifras; c.classList.toggle('lleno', !!cifras);
      $('#casillasConf').classList.remove('mal');
      if (cifras && i < 5) casConf[i + 1].focus();
      if (casConf.every(x => x.value)) confirmarCodigo();
    });
    c.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !c.value && i > 0) { casConf[i - 1].focus(); casConf[i - 1].value = ''; casConf[i - 1].classList.remove('lleno'); }
      if (e.key === 'Enter') confirmarCodigo();
    });
    c.addEventListener('paste', e => { e.preventDefault(); repartirConf((e.clipboardData.getData('text') || '').replace(/\D/g, ''), 0); });
  });
  function repartirConf(cifras, desde) {
    $('#casillasConf').classList.remove('mal');
    [...cifras.slice(0, 6 - desde)].forEach((d, k) => { casConf[desde + k].value = d; casConf[desde + k].classList.add('lleno'); });
    casConf[Math.min(5, desde + cifras.length)].focus();
    if (casConf.every(x => x.value)) confirmarCodigo();
  }
  async function confirmarCodigo() {
    if (confirmando) return;
    const codigo = casConf.map(c => c.value).join(''), caja = $('#casillasConf'), error = $('#errorConfirmar');
    if (codigo.length < 6) { error.textContent = 'Escribe los 6 números del correo.'; return; }
    confirmando = true; error.textContent = '';
    try {
      await api('/api/registro/confirmar', { method: 'POST', body: JSON.stringify({ correo: datosRegistro.correo, codigo }) });
      caja.classList.add('bien');
      setTimeout(async () => {
        panelConf.hidden = true; document.querySelector('.acceso:not(.recuperar):not(.confirmar)').hidden = false;
        await cargarCuenta(); avisar('¡Listo! Tu correo quedó confirmado y tu cuenta está creada.');
      }, quieto ? 0 : 650);
    } catch (err) {
      error.textContent = err.message;
      caja.classList.add('mal'); caja.classList.remove('tiembla'); void caja.offsetWidth; caja.classList.add('tiembla');
      casConf.forEach(c => { c.value = ''; c.classList.remove('lleno'); });
      casConf[0].focus();
    }
    confirmando = false;
  }
  $('#botonConfirmar').addEventListener('click', confirmarCodigo);

  // ---------- Recuperar la contraseña: correo, código y contraseña nueva ----------
  const panelAcceso = document.querySelector('.acceso:not(.recuperar):not(.confirmar)'), panelRec = $('#panelRecuperar');
  const casillas = [...document.querySelectorAll('#casillas input')];
  let pasoRec = 1, correoRec = '', codigoRec = '', relojReenvio = null;
  function irAPaso(n) {
    const atras = n < pasoRec;
    pasoRec = n;
    panelRec.querySelectorAll('.paso-rec').forEach(p => {
      const este = +p.dataset.paso === n;
      p.hidden = !este;
      p.classList.remove('entra', 'entra-atras');
      if (este) { void p.offsetWidth; p.classList.add(atras ? 'entra-atras' : 'entra'); }
    });
    panelRec.querySelectorAll('.indicador li').forEach((li, i) => { li.className = i + 1 < n ? 'hecho' : i + 1 === n ? 'ahora' : ''; });
    panelRec.querySelector('.indicador').style.setProperty('--lleno', Math.min(1, (n - 1) / 2));
    panelRec.querySelectorAll('.error').forEach(e => e.textContent = '');
  }
  function abrirRecuperar() {
    panelAcceso.hidden = true; panelRec.hidden = false;
    $('#recCorreo').value = forma.correo.value.trim();
    irAPaso(1); $('#recCorreo').focus();
  }
  function cerrarRecuperar() { panelRec.hidden = true; panelAcceso.hidden = false; ponerModo('entrar'); }
  $('#olvido').addEventListener('click', abrirRecuperar);
  $('#volverEntrar').addEventListener('click', () => pasoRec === 2 ? irAPaso(1) : pasoRec === 3 ? irAPaso(2) : cerrarRecuperar());

  function cuentaReenvio() {
    let falta = 60;
    const b = $('#recReenviar');
    clearInterval(relojReenvio);
    b.disabled = true; b.textContent = `Reenviar código en ${falta} s`;
    relojReenvio = setInterval(() => {
      falta--;
      if (falta <= 0) { clearInterval(relojReenvio); b.disabled = false; b.textContent = 'Reenviar código'; }
      else b.textContent = `Reenviar código en ${falta} s`;
    }, 1000);
  }
  async function enviarCodigo(boton, error) {
    boton.disabled = true; error.textContent = '';
    try {
      await api('/api/recuperar', { method: 'POST', body: JSON.stringify({ correo: correoRec }) });
      $('#recExplica2').textContent = `Te mandamos un código a ${correoRec}. Puede tardar un minuto; revisa también la carpeta de spam.`;
      casillas.forEach(c => { c.value = ''; c.classList.remove('lleno'); });
      $('#casillas').classList.remove('bien', 'mal');
      cuentaReenvio();
      return true;
    } catch (err) { error.textContent = err.message; return false; }
    finally { boton.disabled = false; }
  }
  $('#recEnviar').addEventListener('click', async e => {
    correoRec = $('#recCorreo').value.trim().toLowerCase();
    if (!correoRec) { $('#recError1').textContent = 'Escribe tu correo.'; return; }
    if (await enviarCodigo(e.currentTarget, $('#recError1'))) { irAPaso(2); setTimeout(() => casillas[0].focus(), 60); }
  });
  $('#recCorreo').addEventListener('keydown', e => { if (e.key === 'Enter') $('#recEnviar').click(); });
  $('#recReenviar').addEventListener('click', async e => { if (await enviarCodigo(e.currentTarget, $('#recError2'))) avisar('Te mandamos un código nuevo.'); });

  // Casillas del código: una cifra por casilla, salta sola y acepta pegar el código entero.
  casillas.forEach((c, i) => {
    c.addEventListener('input', () => {
      const cifras = c.value.replace(/\D/g, '');
      if (cifras.length > 1) { repartir(cifras, i); return; }
      c.value = cifras; c.classList.toggle('lleno', !!cifras);
      $('#casillas').classList.remove('mal');
      if (cifras && i < 5) casillas[i + 1].focus();
      if (casillas.every(x => x.value)) comprobar();
    });
    c.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !c.value && i > 0) { casillas[i - 1].focus(); casillas[i - 1].value = ''; casillas[i - 1].classList.remove('lleno'); }
      if (e.key === 'ArrowLeft' && i > 0) casillas[i - 1].focus();
      if (e.key === 'ArrowRight' && i < 5) casillas[i + 1].focus();
      if (e.key === 'Enter') comprobar();
    });
    c.addEventListener('paste', e => { e.preventDefault(); repartir((e.clipboardData.getData('text') || '').replace(/\D/g, ''), 0); });
  });
  function repartir(cifras, desde) {
    $('#casillas').classList.remove('mal');
    [...cifras.slice(0, 6 - desde)].forEach((d, k) => { casillas[desde + k].value = d; casillas[desde + k].classList.add('lleno'); });
    casillas[Math.min(5, desde + cifras.length)].focus();
    if (casillas.every(x => x.value)) comprobar();
  }
  let comprobando = false;
  async function comprobar() {
    if (comprobando) return;
    const codigo = casillas.map(c => c.value).join(''), caja = $('#casillas'), error = $('#recError2');
    if (codigo.length < 6) { error.textContent = 'Escribe los 6 números del correo.'; return; }
    comprobando = true; error.textContent = '';
    try {
      await api('/api/recuperar/verificar', { method: 'POST', body: JSON.stringify({ correo: correoRec, codigo }) });
      codigoRec = codigo;
      caja.classList.add('bien');
      setTimeout(() => { irAPaso(3); $('#recClave').focus(); }, quieto ? 0 : 520);
    } catch (err) {
      error.textContent = err.message;
      caja.classList.add('mal'); caja.classList.remove('tiembla'); void caja.offsetWidth; caja.classList.add('tiembla');
      casillas.forEach(c => { c.value = ''; c.classList.remove('lleno'); });
      casillas[0].focus();
    }
    comprobando = false;
  }
  $('#recComprobar').addEventListener('click', comprobar);

  // Contraseña nueva con barra de fuerza
  const fuerza = clave => {
    let puntos = 0;
    if (clave.length >= 8) puntos++;
    if (clave.length >= 12) puntos++;
    if (/[a-zñ]/.test(clave) && /[A-ZÑ]/.test(clave)) puntos++;
    if (/\d/.test(clave)) puntos++;
    if (/[^\wñÑ]/.test(clave)) puntos++;
    return clave.length < 8 ? Math.min(puntos, 1) : puntos;
  };
  $('#recClave').addEventListener('input', e => {
    const p = fuerza(e.target.value), barra = $('#recFuerza');
    barra.style.transform = `scaleX(${p / 5})`;
    barra.style.backgroundColor = p <= 1 ? 'var(--malo)' : p <= 3 ? 'var(--oro)' : '#5ad37a';
    pintarReglas($('#reqRec'), e.target.value);
    $('#recPista').textContent = claveValida(e.target.value) ? (p >= 5 ? 'Muy segura.' : 'Cumple todas las reglas.') : 'Debe cumplir estas reglas:';
  });
  $('#recOjo').addEventListener('click', e => {
    const ver = $('#recClave').type === 'password';
    $('#recClave').type = $('#recClave2').type = ver ? 'text' : 'password';
    e.currentTarget.textContent = ver ? 'Ocultar' : 'Ver';
    e.currentTarget.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña');
  });
  $('#recGuardar').addEventListener('click', async e => {
    const boton = e.currentTarget, clave = $('#recClave').value, error = $('#recError3');
    if (!claveValida(clave)) { error.textContent = 'La contraseña todavía no cumple todas las reglas.'; avisarReglas($('#reqRec')); return; }
    if (clave !== $('#recClave2').value) { error.textContent = 'Las dos contraseñas no son iguales.'; return; }
    boton.disabled = true;
    try {
      await api('/api/recuperar/cambiar', { method: 'POST', body: JSON.stringify({ correo: correoRec, codigo: codigoRec, clave }) });
      irAPaso(4);
      setTimeout(async () => { await cargarCuenta(); panelRec.hidden = true; panelAcceso.hidden = false; avisar('Listo, cambiaste tu contraseña.'); }, quieto ? 600 : 1900);
    } catch (err) {
      error.textContent = err.message;
      if (/venció|nuevo/.test(err.message)) setTimeout(() => irAPaso(1), 1800);
    }
    boton.disabled = false;
  });
  $('#salir').addEventListener('click', async () => { await api('/api/salir', { method: 'POST' }).catch(() => {}); usuario = null; mostrar(); });

  async function cargarCuenta() {
    try {
      const r = await api('/api/yo');
      usuario = r.usuario; proveedores = r.proveedores;
    } catch { usuario = null; }
    $('#conGoogle').hidden = !proveedores.google;
    $('#conGithub').hidden = !proveedores.github;
    $('#separador').hidden = !(proveedores.google || proveedores.github);
    ponerModo(modo);
    mostrar();
  }
  // ---------- Dos páginas: «Crear video» (/) y «Mi almacén» (/almacen) ----------
  const vistaActual = () => location.pathname.startsWith('/almacen') ? 'almacen' : 'crear';
  function pintarVista(animar) {
    const vista = vistaActual();
    $('#pestanasSitio').hidden = !usuario;
    const crear = $('#estudio'), almacen = $('#vistaAlmacen');
    crear.hidden = !usuario || vista !== 'crear';
    almacen.hidden = !usuario || vista !== 'almacen';
    document.querySelectorAll('#pestanasSitio a').forEach(a => a.dataset.vista === vista ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
    const visible = vista === 'crear' ? crear : almacen;
    if (animar && usuario) { visible.classList.remove('vista-entra'); void visible.offsetWidth; visible.classList.add('vista-entra'); }
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-vista]');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    if (vistaActual() !== a.dataset.vista) { history.pushState(null, '', a.getAttribute('href')); pintarVista(true); scrollTo({ top: 0 }); }
  });
  addEventListener('popstate', () => pintarVista(true));

  function mostrar() {
    $('#portada').hidden = !!usuario;
    pintarVista(false);
    $('#usuario').hidden = !usuario;
    if (!usuario) return;
    $('#nombreUsuario').textContent = usuario.nombre;
    const foto = $('#fotoUsuario');
    if (usuario.foto && /^https:\/\//.test(usuario.foto)) { foto.style.backgroundImage = `url("${usuario.foto.replace(/"/g, '')}")`; foto.textContent = ''; }
    else { foto.style.backgroundImage = ''; foto.textContent = usuario.nombre[0].toUpperCase(); }
    revisar();
  }

  // ---------- Voces y duración ----------
  let voces = [], elegidas = JSON.parse(leer('voces-elegidas') || '["filo","dazai"]'), minutos = +(leer('minutos') || 2);
  const muestra = new Audio();
  async function cargarVoces() {
    voces = await api('/api/voces').catch(() => []);
    elegidas = elegidas.filter(c => voces.some(v => v.clave === c));
    if (!elegidas.length && voces.length) elegidas = [voces[0].clave];
    const caja = $('#voces');
    caja.innerHTML = voces.map(v => `<span class="voz" data-clave="${v.clave}">
      <button type="button" class="elegir" aria-pressed="false"><i style="background:${escapar(v.color)}">${escapar(v.nombre[0])}</i>${escapar(v.nombre)}<span class="visto">✓</span></button>
      <button type="button" class="oir" aria-label="Escuchar a ${escapar(v.nombre)}">▶</button></span>`).join('');
    caja.querySelectorAll('.voz').forEach(el => {
      const clave = el.dataset.clave;
      el.querySelector('.elegir').addEventListener('click', () => {
        if (elegidas.includes(clave)) { if (elegidas.length > 1) elegidas = elegidas.filter(c => c !== clave); }
        else { elegidas.push(clave); if (elegidas.length > 2) elegidas.shift(); }
        guardar('voces-elegidas', JSON.stringify(elegidas));
        pintarVoces(clave);
      });
      el.querySelector('.oir').addEventListener('click', () => {
        document.querySelectorAll('.voz.sonando').forEach(x => x.classList.remove('sonando'));
        if (!muestra.paused && muestra.dataset.clave === clave) { muestra.pause(); return; }
        muestra.src = `/recursos/voces/${clave}.mp3`; muestra.dataset.clave = clave;
        muestra.play().then(() => el.classList.add('sonando')).catch(() => avisar('No se pudo reproducir la muestra.', true));
      });
    });
    muestra.onended = muestra.onpause = () => document.querySelectorAll('.voz.sonando').forEach(x => x.classList.remove('sonando'));
    pintarVoces();
  }
  function pintarVoces(tocada) {
    document.querySelectorAll('.voz').forEach(el => {
      const si = elegidas.includes(el.dataset.clave);
      el.classList.toggle('elegida', si);
      el.querySelector('.elegir').setAttribute('aria-pressed', si);
      if (tocada === el.dataset.clave && si) { el.classList.remove('salta'); void el.offsetWidth; el.classList.add('salta'); chispas(el); }
    });
    resumen(!!tocada);
  }
  const botonesMin = [...document.querySelectorAll('#duracion button')], dorada = $('#duracion .marca-dorada');
  function pintarMinutos(animar) {
    botonesMin.forEach((b, i) => {
      const si = +b.dataset.min === minutos;
      b.setAttribute('aria-pressed', si);
      if (si) dorada.style.transform = `translateX(${i * 100}%)`;
    });
    if (animar) { dorada.classList.remove('estira'); void dorada.offsetWidth; dorada.classList.add('estira'); }
    resumen(animar);
    pintarCapturas();
  }
  botonesMin.forEach(b => b.addEventListener('click', () => { minutos = +b.dataset.min; guardar('minutos', minutos); pintarMinutos(true); }));
  function resumen(animar) {
    const nombres = elegidas.map(c => (voces.find(v => v.clave === c) || {}).nombre).filter(Boolean);
    const r = $('#resumen');
    r.textContent = nombres.length ? `Video de ${minutos} min contado por ${nombres.join(' y ')}.` : '';
    if (animar) { r.classList.remove('cambia'); void r.offsetWidth; r.classList.add('cambia'); }
  }

  // ---------- Capturas propias (opcional) ----------
  let LIMITES = { 1: 4, 2: 6, 3: 8, 5: 12 }, MEGAS = 8;
  api('/api/limites').then(r => { LIMITES = r.capturas; MEGAS = r.megas; pintarCapturas(); }).catch(() => {});
  let capturas = [];   // { archivo, url }
  const zona = $('#zonaSubir'), entrada = $('#archivoCapturas');
  function agregarCapturas(lista) {
    const error = $('#errorVideo');
    error.textContent = '';
    for (const archivo of lista) {
      if (!/^image\/(png|jpeg|webp)$/.test(archivo.type)) { error.textContent = `«${archivo.name}» no es una imagen JPG, PNG o WEBP.`; continue; }
      if (archivo.size > MEGAS * 1024 * 1024) { error.textContent = `«${archivo.name}» pesa más de ${MEGAS} MB.`; continue; }
      if (capturas.some(c => c.archivo.name === archivo.name && c.archivo.size === archivo.size)) continue;
      capturas.push({ archivo, url: URL.createObjectURL(archivo) });
    }
    pintarCapturas();
  }
  function pintarCapturas() {
    const limite = LIMITES[minutos] || 6, caja = $('#miniaturas'), texto = $('#limiteCapturas');
    caja.innerHTML = '';
    capturas.forEach((c, i) => {
      const m = document.createElement('div');
      m.className = 'mini' + (i >= limite ? ' sobra' : '');
      m.style.backgroundImage = `url("${c.url}")`;
      m.innerHTML = `<b>${i + 1}</b><button type="button" aria-label="Quitar captura ${i + 1}">✕</button>`;
      m.querySelector('button').addEventListener('click', () => { URL.revokeObjectURL(c.url); capturas.splice(i, 1); pintarCapturas(); });
      caja.appendChild(m);
    });
    const sobran = capturas.length - limite;
    texto.classList.toggle('pasado', sobran > 0);
    texto.textContent = sobran > 0 ? `Sobran ${sobran}: hasta ${limite} para ${minutos} min` : capturas.length ? `${capturas.length} de ${limite} para ${minutos} min` : `Hasta ${limite} para ${minutos} min`;
    $('#pistaSubir').hidden = capturas.length > 0;
  }
  $('#botonSubir').addEventListener('click', () => entrada.click());
  entrada.addEventListener('change', () => { agregarCapturas([...entrada.files]); entrada.value = ''; });
  let arrastres = 0;
  const formVideo = $('#formVideo');
  formVideo.addEventListener('dragenter', e => { if ([...e.dataTransfer.types].includes('Files')) { arrastres++; zona.classList.add('arrastrando'); } });
  formVideo.addEventListener('dragleave', () => { arrastres = Math.max(0, arrastres - 1); if (!arrastres) zona.classList.remove('arrastrando'); });
  formVideo.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  formVideo.addEventListener('drop', e => {
    e.preventDefault(); arrastres = 0; zona.classList.remove('arrastrando');
    agregarCapturas([...e.dataTransfer.files]);
  });
  // Pegar una captura con Ctrl+V dentro del formulario
  formVideo.addEventListener('paste', e => {
    const imagenes = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
    if (imagenes.length) { e.preventDefault(); agregarCapturas(imagenes); }
  });

  // Con capturas se manda como formulario, mostrando cuánto se ha subido en el botón.
  function enviarConCapturas(datos, boton) {
    return new Promise((resolver, rechazar) => {
      const forma = new FormData();
      forma.append('datos', JSON.stringify(datos));
      capturas.forEach(c => forma.append('capturas', c.archivo, c.archivo.name));
      const x = new XMLHttpRequest();
      const llenado = boton.querySelector('.llenado'), texto = boton.querySelector('span');
      x.upload.onprogress = e => { if (e.lengthComputable) { const p = Math.round(e.loaded / e.total * 100); llenado.style.width = p + '%'; texto.textContent = `Subiendo ${p} %`; } };
      x.onload = () => {
        let r = {};
        try { r = JSON.parse(x.responseText); } catch {}
        x.status < 300 ? resolver(r) : rechazar(new Error(r.error || 'No se pudieron subir las capturas.'));
      };
      x.onerror = () => rechazar(new Error('Se cortó la conexión mientras se subían las capturas. Revisa tu internet.'));
      x.open('POST', '/api/videos');
      x.send(forma);
    }).finally(() => { boton.querySelector('.llenado').style.width = ''; boton.querySelector('span').textContent = 'Crear video'; });
  }

  // ---------- Pedir un video ----------
  $('#formVideo').addEventListener('submit', async e => {
    e.preventDefault();
    abrirAudio();
    const boton = e.target.querySelector('.crear'), error = $('#errorVideo');
    const enlace = $('#enlace').value.trim();
    error.textContent = '';
    if (!enlace) { error.textContent = 'Pega el enlace de una página web.'; $('#enlace').focus(); return; }
    const limite = LIMITES[minutos] || 6;
    if (capturas.length > limite) { error.textContent = `Para ${minutos} min puedes subir hasta ${limite} capturas. Quita ${capturas.length - limite}.`; return; }
    boton.disabled = true; boton.classList.add(capturas.length ? 'subiendo' : 'enviando');
    try {
      const datos = { enlace, voces: elegidas, minutos };
      if (capturas.length) await enviarConCapturas(datos, boton);
      else await api('/api/videos', { method: 'POST', body: JSON.stringify(datos) });
      capturas.forEach(c => URL.revokeObjectURL(c.url)); capturas = []; pintarCapturas();
      $('#enlace').value = '';
      avisar('¡Pedido! Puedes cerrar la página: el video sigue creándose.');
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
      await revisar();
    } catch (err) { error.textContent = err.message; }
    setTimeout(() => boton.classList.remove('enviando', 'subiendo'), 600);
    boton.disabled = false;
  });

  // ---------- Ver el avance y el almacén ----------
  const PASOS = ['Visitar', 'Guion', 'Voces', 'Armar', 'Listo'];
  const pasoDe = fase => /Visitando/.test(fase) ? 0 : /guion/.test(fase) ? 1 : /voces/.test(fase) ? 2 : /Listo/.test(fase) ? 4 : /escenas|música|Armando/.test(fase) ? 3 : -1;
  const estadosPrevios = JSON.parse(leer('estados') || '{}');
  let espera = null;
  const sitio = enlace => { try { return new URL(enlace).hostname.replace(/^www\./, ''); } catch { return enlace; } };
  const nombreVoces = texto => texto.split(',').map(c => (voces.find(v => v.clave === c) || { nombre: c }).nombre).join(' y ');
  const hace = s => { const m = Math.round((Date.now() / 1000 - s) / 60); return m < 1 ? 'hace un momento' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días`; };
  const fecha = s => new Date(s * 1000).toLocaleString('es-PE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const reloj = s =>`${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

  async function revisar() {
    clearTimeout(espera);
    if (!usuario) return;
    let r;
    try { r = await api('/api/videos'); }
    catch (err) {
      if (err.estado === 401) { usuario = null; mostrar(); return; }
      espera = setTimeout(revisar, 8000); return;
    }
    const enCurso = r.videos.filter(v => ['preparando', 'en_fila', 'trabajando', 'error'].includes(v.estado));
    const listos = r.videos.filter(v => v.estado === 'listo');
    pintarEnCurso(enCurso, r.limite);
    pintarEspacio(r.usado, r.cuota);
    pintarAlmacen(listos, r.guardados_max);
    // Avisar una sola vez por video, aunque haya varias pestañas abiertas
    r.videos.forEach(v => {
      const antes = estadosPrevios[v.id];
      if (antes && antes !== v.estado && (v.estado === 'listo' || v.estado === 'error') && !leer('avisado-' + v.id)) {
        guardar('avisado-' + v.id, '1');
        if (v.estado === 'listo') {
          campanita(); avisar(`¡Tu video de ${v.titulo || sitio(v.enlace)} está listo! Míralo en «Mi almacén».`);
          if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification('Tu video está listo', { body: v.titulo || sitio(v.enlace) });
          const tarjeta = document.querySelector(`.guardado[data-id="${v.id}"]`);
          if (tarjeta) estrellitas(tarjeta);
        } else { sonidoError(); avisar(`No se pudo crear el video de ${sitio(v.enlace)}: ${v.mensaje}`, true); }
      }
      estadosPrevios[v.id] = v.estado;
    });
    guardar('estados', JSON.stringify(estadosPrevios));
    const activos = enCurso.filter(v => v.estado !== 'error').length;
    document.title = activos ? `(${activos}) Creando video… · Explícame la página` : 'Explícame la página';
    espera = setTimeout(revisar, activos ? (document.hidden ? 6000 : 2000) : 20000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) revisar(); });

  function pintarEnCurso(lista, limite) {
    const caja = $('#enCurso');
    $('#nadaEnCurso').hidden = lista.length > 0;
    const activos = lista.filter(v => v.estado !== 'error').length;
    $('#cupos').textContent = `${activos} de ${limite}`;
    const vistos = new Set();
    lista.forEach(v => {
      vistos.add(v.id);
      let t = caja.querySelector(`[data-id="${v.id}"]`);
      if (!t) {
        t = document.createElement('article'); t.className = 'trabajo'; t.dataset.id = v.id;
        t.innerHTML = `<div class="arriba"><span class="sitio"></span><span><span class="porcentaje"></span><button class="quitar" aria-label="Cancelar">✕</button></span></div>
          <div class="barra"><i></i></div><div class="fase"><span class="texto"></span><span class="detalle"></span></div>
          <div class="pasitos">${PASOS.map(p => `<span>${p}</span>`).join('')}</div><div class="acciones" hidden></div>`;
        t.querySelector('.quitar').addEventListener('click', () => quitar(v.id, t.classList.contains('fallo')));
        caja.appendChild(t);
      }
      const fallo = v.estado === 'error', fila = v.estado === 'en_fila' || v.estado === 'preparando';
      t.classList.toggle('fallo', fallo); t.classList.toggle('esperando', fila);
      t.querySelector('.sitio').textContent = `${sitio(v.enlace)} · ${v.minutos} min · ${nombreVoces(v.voces)}`;
      t.querySelector('.porcentaje').textContent = fallo ? 'Error' : fila ? 'En fila' : Math.round(v.avance) + ' %';
      t.querySelector('.barra i').style.width = (fallo ? 100 : v.avance) + '%';
      t.querySelector('.barra').hidden = fallo;
      t.querySelector('.texto').textContent = fallo ? v.mensaje : fila ? (v.mensaje || 'Esperando turno') : v.fase;
      t.querySelector('.detalle').textContent = fallo || fila ? '' : (v.mensaje || '');
      const paso = pasoDe(v.fase || '');
      t.querySelectorAll('.pasitos span').forEach((s, i) => { s.className = i < paso ? 'hecho' : i === paso && !fallo ? 'ahora' : ''; });
      t.querySelector('.pasitos').hidden = fallo;
      const acciones = t.querySelector('.acciones');
      acciones.hidden = !fallo;
      if (fallo && !acciones.childElementCount) {
        acciones.innerHTML = '<button class="principal">Intentar de nuevo</button><button class="secundario">Quitar</button>';
        acciones.firstChild.addEventListener('click', async () => {
          try { await api(`/api/videos/${v.id}/reintentar`, { method: 'POST' }); localStorage.removeItem('avisado-' + v.id); revisar(); }
          catch (err) { avisar(err.message, true); }
        });
        acciones.lastChild.addEventListener('click', () => quitar(v.id, true));
      }
      if (!fallo) acciones.innerHTML = '';
    });
    caja.querySelectorAll('.trabajo').forEach(t => { if (!vistos.has(t.dataset.id)) t.remove(); });
  }

  async function quitar(id, sinPreguntar) {
    if (!sinPreguntar && !confirm('¿Cancelar este video? Se pierde lo que lleva hecho.')) return;
    try { await api(`/api/videos/${id}`, { method: 'DELETE' }); revisar(); } catch (err) { avisar(err.message, true); }
  }

  // Espacio propio de cada usuario en el almacén
  const megas = b => b >= 1e9 ? `${(b / 1e9).toFixed(1).replace('.0', '')} GB` : `${Math.round(b / 1e6)} MB`;
  function pintarEspacio(usado, cuota) {
    if (!cuota) return;
    const parte = Math.min(1, usado / cuota), barra = $('#barraEspacio');
    $('#espacio').hidden = false;
    barra.style.transform = `scaleX(${parte})`;
    barra.classList.toggle('lleno', parte >= .9);
    barra.parentElement.setAttribute('aria-valuenow', Math.round(parte * 100));
    $('#textoEspacio').textContent = `Usaste ${megas(usado)} de ${megas(cuota)}` + (parte >= .9 ? ' · casi lleno: borra algún video para seguir creando' : '');
  }

  function pintarAlmacen(lista, maximo) {
    const caja = $('#guardados');
    $('#almacenVacio').hidden = lista.length > 0;
    $('#cuentaAlmacen').textContent = lista.length ? `${lista.length} de ${maximo}` : '';
    const numero = $('#numeroAlmacen'), antes = +numero.textContent || 0;
    numero.textContent = lista.length || '';
    if (lista.length > antes && antes) { numero.classList.remove('salta'); void numero.offsetWidth; numero.classList.add('salta'); }
    const vistos = new Set();
    lista.forEach((v, i) => {
      vistos.add(v.id);
      if (caja.querySelector(`[data-id="${v.id}"]`)) return;
      const t = document.createElement('article'); t.className = 'guardado'; t.dataset.id = v.id;
      t.style.animationDelay = Math.min(i, 8) * .05 + 's';
      t.innerHTML = `<button class="miniatura" style="background-image:url('/api/videos/${v.id}/portada')" aria-label="Ver video">
          <span class="duracion-video">${reloj(v.duracion || 0)}</span></button>
        <div class="info"><b>${escapar(v.titulo || sitio(v.enlace))}</b><small>${escapar(sitio(v.enlace))} · ${escapar(nombreVoces(v.voces))}</small>
        <time class="fecha" datetime="${new Date(v.creado * 1000).toISOString()}">Creado el ${fecha(v.creado)}</time>
        <div class="botones"><a href="/api/videos/${v.id}/archivo?descargar=1">Descargar</a><button class="secundario" aria-label="Borrar">Borrar</button></div></div>`;
      t.querySelector('.miniatura').addEventListener('click', () => ver(v));
      t.querySelector('.secundario').addEventListener('click', async () => {
        if (!confirm('¿Borrar este video de tu almacén? No se puede deshacer.')) return;
        try { await api(`/api/videos/${v.id}`, { method: 'DELETE' }); t.remove(); revisar(); } catch (err) { avisar(err.message, true); }
      });
      caja.appendChild(t);
    });
    caja.querySelectorAll('.guardado').forEach(t => { if (!vistos.has(t.dataset.id)) t.remove(); });
    // Mismo orden que el servidor (el más nuevo primero); solo se mueve si cambió.
    const orden = lista.map(v => v.id);
    if ([...caja.children].map(t => t.dataset.id).join() !== orden.join()) orden.forEach(id => caja.appendChild(caja.querySelector(`[data-id="${id}"]`)));
  }

  const visor = $('#visor'), reproductor = $('#reproductor');
  function ver(v) {
    reproductor.src = `/api/videos/${v.id}/archivo`;
    $('#visorTitulo').textContent = v.titulo || sitio(v.enlace);
    $('#visorDescargar').href = `/api/videos/${v.id}/archivo?descargar=1`;
    visor.showModal(); reproductor.play().catch(() => {});
  }
  const cerrarVisor = () => { reproductor.pause(); visor.close(); };
  $('#cerrarVisor').addEventListener('click', cerrarVisor);
  visor.addEventListener('click', e => { if (e.target === visor) cerrarVisor(); });
  visor.addEventListener('close', () => reproductor.pause());

  // Al volver de Google o GitHub con un aviso
  const aviso = new URLSearchParams(location.search).get('aviso');
  if (aviso) { avisar(aviso, true); history.replaceState(null, '', '/'); }
  // Otra pestaña cambió algo: revisar enseguida
  addEventListener('storage', e => { if (e.key === 'estados' && usuario) { clearTimeout(espera); espera = setTimeout(revisar, 300); } });

  cargarVoces().then(() => pintarMinutos(false));
  cargarCuenta();
})();
