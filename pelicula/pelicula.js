// Plantilla del video: arma las escenas con los datos del guion (window.DATOS) y dibuja
// cualquier segundo con pelicula.paso(segundo). Todo sale de cuentas fijas, así que
// el mismo segundo siempre da el mismo cuadro.
(() => {
  const D = window.DATOS;
  const CAPTURAS = D.capturas || 'capturas/';
  const TRANSICION = 0.75;
  const PRESENTADORAS = D.presentadoras;
  const lienzo = document.getElementById('lienzo');
  document.documentElement.style.cssText = `--claro:${D.colores[0]};--oscuro:${D.colores[1]};--acento:${D.colores[2]}`;

  const $ = (padre, etiqueta, clase, html) => {
    const e = document.createElement(etiqueta);
    if (clase) e.className = clase;
    if (html !== undefined) e.innerHTML = html;
    padre.appendChild(e);
    return e;
  };
  const limitar = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const tramo = (t, a, b) => limitar((t - a) / (b - a));
  const suave = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  const salida = x => 1 - Math.pow(1 - x, 3);
  const salto = x => { const c = 1.9; return x <= 0 ? 0 : x >= 1 ? 1 : 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  // Números «al azar» fijos por semilla (mulberry32): reparten bien aunque la semilla sea chica.
  const azar = s => () => {
    s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const escapar = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

  // ---------------- Fondos (dibujados en un lienzo, cuadro a cuadro) ----------------
  const [CLARO, OSCURO, ACENTO] = D.colores;
  const FONDOS = {
    aurora: { oscuro: true, dibujar(c, t, w, h) {
      c.fillStyle = '#071233'; c.fillRect(0, 0, w, h);
      c.globalCompositeOperation = 'lighter';
      [['#1c4fd8', .3, .4, .9], ['#13b5c8', .7, .3, .7], ['#7b5cff', .5, .8, .8], [ACENTO, .85, .85, .45], ['#3fa9ff', .15, .8, .6]].forEach(([col, x, y, r], i) => {
        const cx = w * (x + .14 * Math.sin(t * .35 + i * 2)), cy = h * (y + .12 * Math.cos(t * .28 + i));
        const g = c.createRadialGradient(cx, cy, 0, cx, cy, w * r * .6);
        g.addColorStop(0, col + '99'); g.addColorStop(1, col + '00'); c.fillStyle = g; c.fillRect(0, 0, w, h);
      });
      c.globalCompositeOperation = 'source-over';
    } },
    galaxia: { oscuro: true, dibujar(c, t, w, h, e) {
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#081a4a'); g.addColorStop(1, '#1b1060');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      [['#7b5cff', .25, .3], ['#1c8cff', .75, .65], [ACENTO, .6, .15]].forEach(([col, x, y], i) => {
        const n = c.createRadialGradient(w * x, h * y, 0, w * x, h * y, w * (i === 2 ? .2 : .45));
        n.addColorStop(0, col + (i === 2 ? '33' : '55')); n.addColorStop(1, col + '00'); c.fillStyle = n; c.fillRect(0, 0, w, h);
      });
      e.estrellas = e.estrellas || Array.from({ length: 420 }, (_, i) => { const r = azar(i + 9); return [r() * 2 - 1, r() * 2 - 1, r()]; });
      c.fillStyle = '#fff';
      e.estrellas.forEach(([x, y, z0], i) => {
        const z = 1 - ((z0 + t * .05) % 1), px = w / 2 + x / z * w * .25, py = h / 2 + y / z * h * .25;
        c.globalAlpha = Math.min(1, (1 - z) * 1.6) * (.7 + .3 * Math.sin(t * 5 + i));
        c.beginPath(); c.arc(px, py, (1 - z) * 4 + .4, 0, 7); c.fill();
      });
      c.globalAlpha = 1;
    } },
    olas: { oscuro: false, dibujar(c, t, w, h) {
      c.fillStyle = '#e9f1ff'; c.fillRect(0, 0, w, h);
      ['#cfe0ff', '#9fc1ff', '#5f93f5', '#2f68e6', '#1c4fd8', '#0d2a6e'].forEach((col, i) => {
        const base = h * (.3 + i * .13);
        c.beginPath(); c.moveTo(0, h);
        for (let x = 0; x <= w; x += 12) c.lineTo(x, base + Math.sin(x / w * 6 + t * (.5 + i * .12) + i) * h * .035 + Math.sin(x / w * 13 - t * .7) * h * .012);
        c.lineTo(w, h); c.closePath();
        c.shadowColor = 'rgba(0,0,0,.22)'; c.shadowBlur = 22; c.shadowOffsetY = -5; c.fillStyle = col; c.fill();
      });
      c.shadowColor = 'transparent';
    } },
    neon: { oscuro: true, dibujar(c, t, w, h) {
      const cielo = c.createLinearGradient(0, 0, 0, h * .6); cielo.addColorStop(0, '#0d1a4e'); cielo.addColorStop(1, '#4b33b8');
      c.fillStyle = cielo; c.fillRect(0, 0, w, h);
      const sx = w / 2, sy = h * .52, sr = h * .26;
      const sol = c.createLinearGradient(0, sy - sr, 0, sy); sol.addColorStop(0, '#ffe08a'); sol.addColorStop(1, ACENTO);
      c.save(); c.beginPath(); c.arc(sx, sy, sr, Math.PI, 0); c.clip(); c.fillStyle = sol; c.fillRect(sx - sr, sy - sr, sr * 2, sr);
      c.fillStyle = '#4b33b8'; for (let i = 0; i < 6; i++) c.fillRect(sx - sr, sy - sr * .1 - i * sr * .14, sr * 2, 3 + i);
      c.restore();
      c.fillStyle = '#0a1440'; c.fillRect(0, h * .52, w, h * .48);
      c.strokeStyle = '#3fd0ff'; c.lineWidth = 2; c.shadowColor = '#3fd0ff'; c.shadowBlur = 10;
      for (let i = -16; i <= 16; i++) { c.beginPath(); c.moveTo(w / 2 + i * w * .02, h * .52); c.lineTo(w / 2 + i * w * .16, h); c.stroke(); }
      for (let i = 0; i < 14; i++) { const k = ((i + t * .8) % 14) / 14, y = h * .52 + Math.pow(k, 2.2) * h * .48; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
      c.shadowBlur = 0;
    } },
    burbujas: { oscuro: true, dibujar(c, t, w, h, e) {
      const g = c.createLinearGradient(0, 0, w, h); g.addColorStop(0, OSCURO); g.addColorStop(1, CLARO);
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      e.burbujas = e.burbujas || Array.from({ length: 40 }, (_, i) => { const r = azar(i + 31); return [r(), r(), .03 + r() * .09, .015 + r() * .04, r() > .8]; });
      e.burbujas.forEach(([x, y, r, v, oro], i) => {
        const py = ((y - t * v) % 1 + 1) % 1 * (h * 1.2) - h * .1, px = w * x + Math.sin(t * .6 + i) * w * .02;
        const b = c.createRadialGradient(px, py, 0, px, py, r * w);
        const col = oro ? '245,184,61' : '255,255,255';
        b.addColorStop(0, `rgba(${col},.38)`); b.addColorStop(.7, `rgba(${col},.15)`); b.addColorStop(1, `rgba(${col},0)`);
        c.fillStyle = b; c.beginPath(); c.arc(px, py, r * w, 0, 7); c.fill();
      });
    } },
    comic: { oscuro: false, dibujar(c, t, w, h) {
      c.fillStyle = CLARO; c.fillRect(0, 0, w, h);
      c.save(); c.translate(w / 2, h / 2); c.rotate(t * .1); c.fillStyle = 'rgba(255,255,255,.16)';
      for (let i = 0; i < 20; i++) { c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, w, i * Math.PI / 10, i * Math.PI / 10 + Math.PI / 20); c.fill(); }
      c.restore();
      c.fillStyle = ACENTO; c.globalAlpha = .5;
      for (let y = 0; y < h; y += 22) for (let x = (y / 22 % 2) * 11; x < w; x += 22) {
        const d = Math.hypot(x - w * .88, y - h * .12) / w, r = Math.max(0, 7 - d * 13 + Math.sin(t * 2 + x * .02) * .6);
        if (r > .4) { c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); }
      }
      c.globalAlpha = 1;
    } },
    rayos: { oscuro: false, dibujar(c, t, w, h, e) {
      c.fillStyle = CLARO; c.fillRect(0, 0, w, h);
      c.save(); c.translate(w / 2, h / 2); c.rotate(t * .07); c.fillStyle = 'rgba(255,255,255,.17)';
      for (let i = 0; i < 18; i++) { c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, w * 1.2, i * Math.PI / 9, i * Math.PI / 9 + Math.PI / 18); c.fill(); }
      c.restore();
      e.aros = e.aros || Array.from({ length: 16 }, (_, i) => { const r = azar(i + 7); return [r() * w, r() * h, 40 + r() * 120, 10 + r() * 25, r() * 6, i % 3 === 0]; });
      e.aros.forEach(([x, y, tam, v, fase, llena]) => {
        const py = ((y - t * v) % (h + 160) + h + 160) % (h + 160) - 80, px = x + Math.sin(t * .4 + fase) * 40;
        c.globalAlpha = llena ? .22 : .14; c.beginPath(); c.arc(px, py, tam / 2, 0, 7);
        if (llena) { c.fillStyle = ACENTO; c.fill(); } else { c.lineWidth = 6; c.strokeStyle = OSCURO; c.stroke(); }
      });
      c.globalAlpha = 1;
    } },
  };
  const fondo = FONDOS[D.fondo] || FONDOS.rayos;
  // Los fondos que usan el color de la página eligen letras claras u oscuras según lo claro que sea ese color.
  const luz = hex => { const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16); return (0.299 * (n >> 16) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255; };
  const usaColorPagina = ['rayos', 'comic', 'burbujas'].includes(D.fondo);
  lienzo.classList.toggle('oscuro', usaColorPagina ? luz(D.fondo === 'burbujas' ? OSCURO : CLARO) < 0.55 : fondo.oscuro);
  const pincel = document.getElementById('fondo').getContext('2d');
  const estadoFondo = {};

  // ---------------- Letras animadas ----------------
  const SIGNOS = 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ0123456789#@$%&*';
  const ponerLetras = (padre, texto) => {
    const letras = [];
    texto.split(' ').forEach((palabra, i, todas) => {
      const p = $(padre, 'span', 'palabra');
      [...palabra].forEach(c => { const l = $(p, 'span', 'letra'); l.textContent = c; l.dataset.real = c; letras.push(l); });
      if (i < todas.length - 1) padre.appendChild(document.createTextNode(' '));
    });
    return letras;
  };
  const animarLetras = (letras, tipo, u, cursor) => {
    // u: segundos desde que empieza la animación
    const n = letras.length;
    letras.forEach((l, i) => {
      const d = i * (tipo === 'maquina' ? .045 : .04);
      const k = tramo(u, d, d + .55);
      let tr = '', op = k > 0 ? 1 : 0, filtro = '', sombra = '';
      if (tipo === 'cae') tr = `translateY(${(1 - salto(k)) * -140}px) rotate(${(1 - k) * 25}deg) scale(${.4 + .6 * k})`;
      else if (tipo === 'ola') { tr = `translateY(${(1 - salida(k)) * 60 + Math.sin(u * 4 - i * .5) * 6 * k}px)`; op = k; }
      else if (tipo === 'maquina') { op = u >= d ? 1 : 0; }
      else if (tipo === 'revuelto') {
        const fija = u > d + .45;
        l.textContent = fija || l.dataset.real === ' ' ? l.dataset.real : SIGNOS[Math.floor(azar(Math.floor(u * 18) * 31 + i)() * SIGNOS.length)];
        op = u > d * .4 ? 1 : 0;
      }
      else if (tipo === 'giro3d') { tr = `rotateX(${(1 - salida(k)) * -100}deg) translateY(${(1 - k) * 20}px)`; op = k > .05 ? 1 : 0; }
      else if (tipo === 'enfoque') { tr = `scale(${2.2 - 1.2 * salida(k)})`; filtro = `blur(${(1 - k) * 14}px)`; op = k; }
      else if (tipo === 'rebote') tr = `scale(${salto(k)}) translateY(${(1 - k) * 30}px)`;
      else if (tipo === 'brillo') {
        op = salida(k);
        const pasa = Math.max(0, 1 - Math.abs(u * 3 - i * .12 - 1.2) * 1.6);
        sombra = `0 0 ${10 + pasa * 30}px rgba(255,235,170,${.3 + pasa * .7})`;
        tr = `translateY(${(1 - k) * 16}px)`;
      }
      l.style.opacity = op; l.style.transform = tr; l.style.filter = filtro; l.style.textShadow = sombra;
    });
    if (cursor) {
      const escritas = letras.filter(l => l.style.opacity === '1').length;
      cursor.style.display = tipo === 'maquina' && u < n * .045 + 1.2 ? 'inline-block' : 'none';
      cursor.style.opacity = Math.floor(u * 3) % 2 || escritas < n ? 1 : 0;
      if (escritas && letras[escritas - 1]) letras[escritas - 1].after(cursor);
    }
  };

  // ---------------- Fondo y partículas comunes ----------------
  const trozos = palabras => {
    const salida = [];
    let actual = [];
    palabras.forEach((p, i) => {
      actual.push(i);
      const letras = actual.reduce((s, k) => s + palabras[k][0].length + 1, 0);
      if (letras > 48 || (letras > 26 && /[,.;:!?]$/.test(p[0])) || i === palabras.length - 1) { salida.push(actual); actual = []; }
    });
    return salida;
  };

  // ---------------- Construir escenas ----------------
  const escenas = D.escenas.map((s, n) => {
    const caja = $(document.getElementById('escenas'), 'div', 'escena');
    const v = { s, caja, trozos: trozos(s.palabras) };
    if (s.tipo === 'captura' || s.tipo === 'puntos') {
      const r = $(caja, 'div', 'rotulo');
      v.letras = ponerLetras(r, s.titulo);
      v.cursor = $(r, 'span', 'cursor-maquina');
    }
    if (s.tipo === 'captura') {
      const marco = $(caja, 'div', 'marco3d');
      v.nav = $(marco, 'div', 'navegador');
      $(v.nav, 'div', 'barra', `<b></b><b></b><b></b><span>${escapar(s.direccion)}</span>`);
      const vista = $(v.nav, 'div', 'vista');
      v.capa = $(vista, 'div', 'capa', `<img src="${CAPTURAS + s.imagen}">`);
      v.marcas = s.marcas.map(m => {
        const [x, y, w, h] = m.caja;
        const foco = $(v.capa, 'div', 'foco');
        Object.assign(foco.style, { left: x - 22 + 'px', top: y - 22 + 'px', width: w + 44 + 'px', height: h + 44 + 'px' });
        const anillo = $(v.capa, 'div', 'anillo');
        Object.assign(anillo.style, { left: x - 14 + 'px', top: y - 14 + 'px', width: w + 28 + 'px', height: h + 28 + 'px' });
        let nota = null;
        if (m.nota) {
          nota = $(v.capa, 'div', 'nota', escapar(m.nota));
          const arriba = y > 140;
          Object.assign(nota.style, { left: Math.min(1500, Math.max(20, x + w / 2 - 120)) + 'px', top: (arriba ? y - 110 : y + h + 30) + 'px' });
        }
        return { foco, anillo, nota };
      });
      v.reflejo = $(vista, 'div', 'reflejo');
      v.onda = $(vista, 'div', 'onda');
      v.cursor3 = $(vista, 'div', 'cursor', '<svg viewBox="0 0 64 64"><path d="M8 4 L8 52 L21 40 L30 60 L39 56 L30 37 L48 37 Z" fill="#fff" stroke="#111" stroke-width="4" stroke-linejoin="round"/></svg>');
    } else if (s.tipo === 'puntos') {
      const lista = $(caja, 'div', 'lista');
      lista.style.top = (s.puntos.length > 3 ? 170 : 210) + 'px';
      v.puntos = s.puntos.map(p => {
        const m = String(p).match(/^(\p{Extended_Pictographic}[️‍\p{Extended_Pictographic}]*)\s*(.*)$/u);
        return $(lista, 'div', 'punto', `<span class="icono">${m ? m[1] : '⭐'}</span><span>${escapar(m ? m[2] : p)}</span>`);
      });
    } else {
      const titulo = s.tipo === 'portada' ? D.titulo : s.titulo;
      v.grande = $(caja, 'div', 'grande');
      v.letras = ponerLetras(v.grande, titulo);
      v.cursor = $(v.grande, 'span', 'cursor-maquina');
      const larga = Math.max(...titulo.split(' ').map(p => p.length), 1);
      v.grande.style.fontSize = Math.min(150, Math.floor(860 / (larga * .66)), titulo.length > 14 ? 118 : 150) + 'px';
      v.lema = $(caja, 'div', 'lema', escapar(D.lema));
      v.ficha = $(caja, 'div', 'ficha', escapar(s.tipo === 'portada' ? s.titulo : (s.direccion || '').replace(/^https?:\/\//, '').replace(/\/$/, '')));
      v.foto = $(caja, 'div', 'foto', `<img src="${CAPTURAS + s.imagen}">`);
      const rr = azar(n + 3);
      v.chispas = Array.from({ length: 8 }, () => ({ e: $(caja, 'div', 'chispa'), x: 980 + rr() * 880, y: 160 + rr() * 760, f: rr() * 3 }));
      if (s.tipo === 'cierre') {
        const colores = [ACENTO, '#ffd23f', '#fffbea', CLARO, '#ff8fb8'];
        v.confeti = Array.from({ length: 80 }, (_, i) => {
          const e = $(caja, 'div', 'confeti'); e.style.background = colores[i % colores.length];
          return { e, x: rr() * 1920, v: 260 + rr() * 320, giro: rr() * 720, fase: rr() * 1.2 };
        });
      }
    }
    return v;
  });

  // ---------------- Cámara de las capturas ----------------
  const BASE = 1264 / 1920;
  const enfoque = caja => {
    if (!caja) return { z: 1, cx: 960, cy: 540 };
    const [x, y, w, h] = caja;
    return { z: limitar(Math.min(1264 * .55 / (w * BASE), 711 * .45 / (h * BASE)), 1, 1.9), cx: x + w / 2, cy: y + h / 2 };
  };
  const camara = (v, t) => {
    const s = v.s, llaves = [{ t: s.inicio, ...enfoque() }];
    s.marcas.forEach(m => { llaves.push({ ...llaves[llaves.length - 1], t: m.clic - 1.0 }); llaves.push({ t: m.clic - .25, ...enfoque(m.caja) }); });
    const fin = s.inicio + s.largo;
    llaves.push({ ...llaves[llaves.length - 1], t: fin - 1.3 });
    llaves.push({ ...enfoque(), z: 1.04, t: fin - .3 });
    let a = llaves[0], b = llaves[0];
    for (let i = 0; i < llaves.length - 1; i++) if (t >= llaves[i].t) { a = llaves[i]; b = llaves[i + 1]; }
    if (t >= llaves[llaves.length - 1].t) a = b = llaves[llaves.length - 1];
    const k = a === b ? 1 : suave(tramo(t, a.t, b.t));
    const z = a.z + (b.z - a.z) * k, cx = a.cx + (b.cx - a.cx) * k, cy = a.cy + (b.cy - a.cy) * k, e = BASE * z;
    return { e, tx: limitar(632 - cx * e, 1264 - 1920 * e, 0), ty: limitar(355 - cy * e, 711 - 1080 * e, 0) };
  };

  const dibujarCaptura = (v, t) => {
    const s = v.s, local = t - s.inicio;
    const { e, tx, ty } = camara(v, t);
    v.capa.style.transform = `translate(${tx}px,${ty}px) scale(${e})`;
    // Entrada con giro 3D y un leve vaivén después
    const entra = salida(tramo(local, .05, .9));
    v.nav.style.transform = `translateY(${(1 - entra) * 120}px) rotateY(${(1 - entra) * -24 + Math.sin(t * .6) * 1.6}deg) rotateX(${(1 - entra) * 10 + Math.sin(t * .45) * .8}deg) scale(${.9 + .1 * entra})`;
    v.reflejo.style.transform = `translateX(${-120 + tramo(local, .5, 1.4) * 240}%)`;
    let px = 1120, py = 640, presion = 0, anterior = { x: 1120, y: 640 };
    s.marcas.forEach((m, i) => {
      const [x, y, w, h] = m.caja;
      const destino = { x: tx + (x + w * .62) * e, y: ty + (y + h * .6) * e };
      const k = suave(tramo(t, m.clic - .75, m.clic - .08));
      if (t >= m.clic - .75) { px = anterior.x + (destino.x - anterior.x) * k; py = anterior.y + (destino.y - anterior.y) * k; }
      if (t >= m.clic) { px = destino.x; py = destino.y; }
      anterior = destino;
      presion = Math.max(presion, 1 - Math.abs(t - m.clic) / .12);
      const p = tramo(t, m.clic, m.clic + .35);
      const siguiente = s.marcas[i + 1];
      const apaga = siguiente ? tramo(t, siguiente.clic - .9, siguiente.clic - .4) : tramo(t, s.inicio + s.largo - 1.3, s.inicio + s.largo - .6);
      const parte = v.marcas[i];
      parte.anillo.style.opacity = p > 0 ? 1 - apaga * .6 : 0;
      parte.anillo.style.transform = `scale(${.6 + .4 * salto(p) + (p >= 1 ? Math.sin((t - m.clic) * 6) * .025 : 0)})`;
      parte.foco.style.opacity = suave(tramo(t, m.clic - .1, m.clic + .4)) * (1 - apaga);
      if (parte.nota) {
        const q = tramo(t, m.clic + .15, m.clic + .6);
        parte.nota.style.opacity = q > 0 ? 1 - apaga : 0;
        parte.nota.style.transform = `scale(${salto(q)}) rotate(${(1 - q) * -8 + Math.sin(t * 2) * 1.5}deg)`;
      }
    });
    v.cursor3.style.opacity = s.marcas.length ? tramo(local, .6, .9) : 0;
    v.cursor3.style.transform = `translate(${px - 8}px,${py - 4}px) scale(${1 - presion * .22})`;
    const ultimo = [...s.marcas].reverse().find(m => t >= m.clic);
    const o = ultimo ? tramo(t, ultimo.clic, ultimo.clic + .5) : 1;
    v.onda.style.opacity = o < 1 ? 1 - o : 0;
    v.onda.style.left = px + 'px'; v.onda.style.top = py + 'px';
    v.onda.style.transform = `scale(${.2 + o * 1.3})`;
  };

  const dibujarPuntos = (v, t) => {
    v.puntos.forEach((p, i) => {
      const k = tramo(t, v.s.aparecen[i], v.s.aparecen[i] + .5);
      const lado = i % 2 ? 1 : -1;
      p.style.opacity = k > 0 ? 1 : 0;
      p.style.transform = `perspective(1200px) translateX(${(1 - salto(k)) * 320 * lado}px) rotateY(${(1 - k) * 40 * lado}deg) scale(${.6 + .4 * salto(k)})`;
      p.firstChild.style.transform = `translateY(${-Math.abs(Math.sin((t - v.s.aparecen[i]) * 4)) * 14 * k}px) rotate(${Math.sin(t * 3 + i) * 6}deg)`;
    });
  };

  const dibujarPortada = (v, t) => {
    const s = v.s, local = t - s.inicio;
    const abajo = v.grande.offsetTop + v.grande.offsetHeight + 36;
    v.lema.style.top = abajo + 'px';
    v.ficha.style.top = abajo + v.lema.offsetHeight + 44 + 'px';
    animarLetras(v.letras, s.letras, local - .25, v.cursor);
    const base = .9 + v.letras.length * .045;
    const kl = suave(tramo(local, base, base + .6));
    v.lema.style.opacity = kl; v.lema.style.transform = `translateY(${(1 - kl) * 40}px)`;
    v.ficha.style.transform = `scale(${salto(tramo(local, base + .4, base + .9))})`;
    const kp = salto(tramo(local, .3, 1.1));
    v.foto.style.transform = `perspective(1600px) translateX(${(1 - kp) * 900}px) rotateY(${(1 - kp) * -30 - 8 + Math.sin(t * 1.1) * 3}deg) rotate(${3 + Math.sin(t * 1.3) * 1.2}deg) translateY(${Math.sin(t * 1.7) * 10}px)`;
    v.chispas.forEach(c => {
      const brillo = Math.max(0, Math.sin((t + c.f) * 2.6));
      c.e.style.transform = `translate(${c.x}px,${c.y}px) scale(${brillo}) rotate(${t * 90}deg)`;
    });
    if (v.confeti) {
      const desde = s.habla + s.voz_segundos * .2;
      v.confeti.forEach(c => {
        const u = t - desde - c.fase;
        c.e.style.display = u > 0 ? 'block' : 'none';
        c.e.style.transform = `translate(${c.x + Math.sin(u * 3 + c.giro) * 40}px,${-60 + u * c.v}px) rotate(${c.giro + u * 300}deg)`;
      });
    }
  };

  const dibujarEscena = (v, t) => {
    if (v.letras && v.s.tipo !== 'portada' && v.s.tipo !== 'cierre') animarLetras(v.letras, v.s.letras, t - v.s.inicio - .3, v.cursor);
    if (v.s.tipo === 'captura') dibujarCaptura(v, t);
    else if (v.s.tipo === 'puntos') dibujarPuntos(v, t);
    else dibujarPortada(v, t);
  };

  // ---------------- Transiciones ----------------
  const cortina = document.getElementById('cortina');
  const mosaico = document.getElementById('mosaico');
  const franjas = document.getElementById('franjas');
  const fichas = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 8; x++) {
    const f = $(mosaico, 'i');
    Object.assign(f.style, { left: x * 12.5 + '%', top: y * 20 + '%', background: (x + y) % 2 ? ACENTO : OSCURO });
    fichas.push({ f, x, y });
  }
  const limpiarEstilo = c => { c.style.transform = ''; c.style.opacity = ''; c.style.zIndex = ''; c.style.clipPath = ''; c.style.filter = ''; c.style.transformOrigin = ''; };
  const TRANS = {
    deslizar(a, b, k) { a.style.transform = `translateX(${-k * 1920}px)`; b.style.transform = `translateX(${(1 - k) * 1920}px)`; },
    zoom(a, b, k) { a.style.transform = `scale(${1 + k * .6})`; a.style.opacity = 1 - k; b.style.transform = `scale(${.6 + k * .4})`; b.style.opacity = k; b.style.zIndex = 1; },
    giro(a, b, k) {
      const primera = k < .5; a.style.display = primera ? 'block' : 'none'; b.style.display = primera ? 'none' : 'block';
      a.style.transform = `perspective(1800px) rotateY(${-k * 180}deg)`; b.style.transform = `perspective(1800px) rotateY(${(1 - k) * 180}deg)`;
    },
    barrido(a, b, k) {
      const tapada = k < .5; a.style.display = tapada ? 'block' : 'none'; b.style.display = tapada ? 'none' : 'block';
      cortina.style.display = 'block';
      const x = tapada ? (1 - k * 2) * 100 : -(k * 2 - 1) * 100;
      cortina.style.clipPath = tapada ? `inset(0 0 0 ${Math.max(0, x)}%)` : `inset(0 ${Math.max(0, -x)}% 0 0)`;
    },
    circulo(a, b, k) { b.style.zIndex = 1; b.style.clipPath = `circle(${k * 75}% at 50% 50%)`; },
    tinta(a, b, k) {
      b.style.zIndex = 1;
      const r = k * 95, puntos = [];
      for (let i = 0; i < 48; i++) {
        const ang = i / 48 * Math.PI * 2, rr = r * (1 + .14 * Math.sin(ang * 7 + k * 9) + .07 * Math.sin(ang * 3 - k * 5));
        puntos.push(`${50 + Math.cos(ang) * rr * .6}% ${50 + Math.sin(ang) * rr}%`);
      }
      b.style.clipPath = `polygon(${puntos.join(',')})`;
    },
    persianas(a, b, k) {
      b.style.zIndex = 1;
      const partes = [];
      for (let i = 0; i < 10; i++) { const p = suave(limitar(k * 1.6 - i * .06)), x0 = i * 10, x1 = x0 + p * 10; partes.push(`${x0}% 0%`, `${x0}% 100%`, `${x1}% 100%`, `${x1}% 0%`); }
      b.style.clipPath = `polygon(${partes.join(',')})`;
    },
    mosaico(a, b, k) {
      mosaico.style.display = 'block';
      fichas.forEach(({ f, x, y }) => {
        const r = (x + y) * .035, ida = limitar((k - r) / .35), vuelta = limitar((k - .5 - r) / .35);
        f.style.transform = `perspective(400px) rotateY(${90 - ida * 90 + vuelta * 90}deg)`;
        f.style.opacity = ida > 0 && vuelta < 1 ? 1 : 0;
      });
      a.style.display = k < .55 ? 'block' : 'none'; b.style.display = k < .55 ? 'none' : 'block';
    },
    falla(a, b, k) {
      const r = azar(Math.floor(k * 24) + 3), fuerza = Math.sin(k * Math.PI);
      const ve = k < .5 ? a : b; (k < .5 ? b : a).style.display = 'none';
      ve.style.transform = `translateX(${(r() - .5) * 80 * fuerza}px) skewX(${(r() - .5) * 14 * fuerza}deg)`;
      ve.style.filter = `hue-rotate(${r() * 180 * fuerza}deg) saturate(${1 + fuerza * 2}) drop-shadow(${10 * fuerza}px 0 0 rgba(255,0,80,.8)) drop-shadow(${-10 * fuerza}px 0 0 rgba(0,220,255,.8))`;
      const y = r() * 80;
      if (fuerza > .3) ve.style.clipPath = `polygon(0 0,100% 0,100% ${y}%,${r() * 20}% ${y}%,${r() * 20}% ${y + 8}%,100% ${y + 8}%,100% 100%,0 100%)`;
    },
    viaje(a, b, k) {
      a.style.transform = `scale(${1 + k * 3})`; a.style.opacity = 1 - k; a.style.filter = `blur(${k * 10}px)`;
      b.style.transform = `scale(${.4 + k * .6}) rotate(${(1 - k) * -8}deg)`; b.style.opacity = k; b.style.zIndex = 1;
    },
    hoja(a, b, k) {
      a.style.transformOrigin = '50% 100%'; a.style.transform = `perspective(1400px) rotateX(${k * 95}deg)`; a.style.zIndex = 2;
      a.style.filter = `brightness(${1 - k * .5})`; b.style.transform = `scale(${.9 + k * .1})`;
    },
    doble(a, b, k) {
      franjas.style.display = 'block';
      const [f1, f2] = franjas.children, p1 = suave(limitar(k * 1.4)), p2 = suave(limitar(k * 1.4 - .4));
      const banda = (f, p) => { const x = -60 + p * 220; f.style.clipPath = `polygon(${x}% 0,${x + 70}% 0,${x + 40}% 100%,${x - 30}% 100%)`; };
      banda(f1, p1); banda(f2, p2);
      a.style.display = k < .5 ? 'block' : 'none'; b.style.display = k < .5 ? 'none' : 'block';
    },
  };

  // ---------------- Cuadro completo ----------------
  const presentadora = document.getElementById('presentadora');
  const cara = presentadora.querySelector('.cara');
  const barras = [...presentadora.querySelectorAll('.barras i')];
  const subtitulo = document.querySelector('#subtitulo p');
  const avance = document.querySelector('#avance div');
  let trozoPuesto = null;

  const paso = t => {
    t = limitar(t, 0, D.duracion - .001);
    fondo.dibujar(pincel, t, 1920, 1080, estadoFondo);
    avance.style.width = (t / D.duracion * 100) + '%';
    let n = escenas.findIndex(v => t >= v.s.inicio && t < v.s.inicio + v.s.largo);
    if (n < 0) n = escenas.length - 1;
    const v = escenas[n], local = t - v.s.inicio;
    escenas.forEach(x => { x.caja.style.display = 'none'; limpiarEstilo(x.caja); });
    cortina.style.display = mosaico.style.display = franjas.style.display = 'none';
    v.caja.style.display = 'block';
    dibujarEscena(v, t);
    if (n > 0 && local < TRANSICION) {
      const previa = escenas[n - 1];
      previa.caja.style.display = 'block';
      dibujarEscena(previa, previa.s.inicio + previa.s.largo - .01);
      (TRANS[v.s.transicion] || TRANS.barrido)(previa.caja, v.caja, suave(local / TRANSICION));
    }
    const p = PRESENTADORAS[v.s.voz] || Object.values(PRESENTADORAS)[0];
    const hablando = t >= v.s.habla && t < v.s.habla + v.s.voz_segundos;
    const fuerza = hablando ? (v.s.boca[Math.floor((t - v.s.habla) * 30)] || 0) : 0;
    cara.style.background = p.color;
    presentadora.querySelector('.inicial').textContent = p.nombre[0];
    presentadora.querySelector('.nombre').textContent = p.nombre;
    const cambio = n > 0 && escenas[n - 1].s.voz === v.s.voz ? 1 : salto(tramo(local, .1, .55));
    presentadora.style.transform = `translateY(${(1 - cambio) * 60}px) scale(${.8 + .2 * cambio + fuerza * .05}) rotate(${Math.sin(t * 9) * fuerza * 3}deg)`;
    barras.forEach((b, i) => { b.style.height = 8 + fuerza * [16, 26, 30, 22, 14][i] * (.7 + .3 * Math.sin(t * 20 + i * 1.7)) + 'px'; });
    const dicho = t - v.s.habla;
    const visible = dicho > -.2 && dicho < v.s.voz_segundos + .35;
    subtitulo.parentElement.style.opacity = visible ? 1 : 0;
    if (visible) {
      let actual = v.s.palabras.findIndex((w, i) => dicho < (v.s.palabras[i + 1] ? v.s.palabras[i + 1][1] : 1e9));
      if (actual < 0) actual = v.s.palabras.length - 1;
      const trozo = v.trozos.find(tr => tr.includes(actual)) || v.trozos[0];
      const clave = n + ':' + trozo[0];
      if (trozoPuesto !== clave) { subtitulo.innerHTML = trozo.map(i => `<span>${escapar(v.s.palabras[i][0])}</span>`).join(' '); trozoPuesto = clave; }
      [...subtitulo.children].forEach((sp, j) => {
        const i = trozo[j];
        sp.className = i < actual ? 'dicha' : i === actual ? 'ahora' : '';
        sp.style.transform = i === actual ? 'scale(1.12)' : '';
      });
    }
  };

  window.pelicula = { paso, duracion: D.duracion };
  if (!location.search.includes('cuadro')) {
    const empezo = performance.now();
    const correr = () => { paso(((performance.now() - empezo) / 1000) % D.duracion); requestAnimationFrame(correr); };
    correr();
  }
})();
