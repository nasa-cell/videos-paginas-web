// Paso 6: graba la película cuadro por cuadro y la une con el sonido en video.mp4.
// Uso: node grabar.js <carpeta del trabajo>                  todo el video (en varios procesos a la vez)
//      node grabar.js <carpeta> --parte <i>/<N>             solo el pedazo i de N (para repartir entre computadoras)
//      node grabar.js <carpeta> --unir                      junta los pedazos de trozos/ con el sonido
//      node grabar.js <carpeta> <segundos,separados,por,coma>   fotos sueltas, para revisar
// CALIDAD=720 (por defecto) o 1080. HILOS_GRABAR fija cuántos procesos graban a la vez.
// La película no guarda nada entre cuadros (cada cuadro depende solo del segundo), así que
// cada proceso puede grabar su tramo por separado y después se pegan sin que se note.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { abrirNavegador } = require('./navegador');

const argumentos = process.argv.slice(2);
const carpeta = argumentos[0];
const opcion = nombre => { const i = argumentos.indexOf(nombre); return i > 0 ? argumentos[i + 1] : null; };
const sueltos = argumentos[1] && /^[\d.,]+$/.test(argumentos[1]) ? argumentos[1] : null;
const ALTO = +(process.env.CALIDAD || 720);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const PELICULA = path.join(__dirname, '..', 'pelicula', 'index.html');
const CUADROS = 30;
const TROZOS = path.join(carpeta, 'trozos');
const avance = (porcentaje, texto) => console.log(JSON.stringify({ avance: Math.round(porcentaje), texto }));

// Cada Chrome que graba usa ~1 núcleo y ~600 MB: se abren tantos como aguante la computadora.
function hilos() {
  if (+process.env.HILOS_GRABAR > 0) return +process.env.HILOS_GRABAR;
  return Math.max(1, Math.min(6, os.cpus().length, Math.floor(os.freemem() / 650e6)));
}

function correrFfmpeg(args) {
  return new Promise((ok, mal) => {
    const ff = spawn(FFMPEG, ['-v', 'error', '-y', ...args]);
    let error = '';
    ff.stderr.on('data', d => { error += d; });
    ff.on('close', c => c === 0 ? ok() : mal(new Error('ffmpeg: ' + error.slice(0, 300))));
  });
}

async function abrirPelicula() {
  const datos = JSON.parse(fs.readFileSync(path.join(carpeta, 'linea.json'), 'utf8'));
  datos.capturas = pathToFileURL(path.join(carpeta, 'capturas')).href + '/';
  const navegador = await abrirNavegador();
  const pagina = await navegador.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: ALTO / 1080 });
  const estado = { fallo: null };
  pagina.on('pageerror', e => { estado.fallo = e.message; });
  await pagina.addInitScript(d => { window.DATOS = d; }, datos);
  await pagina.goto(pathToFileURL(PELICULA).href + '?cuadro', { waitUntil: 'load' });
  await pagina.evaluate(() => document.fonts.ready);
  await pagina.evaluate(() => Promise.all([...document.images].map(i => i.decode().catch(() => {}))));
  if (estado.fallo) throw new Error('La plantilla falló: ' + estado.fallo);
  return { navegador, pagina, estado };
}

const totalCuadros = () => Math.round(JSON.parse(fs.readFileSync(path.join(carpeta, 'linea.json'), 'utf8')).duracion * CUADROS);

// Un proceso: graba los cuadros [desde, hasta) en un video sin sonido.
async function grabarTramo(desde, hasta, salida) {
  const { navegador, pagina, estado } = await abrirPelicula();
  const ff = spawn(FFMPEG, ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(CUADROS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', String(CUADROS), salida + '.parcial.mp4']);
  let errorFfmpeg = '';
  ff.stderr.on('data', d => { errorFfmpeg += d; });
  const terminado = new Promise((ok, mal) => ff.on('close', c => c === 0 ? ok() : mal(new Error('ffmpeg: ' + errorFfmpeg.slice(0, 300)))));
  const escribir = trozo => new Promise(ok => ff.stdin.write(trozo) ? ok() : ff.stdin.once('drain', ok));
  for (let i = desde; i < hasta; i++) {
    await pagina.evaluate(t => pelicula.paso(t), i / CUADROS);
    await escribir(await pagina.screenshot({ type: 'jpeg', quality: 90 }));
    if ((i - desde) % 15 === 14) console.log(JSON.stringify({ hechos: i - desde + 1 }));
    if (estado.fallo) throw new Error('La plantilla falló: ' + estado.fallo);
  }
  ff.stdin.end();
  await terminado;
  fs.renameSync(salida + '.parcial.mp4', salida);
  console.log(JSON.stringify({ hechos: hasta - desde }));
  await navegador.close();
}

// Pega varios videos sin sonido, uno detrás de otro, sin volver a codificarlos.
async function pegar(archivos, salida, sonido) {
  const lista = salida + '.lista.txt';
  fs.writeFileSync(lista, archivos.map(a => `file '${path.resolve(a).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  const conSonido = sonido ? ['-i', sonido, '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart'] : [];
  await correrFfmpeg(['-f', 'concat', '-safe', '0', '-i', lista, ...conSonido, '-c:v', 'copy', salida + '.parcial.mp4']);
  fs.renameSync(salida + '.parcial.mp4', salida);
  fs.rmSync(lista, { force: true });
}

// Graba el pedazo i de N repartido entre varios procesos y deja trozos/parte-i.mp4.
async function grabarParte(i, n, pesoAvance = 100) {
  const total = totalCuadros();
  const desde = Math.floor(total * i / n), hasta = Math.floor(total * (i + 1) / n);
  const cuantos = Math.max(1, Math.min(hilos(), Math.ceil((hasta - desde) / 60)));
  fs.mkdirSync(TROZOS, { recursive: true });
  const hechos = new Array(cuantos).fill(0);
  let ultimo = 0;
  const tramos = Array.from({ length: cuantos }, (_, k) => {
    const a = desde + Math.floor((hasta - desde) * k / cuantos), b = desde + Math.floor((hasta - desde) * (k + 1) / cuantos);
    const salida = path.join(TROZOS, `parte-${i}-${k}.mp4`);
    return new Promise((ok, mal) => {
      const hijo = spawn(process.execPath, [__filename, carpeta, '--tramo', `${a}-${b}`, '--salida', salida], { stdio: ['ignore', 'pipe', 'pipe'] });
      let error = '', resto = '';
      hijo.stderr.on('data', d => { error += d; });
      hijo.stdout.on('data', d => {
        const lineas = (resto + d).split('\n'); resto = lineas.pop();
        for (const linea of lineas) {
          try { hechos[k] = JSON.parse(linea).hechos ?? hechos[k]; } catch {}
        }
        const suma = hechos.reduce((x, y) => x + y, 0);
        if (Date.now() - ultimo > 1000) { ultimo = Date.now(); avance(suma / (hasta - desde) * pesoAvance, `Cuadro ${suma} de ${hasta - desde} (${cuantos} a la vez)`); }
      });
      hijo.on('close', c => c === 0 ? ok(salida) : mal(new Error(error.trim().split('\n').pop() || `falló el proceso ${k + 1}`)));
    });
  });
  const archivos = await Promise.all(tramos);
  const parte = path.join(TROZOS, `parte-${i}.mp4`);
  if (archivos.length === 1) fs.renameSync(archivos[0], parte);
  else { await pegar(archivos, parte); archivos.forEach(a => fs.rmSync(a, { force: true })); }
  return parte;
}

async function unir() {
  const partes = fs.readdirSync(TROZOS).filter(a => /^parte-\d+\.mp4$/.test(a)).sort((a, b) => parseInt(a.slice(6)) - parseInt(b.slice(6)));
  if (!partes.length) throw new Error('No hay pedazos del video para unir.');
  await pegar(partes.map(a => path.join(TROZOS, a)), path.join(carpeta, 'video.mp4'), path.join(carpeta, 'sonido.wav'));
  fs.rmSync(TROZOS, { recursive: true, force: true });
}

(async () => {
  if (opcion('--tramo')) {
    const [a, b] = opcion('--tramo').split('-').map(Number);
    return grabarTramo(a, b, opcion('--salida'));
  }
  if (sueltos) {
    const { navegador, pagina, estado } = await abrirPelicula();
    const revision = path.join(carpeta, 'revision');
    fs.mkdirSync(revision, { recursive: true });
    const lista = sueltos.split(',').map(Number);
    for (let i = 0; i < lista.length; i++) {
      await pagina.evaluate(t => pelicula.paso(t), lista[i]);
      await pagina.screenshot({ path: path.join(revision, `cuadro-${String(i + 1).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 88 });
    }
    if (estado.fallo) throw new Error('La plantilla falló: ' + estado.fallo);
    return navegador.close();
  }
  if (argumentos.includes('--unir')) {
    await unir();
    return avance(100, 'Video listo');
  }
  if (opcion('--parte')) {
    const [i, n] = opcion('--parte').split('/').map(Number);
    await grabarParte(i, n);
    return avance(100, `Pedazo ${i + 1} de ${n} listo`);
  }
  fs.rmSync(TROZOS, { recursive: true, force: true });
  await grabarParte(0, 1, 98);
  await unir();
  avance(100, 'Video listo');
})().catch(e => { console.error(e.message); process.exit(1); });
