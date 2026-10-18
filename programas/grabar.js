// Paso 6: graba la película cuadro por cuadro y la une con el sonido en video.mp4.
// Uso: node grabar.js <carpeta del trabajo> [segundos sueltos separados por coma, para revisar]
// CALIDAD=720 (por defecto) o 1080.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { abrirNavegador } = require('./navegador');

const [carpeta, sueltos] = process.argv.slice(2);
const ALTO = +(process.env.CALIDAD || 720);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const PELICULA = path.join(__dirname, '..', 'pelicula', 'index.html');

(async () => {
  const datos = JSON.parse(fs.readFileSync(path.join(carpeta, 'linea.json'), 'utf8'));
  datos.capturas = pathToFileURL(path.join(carpeta, 'capturas')).href + '/';
  const navegador = await abrirNavegador();
  const pagina = await navegador.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: ALTO / 1080 });
  let fallo = null;
  pagina.on('pageerror', e => { fallo = e.message; });
  await pagina.addInitScript(d => { window.DATOS = d; }, datos);
  await pagina.goto(pathToFileURL(PELICULA).href + '?cuadro', { waitUntil: 'load' });
  await pagina.evaluate(() => document.fonts.ready);
  await pagina.evaluate(() => Promise.all([...document.images].map(i => i.decode().catch(() => {}))));
  if (fallo) throw new Error('La plantilla falló: ' + fallo);
  const duracion = await pagina.evaluate(() => pelicula.duracion);

  if (sueltos) {
    const revision = path.join(carpeta, 'revision');
    fs.mkdirSync(revision, { recursive: true });
    const lista = sueltos.split(',').map(Number);
    for (let i = 0; i < lista.length; i++) {
      await pagina.evaluate(t => pelicula.paso(t), lista[i]);
      await pagina.screenshot({ path: path.join(revision, `cuadro-${String(i + 1).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 88 });
    }
    if (fallo) throw new Error('La plantilla falló: ' + fallo);
    await navegador.close();
    return;
  }

  const total = Math.round(duracion * 30);
  const salida = path.join(carpeta, 'video.mp4');
  const ff = spawn(FFMPEG, ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', '-',
    '-i', path.join(carpeta, 'sonido.wav'), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', salida + '.parcial.mp4']);
  let errorFfmpeg = '';
  ff.stderr.on('data', d => { errorFfmpeg += d; });
  const terminado = new Promise((ok, mal) => ff.on('close', c => c === 0 ? ok() : mal(new Error('ffmpeg: ' + errorFfmpeg.slice(0, 300)))));
  const escribir = trozo => new Promise(ok => ff.stdin.write(trozo) ? ok() : ff.stdin.once('drain', ok));
  for (let i = 0; i < total; i++) {
    await pagina.evaluate(t => pelicula.paso(t), i / 30);
    await escribir(await pagina.screenshot({ type: 'jpeg', quality: 90 }));
    if (i % 30 === 0) console.log(JSON.stringify({ avance: Math.round(i / total * 100), texto: `Cuadro ${i} de ${total}` }));
    if (fallo) throw new Error('La plantilla falló: ' + fallo);
  }
  ff.stdin.end();
  await terminado;
  fs.renameSync(salida + '.parcial.mp4', salida);
  await navegador.close();
  console.log(JSON.stringify({ avance: 100, texto: 'Video listo' }));
})().catch(e => { console.error(e.message); process.exit(1); });
