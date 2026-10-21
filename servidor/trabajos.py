"""Fila de videos: cada usuario puede tener 3 a la vez y el servidor crea hasta
MAX_A_LA_VEZ en paralelo, turnándose entre usuarios para que nadie acapare.

El avance vive en la base de datos, así que la página lo recupera aunque se recargue
o se cierre. Si el servidor se reinicia, los videos a medio hacer vuelven a la fila.
"""
import ipaddress
import json
import re
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.parse

from . import almacen, base

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROGRAMAS = os.path.join(RAIZ, 'programas')
CARPETA = os.environ.get('CARPETA_TRABAJOS', os.path.join(RAIZ, 'trabajos'))
SUBIDAS = os.environ.get('CARPETA_SUBIDAS', os.path.join(RAIZ, 'subidas'))
MAX_POR_USUARIO = 3
MAX_A_LA_VEZ = int(os.environ.get('MAX_A_LA_VEZ', '3'))
MAX_GUARDADOS = int(os.environ.get('MAX_GUARDADOS', '30'))
FFMPEG = os.environ.get('FFMPEG', 'ffmpeg')
FFPROBE = os.environ.get('FFPROBE', 'ffprobe')
NODE = os.environ.get('NODE', 'node')
# «local»: el servidor hace los videos (en el PC). «github»: los hace GitHub Actions y el servidor solo avisa.
MODO = os.environ.get('MODO_TRABAJO', 'local')
GH_REPO = os.environ.get('GH_REPO', 'nasa-cell/videos-paginas-web')
GH_FLUJO = os.environ.get('GH_FLUJO', 'crear-video.yml')

# Pasos: (nombre, desde %, hasta %, orden)
PASOS = [
    ('Visitando la página', 0, 14, lambda c, v: [NODE, 'capturar.js', v['enlace'], c, str(capturas_para(v['minutos']))]
        + (['--subidas', os.path.join(SUBIDAS, v['id'])] if os.path.isdir(os.path.join(SUBIDAS, v['id'])) else [])),
    ('Escribiendo el guion', 14, 24, lambda c, v: [sys.executable, 'guion.py', c, v['voces'], str(v['minutos'])]),
    ('Grabando las voces', 24, 38, lambda c, v: [sys.executable, 'voces.py', c]),
    # Si con las voces grabadas el video queda corto, se agregan escenas hasta llegar a los minutos pedidos.
    ('Grabando las voces', 38, 41, lambda c, v: [sys.executable, 'guion.py', c, v['voces'], str(v['minutos']), '--alargar']),
    ('Preparando las escenas', 41, 42, lambda c, v: [sys.executable, 'armar.py', c]),
    ('Haciendo la música', 42, 45, lambda c, v: [sys.executable, 'sonido.py', c]),
    ('Armando el video', 45, 100, lambda c, v: [NODE, 'grabar.js', c]),
]
# Gemini y Fish tienen límites por minuto: pocos a la vez.
TURNOS = {'Visitando la página': threading.Semaphore(2), 'Escribiendo el guion': threading.Semaphore(2), 'Grabando las voces': threading.Semaphore(2)}
REINTENTOS = {'Visitando la página': 1, 'Escribiendo el guion': 1, 'Grabando las voces': 1}

_procesos = {}
_cancelados = set()
_activos = set()
_candado = threading.Lock()
_ultimo_turno = {}


def capturas_para(minutos):
    return int(min(16, max(6, round(4 + minutos * 2.5))))


def enlace_permitido(enlace):
    """Solo páginas públicas: http o https y que no apunten a la red interna del servidor."""
    try:
        u = urllib.parse.urlparse(enlace)
    except ValueError:
        return 'El enlace no es válido.'
    if u.scheme not in ('http', 'https') or not u.hostname:
        return 'El enlace debe empezar con http:// o https://'
    try:
        direcciones = {info[4][0] for info in socket.getaddrinfo(u.hostname, None)}
    except socket.gaierror:
        return 'No existe esa dirección. Revisa que el enlace esté bien escrito.'
    for d in direcciones:
        ip = ipaddress.ip_address(d.split('%')[0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            return 'Ese enlace apunta a una red privada. Usa una página pública de internet.'
    return None


def activos_de(usuario_id):
    fila = base.uno("SELECT COUNT(*) AS n FROM videos WHERE usuario_id = ? AND estado IN ('preparando', 'en_fila', 'trabajando')", (usuario_id,))
    return fila['n']


# Espacio del almacén: el total se reparte en partes iguales entre los usuarios, con un mínimo y un
# máximo por persona. Cada uno solo gasta su propia parte, así nadie llena el espacio de otro.
ALMACEN_TOTAL_MB = int(os.environ.get('ALMACEN_TOTAL_MB', '20000'))
CUOTA_MIN_MB = int(os.environ.get('CUOTA_MIN_MB', '200'))
CUOTA_MAX_MB = int(os.environ.get('CUOTA_MAX_MB', '1000'))
MB_POR_MINUTO = 15


def espacio_de(usuario_id):
    """(bytes usados, bytes de su cuota). Los videos que se están creando cuentan con su tamaño estimado."""
    usuarios = max(1, base.uno('SELECT COUNT(*) AS n FROM usuarios')['n'])
    cuota_mb = max(CUOTA_MIN_MB, min(CUOTA_MAX_MB, ALMACEN_TOTAL_MB // usuarios))
    fila = base.uno("SELECT COALESCE(SUM(tamano), 0) AS usado FROM videos WHERE usuario_id = ? AND estado = 'listo'", (usuario_id,))
    creando = base.uno("SELECT COALESCE(SUM(minutos), 0) AS m FROM videos WHERE usuario_id = ? AND estado IN ('preparando', 'en_fila', 'trabajando')", (usuario_id,))
    return int(fila['usado']) + int(creando['m'] * MB_POR_MINUTO * 1e6), cuota_mb * 1_000_000


def guardados_de(usuario_id):
    return base.uno("SELECT COUNT(*) AS n FROM videos WHERE usuario_id = ? AND estado = 'listo'", (usuario_id,))['n']


def crear(usuario_id, enlace, voces, minutos, en_espera=False):
    # «en_espera»: todavía se están guardando las capturas del usuario; no entra a la fila hasta soltarlo.
    import secrets
    vid = secrets.token_hex(8)
    base.ejecutar("INSERT INTO videos (id, usuario_id, enlace, voces, minutos, estado, fase, avance, creado) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)",
                  (vid, usuario_id, enlace, ','.join(voces), minutos, 'preparando' if en_espera else 'en_fila', 'En la fila', time.time()))
    return vid


def soltar(video_id):
    base.ejecutar("UPDATE videos SET estado = 'en_fila' WHERE id = ? AND estado = 'preparando'", (video_id,))


def borrar_subidas(video_id):
    shutil.rmtree(os.path.join(SUBIDAS, video_id), ignore_errors=True)


def cancelar(video_id):
    with _candado:
        _cancelados.add(video_id)
        proceso = _procesos.get(video_id)
    if proceso and proceso.poll() is None:
        proceso.kill()


def _actualizar(video_id, **campos):
    partes = ', '.join(f'{k} = ?' for k in campos)
    base.ejecutar(f'UPDATE videos SET {partes} WHERE id = ?', (*campos.values(), video_id))


def _mensaje_de_error(carpeta, salida_error):
    ruta = os.path.join(carpeta, 'error.json')
    if os.path.exists(ruta):
        try:
            return json.load(open(ruta, encoding='utf-8'))['causa']
        except Exception:
            pass
    lineas = [l.strip() for l in salida_error.strip().splitlines() if l.strip() and not l.startswith(('Traceback', '  File'))]
    ultima = lineas[-1] if lineas else ''
    if 'MemoryError' in ultima or 'out of memory' in ultima.lower():
        return 'El servidor se quedó sin memoria. Prueba con un video más corto.'
    return ultima[:220] or 'Algo falló al crear el video.'


def _paso(vid, orden, entorno, desde, hasta, turno, avisar=None):
    """Corre un programa del proceso y va pasando su avance a la base. Devuelve (código, errores).
    avisar(porcentaje, texto): otra forma de anotar el avance (la usan los pedazos repartidos)."""
    if turno:
        turno.acquire()
    try:
        proceso = subprocess.Popen(orden, cwd=PROGRAMAS, env=entorno, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True, encoding='utf-8', errors='replace')
        with _candado:
            _procesos[vid] = proceso
        errores = []
        hilo = threading.Thread(target=lambda: errores.append(proceso.stderr.read()), daemon=True)
        hilo.start()
        ultimo = revisado = time.time()
        for linea in proceso.stdout:
            # En GitHub no hay memoria compartida: si el usuario borró el video, la fila ya no está en la base.
            if MODO == 'github' and time.time() - revisado > 15:
                revisado = time.time()
                if not base.uno('SELECT id FROM videos WHERE id = ?', (vid,)):
                    _cancelados.add(vid)
                    proceso.kill()
                    break
            try:
                dato = json.loads(linea)
            except ValueError:
                continue
            if 'avance' in dato and time.time() - ultimo > 1:
                ultimo = time.time()
                if avisar:
                    avisar(dato['avance'], dato.get('texto'))
                    continue
                _actualizar(vid, avance=round(desde + (hasta - desde) * dato['avance'] / 100, 1), mensaje=dato.get('texto'))
        proceso.wait()
        hilo.join(5)
        return proceso.returncode, ''.join(errores)
    finally:
        if turno:
            turno.release()


def _correr(video, pasos=None, empezar_de_cero=True, guardar=True, borrar_carpeta=True):
    """Corre los pasos del video. En GitHub se puede correr solo una parte (pasos) y dejar la carpeta
    para la siguiente computadora (borrar_carpeta=False). Devuelve True si todo salió bien."""
    vid = video['id']
    carpeta = os.path.join(CARPETA, vid)
    if empezar_de_cero:
        shutil.rmtree(carpeta, ignore_errors=True)
    os.makedirs(carpeta, exist_ok=True)
    entorno = {**os.environ, 'PYTHONIOENCODING': 'utf-8'}
    try:
        for nombre, desde, hasta, orden in (pasos or PASOS):
            if vid in _cancelados:
                return False
            _actualizar(vid, estado='trabajando', fase=nombre, avance=desde, mensaje=None)
            for intento in range(1 + REINTENTOS.get(nombre, 0)):
                codigo, errores = _paso(vid, orden(carpeta, video), entorno, desde, hasta, TURNOS.get(nombre))
                if vid in _cancelados:
                    return False
                if codigo == 0:
                    break
                causa = _mensaje_de_error(carpeta, errores)
                # Los errores que no se arreglan reintentando se avisan enseguida.
                definitivo = re.search(r'No existe|no es una página|certificado|no es válido|red privada|pide pago|límite gratis', causa)
                if intento < REINTENTOS.get(nombre, 0) and not definitivo:
                    _actualizar(vid, mensaje='Falló una vez, reintentando…')
                    try:
                        os.remove(os.path.join(carpeta, 'error.json'))
                    except OSError:
                        pass
                    time.sleep(5)
                    continue
                _actualizar(vid, estado='error', mensaje=causa, terminado=time.time())
                return False
        if not guardar:
            return True
        # Guardar en el almacén del usuario
        guion = json.load(open(os.path.join(carpeta, 'guion.json'), encoding='utf-8'))
        video_mp4 = os.path.join(carpeta, 'video.mp4')
        duracion = float(subprocess.run([FFPROBE, '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video_mp4],
                                        capture_output=True, text=True).stdout or 0)
        portada = os.path.join(carpeta, 'portada.jpg')
        subprocess.run([FFMPEG, '-v', 'error', '-y', '-ss', '3', '-i', video_mp4, '-frames:v', '1', '-vf', 'scale=640:-2', portada])
        archivos = {'video.mp4': video_mp4}
        if os.path.exists(portada):
            archivos['portada.jpg'] = portada
        almacen.guardar(video['usuario_id'], vid, archivos, esperar=MODO == 'github')
        borrar_subidas(vid)
        if MODO == 'github':
            almacen.borrar_capturas(vid)
        # Se guarda de dónde salieron las capturas (solo las del usuario, combinadas o con el lector público).
        try:
            nota = json.load(open(os.path.join(carpeta, 'contenido.json'), encoding='utf-8')).get('nota') or None
        except (OSError, ValueError):
            nota = None
        _actualizar(vid, estado='listo', fase='Listo', avance=100, mensaje=nota, titulo=str(guion.get('titulo', ''))[:80],
                    duracion=round(duracion, 1), tamano=os.path.getsize(video_mp4), terminado=time.time())
        return True
    except Exception as error:
        _actualizar(vid, estado='error', mensaje='Algo falló al crear el video: ' + str(error)[:150], terminado=time.time())
        return False
    finally:
        with _candado:
            _procesos.pop(vid, None)
            _activos.discard(vid)
            _cancelados.discard(vid)
        if borrar_carpeta:
            shutil.rmtree(carpeta, ignore_errors=True)


def _repartidor():
    while True:
        try:
            with _candado:
                libres = MAX_A_LA_VEZ - len(_activos)
            if libres > 0:
                fila = base.todos("SELECT * FROM videos WHERE estado = 'en_fila' ORDER BY creado")
                # Turnos justos: primero el usuario que hace más tiempo no recibe un turno.
                fila.sort(key=lambda v: (_ultimo_turno.get(v['usuario_id'], 0), v['creado']))
                for video in fila[:libres]:
                    with _candado:
                        if video['id'] in _activos:
                            continue
                        _activos.add(video['id'])
                    _ultimo_turno[video['usuario_id']] = time.time()
                    base.ejecutar("UPDATE videos SET estado = 'trabajando', fase = 'Empezando' WHERE id = ?", (video['id'],))
                    threading.Thread(target=_correr, args=(video,), daemon=True).start()
            # Posición en la fila para los que esperan
            esperando = base.todos("SELECT id, usuario_id FROM videos WHERE estado = 'en_fila' ORDER BY creado")
            esperando.sort(key=lambda v: _ultimo_turno.get(v['usuario_id'], 0))
            for i, v in enumerate(esperando, 1):
                _actualizar(v['id'], fase='En la fila', mensaje=f'Tu video está {i}.º en la fila. Empieza cuando se libere un lugar.')
        except Exception as error:
            print('Repartidor:', error, flush=True)
        time.sleep(1.5)


def despachar(video_id):
    """Pide a GitHub Actions que haga el video. Devuelve None si salió bien, o el motivo del error."""
    import urllib.request
    pedido = urllib.request.Request(
        f'https://api.github.com/repos/{GH_REPO}/actions/workflows/{GH_FLUJO}/dispatches',
        data=json.dumps({'ref': 'main', 'inputs': {'video': video_id}}).encode(),
        headers={'Authorization': 'Bearer ' + os.environ.get('GH_TOKEN', ''), 'Accept': 'application/vnd.github+json',
                 'User-Agent': 'explicame-la-pagina'}, method='POST')
    try:
        urllib.request.urlopen(pedido, timeout=20)
        return None
    except Exception as error:
        return str(error)[:120]


def lanzar(video_id):
    """Pone el video en marcha según el modo: en GitHub se despacha; en el PC lo toma el repartidor."""
    if MODO != 'github':
        soltar(video_id)
        return
    problema = despachar(video_id)
    if problema:
        _actualizar(video_id, estado='error', mensaje='No se pudo empezar el video. Intenta de nuevo en un momento.', terminado=time.time())
    else:
        _actualizar(video_id, estado='en_fila', fase='En la fila', mensaje='Esperando una computadora libre…')


def vencidos():
    """Si un video lleva más de 80 minutos sin terminar, algo se cortó: se avisa como error."""
    base.ejecutar("UPDATE videos SET estado = 'error', mensaje = 'El video tardó demasiado y se detuvo. Intenta de nuevo.', terminado = ? "
                  "WHERE estado IN ('en_fila', 'trabajando') AND creado < ?", (time.time(), time.time() - 80 * 60))


def arrancar():
    if MODO == 'github':
        return
    os.makedirs(CARPETA, exist_ok=True)
    os.makedirs(SUBIDAS, exist_ok=True)
    base.ejecutar("UPDATE videos SET estado = 'en_fila' WHERE estado = 'preparando'")
    # Lo que quedó a medias por un reinicio vuelve a la fila desde el principio.
    base.ejecutar("UPDATE videos SET estado = 'en_fila', avance = 0, fase = 'En la fila', mensaje = 'Se reanudó después de reiniciar el servidor.' WHERE estado = 'trabajando'")
    threading.Thread(target=_repartidor, daemon=True).start()
