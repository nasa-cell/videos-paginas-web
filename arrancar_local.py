# Arranca la página en el PC para probarla: http://127.0.0.1:5090
# Lee las claves de las variables de usuario de Windows (no van escritas aquí).
import os, sys, winreg

def variable(nombre):
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Environment') as r:
            return winreg.QueryValueEx(r, nombre)[0]
    except OSError:
        return None

for nombre in ('FISH_API_KEY', 'GEMINI_API_KEY', 'SMTP_USUARIO', 'SMTP_CLAVE', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'):
    # Con CORREO_DE_PRUEBA no se usa el Gmail real: los códigos van a un archivo.
    if nombre.startswith('SMTP_') and os.environ.get('CORREO_DE_PRUEBA'):
        continue
    if not os.environ.get(nombre) and variable(nombre):
        os.environ[nombre] = variable(nombre)
os.environ.setdefault('FFMPEG', r'D:\herramientas\ffmpeg\bin\ffmpeg.exe')
os.environ.setdefault('FFPROBE', r'D:\herramientas\ffmpeg\bin\ffprobe.exe')
os.environ.setdefault('SECRET_KEY', 'solo-para-probar-en-el-pc')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from servidor.app import app
app.run(host='127.0.0.1', port=int(os.environ.get('PUERTO', 5090)), threaded=True)
