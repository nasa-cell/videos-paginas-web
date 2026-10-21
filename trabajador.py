"""Hace un video en GitHub Actions: lo pide el servidor y el avance se escribe en la base (Neon).

Uso: python trabajador.py <id del video>                 visita la página, guion, voces y sonido; si el video
                                                         es corto lo graba aquí mismo, si es largo deja
                                                         «partes» en GITHUB_OUTPUT para repartir la grabación
       python trabajador.py <id> --parte <i>/<N>         graba el pedazo i de N (una computadora por pedazo)
       python trabajador.py <id> --unir                  junta los pedazos con el sonido y guarda el video
       python trabajador.py <id> --fallo                 marca error si quedó a medias
"""
import json
import os
import sys
import time

os.environ['MODO_TRABAJO'] = 'github'
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from servidor import almacen, base, trabajos  # noqa: E402

# Segundos de video que graba cada computadora; cada una más tarda ~2 min en prepararse.
SEGUNDOS_POR_COMPUTADORA = 75
MAX_COMPUTADORAS = 6
GRABAR = [p for p in trabajos.PASOS if p[0] == 'Armando el video']
ANTES_DE_GRABAR = [p for p in trabajos.PASOS if p[0] != 'Armando el video']


def computadoras_para(carpeta):
    duracion = json.load(open(os.path.join(carpeta, 'linea.json'), encoding='utf-8'))['duracion']
    return max(1, min(MAX_COMPUTADORAS, round(duracion / SEGUNDOS_POR_COMPUTADORA)))


def salida_github(nombre, valor):
    archivo = os.environ.get('GITHUB_OUTPUT')
    if archivo:
        with open(archivo, 'a', encoding='utf-8') as f:
            f.write(f'{nombre}={valor}\n')


def preparar(video):
    vid = video['id']
    if video['estado'] not in ('en_fila', 'preparando'):
        print('El video ya no está en la fila:', video['estado'])
        return
    base.ejecutar("UPDATE videos SET estado = 'trabajando', fase = 'Empezando', mensaje = NULL WHERE id = ?", (vid,))
    if almacen.bajar_capturas(vid, os.path.join(trabajos.SUBIDAS, vid)):
        print('Se usarán las capturas del usuario.')
    if not trabajos._correr(video, pasos=ANTES_DE_GRABAR, guardar=False, borrar_carpeta=False):
        return
    carpeta = os.path.join(trabajos.CARPETA, vid)
    n = computadoras_para(carpeta)
    if n == 1:
        trabajos._correr(video, pasos=GRABAR, empezar_de_cero=False)
        return
    base.ejecutar('DELETE FROM partes WHERE video_id = ?', (vid,))
    trabajos._actualizar(vid, fase='Armando el video', avance=45, mensaje=f'Grabando en {n} computadoras a la vez…')
    salida_github('partes', json.dumps(list(range(n))))
    salida_github('total', n)


def grabar_parte(video, i, n):
    vid = video['id']
    carpeta = os.path.join(trabajos.CARPETA, vid)
    desde, hasta = 45, 97

    def avisar(porcentaje, _texto):
        if base.ES_POSTGRES:
            base.ejecutar('INSERT INTO partes (video_id, parte, avance) VALUES (?, ?, ?) '
                          'ON CONFLICT (video_id, parte) DO UPDATE SET avance = EXCLUDED.avance', (vid, i, porcentaje))
        else:
            base.ejecutar('INSERT OR REPLACE INTO partes (video_id, parte, avance) VALUES (?, ?, ?)', (vid, i, porcentaje))
        suma = base.uno('SELECT COALESCE(SUM(avance), 0) AS s FROM partes WHERE video_id = ?', (vid,))['s']
        trabajos._actualizar(vid, avance=round(desde + (hasta - desde) * suma / (100 * n), 1),
                             mensaje=f'Grabando en {n} computadoras a la vez…')

    orden = [trabajos.NODE, 'grabar.js', carpeta, '--parte', f'{i}/{n}']
    codigo, errores = trabajos._paso(vid, orden, {**os.environ, 'PYTHONIOENCODING': 'utf-8'}, desde, hasta, None, avisar)
    if vid in trabajos._cancelados:
        return
    if codigo != 0:
        causa = trabajos._mensaje_de_error(carpeta, errores)
        trabajos._actualizar(vid, estado='error', mensaje=causa, terminado=time.time())
        sys.exit(1)


def unir(video):
    vid = video['id']
    pasos = [('Armando el video', 97, 100, lambda c, v: [trabajos.NODE, 'grabar.js', c, '--unir'])]
    trabajos._correr(video, pasos=pasos, empezar_de_cero=False)
    base.ejecutar('DELETE FROM partes WHERE video_id = ?', (vid,))


if __name__ == '__main__':
    video_id = sys.argv[1]
    base.preparar()
    video = base.uno('SELECT * FROM videos WHERE id = ?', (video_id,))
    if '--fallo' in sys.argv:
        if video and video['estado'] in ('en_fila', 'preparando', 'trabajando'):
            base.ejecutar("UPDATE videos SET estado = 'error', mensaje = ?, terminado = ? WHERE id = ?",
                          ('La computadora que hacía el video se detuvo. Intenta de nuevo.', time.time(), video_id))
        sys.exit(0)
    if not video:
        print('El video ya no existe (lo borraron).')
        sys.exit(0)
    if '--parte' in sys.argv:
        if video['estado'] != 'trabajando':
            sys.exit(0)
        i, n = map(int, sys.argv[sys.argv.index('--parte') + 1].split('/'))
        grabar_parte(video, i, n)
    elif '--unir' in sys.argv:
        if video['estado'] == 'trabajando':
            unir(video)
    else:
        preparar(video)
    final = base.uno('SELECT estado, mensaje FROM videos WHERE id = ?', (video_id,))
    print('Resultado:', final)
