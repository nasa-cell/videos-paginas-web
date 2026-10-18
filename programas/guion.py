# Paso 2: Gemini mira las capturas y el texto de la página y escribe el guion del video.
# Uso: python guion.py <carpeta del trabajo> <voces separadas por coma> <minutos>
# La clave se lee de la variable de entorno GEMINI_API_KEY.
import base64, json, os, sys, time, urllib.error, urllib.request

MODELOS = ['gemini-flash-latest', 'gemini-flash-lite-latest']
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOCES = json.load(open(os.path.join(RAIZ, 'voces.json'), encoding='utf-8'))
PALABRAS_POR_MINUTO = 118
FONDOS = ['aurora', 'galaxia', 'olas', 'neon', 'burbujas', 'comic', 'rayos']
TRANSICIONES = ['barrido', 'zoom', 'deslizar', 'giro', 'circulo', 'tinta', 'persianas', 'mosaico', 'falla', 'viaje', 'hoja', 'doble']
LETRAS = ['cae', 'ola', 'maquina', 'revuelto', 'giro3d', 'enfoque', 'rebote', 'brillo']

INSTRUCCIONES = """Eres el guionista de un video explicativo de {MINUTOS} minuto(s) sobre una página web.
Te doy capturas de la página (1920x1080; algunas son partes más abajo de la misma página) y, por
cada una, su texto visible y una lista numerada de elementos con su caja [x, y, ancho, alto].

PRIMERO decide qué tipo de página es:
- "informativa": su objetivo es dar a conocer un tema (artículo, enciclopedia, noticia, blog, página
  de un lugar, biografía, guía, tutorial escrito). Entonces el video ENSEÑA EL TEMA: explica las ideas
  principales, los datos, fechas, causas, ejemplos y conclusiones que trae la página, en orden, como una
  clase clara. Casi no hables de botones ni menús; menciona en una frase quién la publica y de qué trata.
  Resalta títulos, imágenes, tablas y datos que ilustran lo que se explica.
- "servicio": la gente la usa para hacer algo (tienda, red social, aplicación, plataforma, buscador,
  formulario, emprendimiento que vende). Entonces explica DE QUÉ TRATA, PARA QUÉ SIRVE, PARA QUÉ FUE
  CREADA y CÓMO FUNCIONA: qué hay en cada sección, qué botones usar y para qué, y qué pasos sigue quien la usa.
- "mixta": tiene las dos cosas; reparte el video entre enseñar el tema y explicar cómo se usa.
Lo que muestres en pantalla sale de la página. Si el sitio es muy conocido, puedes contar datos
públicos seguros sobre él (quién lo creó, cuándo y para qué); si no estás seguro de un dato, no
lo digas. No inventes nada. Escribe en español latino, cálido y claro. Los números se escriben
como se dicen ("quince soles", no "S/ 15"). No repitas palabras en una misma frase.

{QUIENES}

Devuelve SOLO JSON:
{
 "tipo_pagina": "informativa" | "servicio" | "mixta",
 "titulo": "nombre corto del sitio (o del tema, si es informativa)",
 "lema": "frase corta para la portada",
 "color_principal": "#hex tomado de la página",
 "color_oscuro": "#hex oscuro de la página",
 "color_acento": "#hex de acento de la página",
 "fondo": uno de {FONDOS} (el que mejor combine con el estilo de la página),
 "escenas": [
  {
   "tipo": "portada" | "captura" | "puntos" | "cierre",
   "voz": {CLAVES},
   "narracion": "lo que dice (18 a 32 palabras)",
   "titulo": "título corto en pantalla (máx. 5 palabras)",
   "pagina": número de captura (solo en "captura"),
   "resaltar": [{"elemento": número de elemento de esa captura, "nota": "2 a 4 palabras"}] (1 o 2, solo en "captura"),
   "puntos": ["3 o 4 ideas muy cortas, cada una empieza con un emoji"] (solo en "puntos"),
   "transicion": uno de {TRANSICIONES},
   "letras": uno de {LETRAS} (cómo aparece el título)
  }
 ]
}
Reglas: alrededor de {ESCENAS} escenas; la primera "portada" y la última "cierre"; si es "servicio" o
"mixta", justo después de la portada, una escena que cuente para qué y por qué se creó el sitio (si es
conocido: quién y en qué año); si es "informativa", después de la portada di de qué tema trata y por qué
importa, y el cierre resume lo aprendido; la mayoría de escenas son "captura", repartidas en todas las capturas; agrega escenas
"puntos" para resumir (una cada 6 escenas más o menos); en total unas {PALABRAS} palabras de
narración; no repitas la misma transición ni la misma animación de letras en escenas seguidas;
lo que se resalta debe ser lo que la narración menciona."""


def leer_clave():
    clave = os.environ.get('GEMINI_API_KEY')
    if not clave:
        sys.exit('Falta la clave de Gemini (GEMINI_API_KEY).')
    return clave


def instrucciones(claves, minutos):
    if len(claves) == 1:
        v = VOCES[claves[0]]
        quienes = f'Narra un solo personaje de anime: "{claves[0]}" ({v["nombre"]}: {v["caracter"]}). Habla directo a quien mira.'
    else:
        partes = ' y '.join(f'"{c}" ({VOCES[c]["nombre"]}: {VOCES[c]["caracter"]})' for c in claves)
        quienes = (f'Narran dos personajes de anime que se turnan y a veces se hablan por su nombre: {partes}. '
                   f'"{claves[0]}" presenta y cierra.')
    escenas = round(minutos * 6) + 2
    reemplazos = {'{MINUTOS}': str(minutos), '{QUIENES}': quienes, '{CLAVES}': ' | '.join(f'"{c}"' for c in claves),
                  '{FONDOS}': json.dumps(FONDOS), '{TRANSICIONES}': json.dumps(TRANSICIONES), '{LETRAS}': json.dumps(LETRAS),
                  '{ESCENAS}': str(escenas), '{PALABRAS}': str(minutos * PALABRAS_POR_MINUTO)}
    texto = INSTRUCCIONES
    for a, b in reemplazos.items():
        texto = texto.replace(a, b)
    return texto


def armar_pedido(carpeta, claves, minutos):
    contenido = json.load(open(os.path.join(carpeta, 'contenido.json'), encoding='utf-8'))
    partes = [{'text': instrucciones(claves, minutos)}]
    if contenido.get('aviso'):
        partes.append({'text': f"\nNOTA: el programa no pudo ver la página por sí mismo ({contenido['aviso']}). "
                               "El video se hace con las capturas que subió el usuario; explica lo que se ve en ellas."})
    for p in contenido['paginas']:
        if p.get('subida'):
            partes.append({'text': f"\n=== CAPTURA {p['numero']} (subida por el usuario, 1920x1080): no trae lista de elementos. "
                                   'Para resaltar algo de esta captura usa {"caja_1000": [ymin, xmin, ymax, xmax], "nota": "..."}, '
                                   'con la posición del objeto en la imagen normalizada de 0 a 1000 (como en detección de objetos). '
                                   'Elige cosas que se vean claras: un título, un botón, una foto o un dato.'})
        else:
            lista = '\n'.join(f"  {i + 1}. <{e['tipo']}> «{e['texto']}» caja {e['caja']}" for i, e in enumerate(p['elementos']))
            partes.append({'text': f"\n=== CAPTURA {p['numero']} (parte {p.get('parte', 1)}): {p['titulo']} ({p['direccion']})\nTEXTO:\n{p['texto'][:2500]}\nELEMENTOS:\n{lista}"})
        imagen = open(os.path.join(carpeta, 'capturas', p['archivo']), 'rb').read()
        partes.append({'inline_data': {'mime_type': 'image/jpeg', 'data': base64.b64encode(imagen).decode()}})
    return contenido, {'contents': [{'role': 'user', 'parts': partes}],
                       'generationConfig': {'responseMimeType': 'application/json', 'temperature': 0.8}}


AGOTADOS = os.path.join(os.environ.get('CARPETA_TRABAJOS', os.path.join(RAIZ, 'trabajos')), 'gemini-agotados.json')


def agotados():
    try:
        return {m: hasta for m, hasta in json.load(open(AGOTADOS, encoding='utf-8')).items() if hasta > time.time()}
    except (OSError, ValueError):
        return {}


def marcar_agotado(modelo):
    lista = agotados()
    lista[modelo] = time.time() + 6 * 3600   # se vuelve a probar en unas horas
    try:
        os.makedirs(os.path.dirname(AGOTADOS), exist_ok=True)
        json.dump(lista, open(AGOTADOS, 'w', encoding='utf-8'))
    except OSError:
        pass


def pedir_gemini(pedido, clave):
    ultimo = ''
    saltar = agotados()
    # Los modelos con el cupo del día agotado van al final (por si ya se renovó).
    for modelo in sorted(MODELOS, key=lambda m: m in saltar):
        for intento in range(3):
            direccion = f'https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent'
            solicitud = urllib.request.Request(direccion, json.dumps(pedido).encode(),
                                               {'Content-Type': 'application/json', 'x-goog-api-key': clave})
            try:
                respuesta = json.loads(urllib.request.urlopen(solicitud, timeout=300).read())
                return modelo, json.loads(respuesta['candidates'][0]['content']['parts'][0]['text'])
            except urllib.error.HTTPError as error:
                cuerpo = error.read().decode('utf-8', 'replace')
                ultimo = f'{error.code} {cuerpo[:200]}'
                if error.code == 429:
                    # Cupo del día agotado: se pasa enseguida al otro modelo y se recuerda hasta mañana.
                    if 'PerDay' in cuerpo or 'per day' in cuerpo.lower():
                        marcar_agotado(modelo)
                        break
                    if intento == 0:
                        time.sleep(15)
                        continue
                    break
                if error.code in (500, 503) and intento < 2:
                    time.sleep(10 + intento * 10)
                    continue
                break
            except (KeyError, IndexError, json.JSONDecodeError) as error:
                ultimo = f'respuesta rota: {error}'
            except Exception as error:
                ultimo = str(error)
                time.sleep(5)
    if ultimo.startswith('429'):
        sys.exit('Gemini llegó a su límite gratis por ahora. Intenta en unos minutos.')
    sys.exit('Gemini no pudo escribir el guion. ' + ultimo[:120])


def revisar(guion, contenido, claves):
    paginas = {p['numero']: p for p in contenido['paginas']}
    escenas = []
    for e in guion.get('escenas', []):
        if not e.get('narracion', '').strip():
            continue
        if e.get('voz') not in claves:
            e['voz'] = claves[len(escenas) % len(claves)]
        if e.get('tipo') == 'captura':
            p = paginas.get(e.get('pagina'))
            if not p:
                e['tipo'] = 'puntos'
                e.setdefault('puntos', [])
            else:
                marcas = []
                for m in e.get('resaltar', []):
                    if isinstance(m, int):
                        m = {'elemento': m, 'nota': ''}
                    if not isinstance(m, dict):
                        continue
                    if isinstance(m.get('elemento'), int) and 1 <= m['elemento'] <= len(p['elementos']):
                        marcas.append({'caja': p['elementos'][m['elemento'] - 1]['caja'], 'nota': str(m.get('nota', ''))[:28]})
                    elif p.get('subida') and isinstance(m.get('caja_1000'), list) and len(m['caja_1000']) == 4 \
                            and all(isinstance(v, (int, float)) for v in m['caja_1000']):
                        # Posición que Gemini vio en la imagen (0 a 1000), pasada a píxeles de 1920x1080 con un margen.
                        y0, x0, y1, x1 = [min(1000, max(0, float(v))) for v in m['caja_1000']]
                        if x1 - x0 < 8 or y1 - y0 < 8:
                            continue
                        x, y = x0 / 1000 * 1920 - 12, y0 / 1000 * 1080 - 12
                        w, h = (x1 - x0) / 1000 * 1920 + 24, (y1 - y0) / 1000 * 1080 + 24
                        x, y = max(0, x), max(0, y)
                        marcas.append({'caja': [round(x), round(y), round(min(w, 1920 - x)), round(min(h, 1080 - y))], 'nota': str(m.get('nota', ''))[:28]})
                    elif isinstance(m.get('caja'), list) and len(m['caja']) == 4 and all(isinstance(v, (int, float)) for v in m['caja']):
                        # Caja que Gemini calculó mirando la imagen: se ajusta para que quede dentro de la pantalla.
                        x, y, w, h = [float(v) for v in m['caja']]
                        x, y = min(max(0, x), 1900), min(max(0, y), 1060)
                        w, h = min(max(20, w), 1920 - x), min(max(20, h), 1080 - y)
                        marcas.append({'caja': [round(x), round(y), round(w), round(h)], 'nota': str(m.get('nota', ''))[:28]})
                e['resaltar'] = marcas[:2]
        if e.get('tipo') == 'puntos' and not e.get('puntos'):
            e['puntos'] = [e.get('titulo', '')]
        if e.get('tipo') not in ('portada', 'captura', 'puntos', 'cierre'):
            e['tipo'] = 'puntos'
            e.setdefault('puntos', [e.get('titulo', '')])
        escenas.append(e)
    if len(escenas) < 3:
        sys.exit('Gemini devolvió un guion incompleto.')
    escenas[0]['tipo'] = 'portada'
    escenas[-1]['tipo'] = 'cierre'
    guion['escenas'] = escenas
    if guion.get('fondo') not in FONDOS:
        guion['fondo'] = FONDOS[sum(map(ord, contenido['enlace'])) % len(FONDOS)]
    return sum(len(e['narracion'].split()) for e in escenas)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    carpeta, voces_texto, minutos = sys.argv[1], sys.argv[2], float(sys.argv[3])
    claves = [c for c in voces_texto.split(',') if c in VOCES][:2] or ['filo']
    contenido, pedido = armar_pedido(carpeta, claves, minutos)
    modelo, guion = pedir_gemini(pedido, leer_clave())
    palabras = revisar(guion, contenido, claves)
    guion.update({'modelo': modelo, 'voces': claves, 'minutos': minutos})
    json.dump(guion, open(os.path.join(carpeta, 'guion.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps({'avance': 100, 'texto': f'{len(guion["escenas"])} escenas, {palabras} palabras'}))
