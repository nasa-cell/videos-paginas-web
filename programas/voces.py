# Paso 3: graba la narración de cada escena con Fish Audio, solo con el modelo gratis.
# Uso: python voces.py <carpeta del trabajo>
# La clave se lee de la variable de entorno FISH_API_KEY. Si la API pide pago, se detiene.
import json, os, subprocess, sys, time, urllib.error, urllib.request

MODELO = 's2.1-pro-free'
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOCES = json.load(open(os.path.join(RAIZ, 'voces.json'), encoding='utf-8'))
FFMPEG = os.environ.get('FFMPEG', 'ffmpeg')
FFPROBE = os.environ.get('FFPROBE', 'ffprobe')
clave = os.environ.get('FISH_API_KEY') or sys.exit('Falta la clave de Fish Audio (FISH_API_KEY).')


def pedir(direccion, datos=None, cabeceras=None):
    cabeceras = {'Authorization': 'Bearer ' + clave, 'User-Agent': 'Mozilla/5.0', **(cabeceras or {})}
    return urllib.request.urlopen(urllib.request.Request(direccion, data=datos, headers=cabeceras), timeout=180).read()


def grabar(texto, voz):
    for intento in range(5):
        try:
            return pedir('https://api.fish.audio/v1/tts',
                         json.dumps({'text': texto, 'reference_id': VOCES[voz]['id'], 'format': 'mp3'}).encode('utf-8'),
                         {'Content-Type': 'application/json', 'model': MODELO})
        except urllib.error.HTTPError as error:
            if error.code == 402:
                sys.exit('Fish Audio pide pago para seguir. Se detuvo para no cobrar nada.')
            if error.code in (429, 500, 502, 503) and intento < 4:
                time.sleep(8 + intento * 10)
                continue
            sys.exit(f'Fish Audio respondió con error {error.code}.')
        except Exception as error:
            if intento < 4:
                time.sleep(5)
                continue
            sys.exit('No se pudo conectar con Fish Audio: ' + str(error)[:100])


def duracion(archivo):
    salida = subprocess.run([FFPROBE, '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', archivo],
                            capture_output=True, text=True).stdout
    return float(salida)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    carpeta = sys.argv[1]
    destino = os.path.join(carpeta, 'voz')
    os.makedirs(destino, exist_ok=True)
    guion = json.load(open(os.path.join(carpeta, 'guion.json'), encoding='utf-8'))
    total = len(guion['escenas'])
    for n, escena in enumerate(guion['escenas'], 1):
        mp3, wav = os.path.join(destino, f'e{n:02d}.mp3'), os.path.join(destino, f'e{n:02d}.wav')
        if not os.path.exists(mp3):
            open(mp3, 'wb').write(grabar(escena['narracion'], escena['voz']))
        subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', mp3, '-ar', '44100', '-ac', '1', wav], check=True)
        escena['voz_segundos'] = round(duracion(wav), 3)
        print(json.dumps({'avance': round(n / total * 100), 'texto': f'Voz {n} de {total}'}), flush=True)
    json.dump(guion, open(os.path.join(carpeta, 'guion.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
