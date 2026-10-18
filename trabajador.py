"""Hace un video en GitHub Actions: lo pide el servidor y el avance se escribe en la base (Neon).

Uso: python trabajador.py <id del video>
       python trabajador.py <id del video> --fallo   (marca error si quedó a medias)
"""
import os
import sys
import time

os.environ['MODO_TRABAJO'] = 'github'
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from servidor import almacen, base, trabajos  # noqa: E402

if __name__ == '__main__':
    video_id = sys.argv[1]
    video = base.uno('SELECT * FROM videos WHERE id = ?', (video_id,))
    if '--fallo' in sys.argv:
        if video and video['estado'] in ('en_fila', 'preparando', 'trabajando'):
            base.ejecutar("UPDATE videos SET estado = 'error', mensaje = ?, terminado = ? WHERE id = ?",
                          ('La computadora que hacía el video se detuvo. Intenta de nuevo.', time.time(), video_id))
        sys.exit(0)
    if not video:
        print('El video ya no existe (lo borraron).')
        sys.exit(0)
    if video['estado'] not in ('en_fila', 'preparando'):
        print('El video ya no está en la fila:', video['estado'])
        sys.exit(0)
    base.ejecutar("UPDATE videos SET estado = 'trabajando', fase = 'Empezando', mensaje = NULL WHERE id = ?", (video_id,))
    if almacen.bajar_capturas(video_id, os.path.join(trabajos.SUBIDAS, video_id)):
        print('Se usarán las capturas del usuario.')
    trabajos._correr(video)
    final = base.uno('SELECT estado, mensaje FROM videos WHERE id = ?', (video_id,))
    print('Resultado:', final)
