# Paso 3: graba la narración de cada escena con Fish Audio, solo con el modelo gratis.
# Uso: python voces.py <carpeta del trabajo>
# La clave se lee de la variable de entorno FISH_API_KEY. Si la API pide pago, se detiene.
import hashlib, json, os, subprocess, sys, threading, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor

MODELO = 's2.1-pro-free'
VOCES_A_LA_VEZ = int(os.environ.get('VOCES_A_LA_VEZ', '3'))
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
    hechas = []
    candado = threading.Lock()

    def una(n, escena):
        # El mp3 se nombra por su texto y voz: si después se agregan escenas, las ya grabadas no se repiten.
        firma = hashlib.sha1(f"{escena['voz']}|{escena['narracion']}".encode('utf-8')).hexdigest()[:16]
        mp3, wav = os.path.join(destino, f'{firma}.mp3'), os.path.join(destino, f'e{n:02d}.wav')
        if not os.path.exists(mp3):
            open(mp3, 'wb').write(grabar(escena['narracion'], escena['voz']))
        subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', mp3, '-ar', '44100', '-ac', '1', wav], check=True)
        escena['voz_segundos'] = round(duracion(wav), 3)
        with candado:
            hechas.append(n)
            print(json.dumps({'avance': round(len(hechas) / total * 100), 'texto': f'Voz {len(hechas)} de {total}'}), flush=True)

    # Varias voces a la vez; si Fish pide esperar (429), grabar() reintenta.
    try:
        with ThreadPoolExecutor(max_workers=VOCES_A_LA_VEZ) as grupo:
            for tarea in [grupo.submit(una, n, e) for n, e in enumerate(guion['escenas'], 1)]:
                tarea.result()
    except SystemExit as salida:
        print(salida, file=sys.stderr, flush=True)
        os._exit(1)
    json.dump(guion, open(os.path.join(carpeta, 'guion.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
