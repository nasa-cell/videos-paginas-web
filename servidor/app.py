"""Servidor de «Explícame la página»: cuentas, fila de videos y almacén de cada usuario."""
import json
import os
import secrets
import shutil
import subprocess
import time
from datetime import timedelta

from flask import Flask, abort, jsonify, request, send_file, send_from_directory, session

from . import almacen, base, cuentas, trabajos

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGINA = os.path.join(RAIZ, 'pagina')
VOCES = json.load(open(os.path.join(RAIZ, 'voces.json'), encoding='utf-8'))
MINUTOS = (1, 2, 3, 5)
# Capturas que el usuario puede subir según la duración del video.
LIMITE_CAPTURAS = {1: 4, 2: 6, 3: 8, 5: 12}

app = Flask(__name__, static_folder=None)
app.secret_key = os.environ.get('SECRET_KEY') or secrets.token_hex(32)
app.config.update(
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),
    SESSION_COOKIE_HTTPONLY=True,
    # En Hugging Face la página también se abre dentro de su marco: con https la cookie va como «None».
    SESSION_COOKIE_SAMESITE='None' if os.environ.get('BASE_URL', '').startswith('https') else 'Lax',
    SESSION_COOKIE_SECURE=os.environ.get('BASE_URL', '').startswith('https'),
    MAX_CONTENT_LENGTH=100 * 1024 * 1024,
)
app.register_blueprint(cuentas.cuentas)


@app.before_request
def mismo_sitio():
    # Las acciones que cambian algo solo se aceptan desde esta misma página.
    if request.method in ('POST', 'DELETE', 'PUT'):
        origen = request.headers.get('Origin')
        if origen and origen.rstrip('/') != request.host_url.rstrip('/') and origen.rstrip('/') != os.environ.get('BASE_URL', '').rstrip('/'):
            abort(403)


def con_usuario():
    usuario = cuentas.usuario_actual()
    if not usuario:
        abort(401)
    return usuario


def publico(v):
    return {k: v[k] for k in ('id', 'enlace', 'voces', 'minutos', 'estado', 'fase', 'avance', 'mensaje', 'titulo', 'duracion', 'tamano', 'creado', 'terminado')}


@app.get('/')
@app.get('/almacen')
def inicio():
    # Cada archivo va con su fecha de cambio en la dirección: si cambia, el navegador baja el nuevo.
    html = open(os.path.join(PAGINA, 'index.html'), encoding='utf-8').read()
    for archivo in ('estilos.css', 'pagina.js'):
        version = int(os.path.getmtime(os.path.join(PAGINA, archivo)))
        html = html.replace(f'/recursos/{archivo}"', f'/recursos/{archivo}?v={version}"')
    respuesta = app.response_class(html, mimetype='text/html')
    respuesta.headers['Cache-Control'] = 'no-cache'
    return respuesta


@app.get('/recursos/<path:archivo>')
def recursos(archivo):
    return send_from_directory(PAGINA, archivo, max_age=3600)


@app.get('/api/limites')
def limites():
    return jsonify(capturas=LIMITE_CAPTURAS, megas=8)


@app.get('/api/voces')
def lista_voces():
    return jsonify([{'clave': c, 'nombre': v['nombre'], 'color': v['color']} for c, v in VOCES.items()])


@app.get('/api/videos')
def mis_videos():
    usuario = con_usuario()
    if trabajos.MODO == 'github':
        trabajos.vencidos()
    filas = base.todos('SELECT * FROM videos WHERE usuario_id = ? ORDER BY creado DESC LIMIT 100', (usuario['id'],))
    usado, cuota = trabajos.espacio_de(usuario['id'])
    return jsonify(videos=[publico(v) for v in filas], limite=trabajos.MAX_POR_USUARIO, guardados_max=trabajos.MAX_GUARDADOS,
                   usado=usado, cuota=cuota, ahora=time.time())


def convertir_capturas(archivos, destino):
    """Revisa que cada archivo sea una imagen de verdad y la deja en 1920x1080 (centrada, sin recortar)."""
    os.makedirs(destino, exist_ok=True)
    for n, archivo in enumerate(archivos, 1):
        inicio = archivo.stream.read(16)
        archivo.stream.seek(0)
        es_imagen = inicio.startswith(b'\xff\xd8\xff') or inicio.startswith(b'\x89PNG') or (inicio[:4] == b'RIFF' and inicio[8:12] == b'WEBP')
        if not es_imagen:
            return f'«{archivo.filename[:40]}» no es una imagen. Sube capturas en JPG, PNG o WEBP.'
        original = os.path.join(destino, f'original-{n}')
        archivo.save(original)
        if os.path.getsize(original) > 8 * 1024 * 1024:
            return f'«{archivo.filename[:40]}» pesa más de 8 MB.'
        r = subprocess.run([trabajos.FFMPEG, '-v', 'error', '-y', '-i', original, '-frames:v', '1', '-vf',
                            'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0a1a4a',
                            '-q:v', '3', os.path.join(destino, f'subida-{n}.jpg')], capture_output=True)
        os.remove(original)
        if r.returncode != 0:
            return f'No se pudo abrir la imagen «{archivo.filename[:40]}».'
    return None


@app.post('/api/videos')
def nuevo_video():
    usuario = con_usuario()
    capturas = []
    if request.content_type and request.content_type.startswith('multipart/'):
        try:
            datos = json.loads(request.form.get('datos', '{}'))
        except ValueError:
            datos = {}
        capturas = [f for f in request.files.getlist('capturas') if f and f.filename]
    else:
        datos = request.get_json(silent=True) or {}
    enlace = str(datos.get('enlace', '')).strip()
    if enlace and '://' not in enlace:
        enlace = 'https://' + enlace
    voces = [v for v in datos.get('voces', []) if v in VOCES][:2]
    try:
        minutos = float(datos.get('minutos', 2))
    except (TypeError, ValueError):
        minutos = 0
    if not voces:
        return jsonify(error='Elige al menos una voz.'), 400
    if minutos not in MINUTOS:
        return jsonify(error='Elige una duración: 1, 2, 3 o 5 minutos.'), 400
    problema = trabajos.enlace_permitido(enlace) if len(enlace) <= 1000 else 'El enlace es demasiado largo (máximo 1000 caracteres).'
    if problema:
        return jsonify(error=problema), 400
    if trabajos.activos_de(usuario['id']) >= trabajos.MAX_POR_USUARIO:
        return jsonify(error=f'Ya tienes {trabajos.MAX_POR_USUARIO} videos creándose. Espera a que termine uno.'), 409
    # Cada usuario tiene su propia parte del almacén: el video nuevo tiene que caber en la suya.
    usado, cuota = trabajos.espacio_de(usuario['id'])
    if usado + minutos * trabajos.MB_POR_MINUTO * 1_000_000 > cuota:
        libre = max(0, cuota - usado) / 1e6
        return jsonify(error=f'Tu almacén está casi lleno (te quedan {libre:.0f} MB y un video de {minutos:g} min ocupa unos '
                             f'{minutos * trabajos.MB_POR_MINUTO:g} MB). Borra algún video o elige uno más corto.'), 409
    if trabajos.guardados_de(usuario['id']) >= trabajos.MAX_GUARDADOS:
        return jsonify(error=f'Tu almacén está lleno ({trabajos.MAX_GUARDADOS} videos). Borra alguno para crear otro.'), 409
    limite = LIMITE_CAPTURAS[minutos]
    if len(capturas) > limite:
        return jsonify(error=f'Para un video de {minutos:g} min puedes subir hasta {limite} capturas. Quita {len(capturas) - limite}.'), 400
    temporal = None
    if capturas:
        temporal = os.path.join(trabajos.SUBIDAS, 'nuevo-' + secrets.token_hex(6))
        problema = convertir_capturas(capturas, temporal)
        if problema:
            shutil.rmtree(temporal, ignore_errors=True)
            return jsonify(error=problema), 400
    vid = trabajos.crear(usuario['id'], enlace, voces, minutos, en_espera=True)
    if temporal:
        destino = os.path.join(trabajos.SUBIDAS, vid)
        os.replace(temporal, destino)
        if trabajos.MODO == 'github':
            try:
                almacen.subir_capturas(vid, destino)
            except Exception:
                base.ejecutar('DELETE FROM videos WHERE id = ?', (vid,))
                return jsonify(error='No se pudieron guardar tus capturas. Intenta de nuevo.'), 502
            finally:
                shutil.rmtree(destino, ignore_errors=True)
    trabajos.lanzar(vid)
    return jsonify(id=vid)


def video_del_usuario(video_id):
    usuario = con_usuario()
    v = base.uno('SELECT * FROM videos WHERE id = ? AND usuario_id = ?', (video_id, usuario['id']))
    if not v:
        abort(404)
    return usuario, v


@app.get('/api/videos/<video_id>/archivo')
def archivo_video(video_id):
    usuario, v = video_del_usuario(video_id)
    ruta = almacen.abrir(usuario['id'], video_id, 'video.mp4') if v['estado'] == 'listo' else None
    if not ruta:
        abort(404)
    nombre = ''.join(c for c in (v['titulo'] or 'video') if c.isalnum() or c in ' -_').strip()[:50] or 'video'
    return send_file(ruta, mimetype='video/mp4', as_attachment=request.args.get('descargar') == '1',
                     download_name=f'{nombre} explicado.mp4', conditional=True, max_age=0)


@app.get('/api/videos/<video_id>/portada')
def portada_video(video_id):
    usuario, v = video_del_usuario(video_id)
    ruta = almacen.abrir(usuario['id'], video_id, 'portada.jpg')
    if not ruta:
        abort(404)
    return send_file(ruta, mimetype='image/jpeg', max_age=86400)


@app.delete('/api/videos/<video_id>')
def borrar_video(video_id):
    usuario, v = video_del_usuario(video_id)
    if v['estado'] in ('en_fila', 'trabajando'):
        trabajos.cancelar(video_id)
    base.ejecutar('DELETE FROM videos WHERE id = ?', (video_id,))
    almacen.borrar(usuario['id'], video_id)
    trabajos.borrar_subidas(video_id)
    if trabajos.MODO == 'github':
        almacen.borrar_capturas(video_id)
    return jsonify(ok=True)


@app.post('/api/videos/<video_id>/reintentar')
def reintentar(video_id):
    usuario, v = video_del_usuario(video_id)
    if v['estado'] != 'error':
        return jsonify(error='Ese video no tiene error.'), 400
    if trabajos.activos_de(usuario['id']) >= trabajos.MAX_POR_USUARIO:
        return jsonify(error=f'Ya tienes {trabajos.MAX_POR_USUARIO} videos creándose. Espera a que termine uno.'), 409
    base.ejecutar("UPDATE videos SET estado = 'preparando', avance = 0, fase = 'En la fila', mensaje = NULL, creado = ? WHERE id = ?", (time.time(), video_id))
    trabajos.lanzar(video_id)
    return jsonify(ok=True)


base.preparar()
trabajos.arrancar()
