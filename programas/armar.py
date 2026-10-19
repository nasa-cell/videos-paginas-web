# Paso 4: calcula cuándo empieza cada escena, cuándo suena cada efecto y cuánto se mueve
# la boca de cada voz. Deja todo en linea.json (para la imagen y el sonido).
# Uso: python armar.py <carpeta del trabajo>
import json, os, sys, wave
import numpy as np

CUADROS = 30
ANTES, DESPUES = 0.6, 0.55
EXTRA = {'portada': 1.3, 'cierre': 2.6}
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOCES = json.load(open(os.path.join(RAIZ, 'voces.json'), encoding='utf-8'))
TRANSICIONES = ['barrido', 'zoom', 'deslizar', 'giro', 'circulo', 'tinta', 'persianas', 'mosaico', 'falla', 'viaje', 'hoja', 'doble',
                'diagonal', 'cubo', 'rebanadas', 'remolino', 'rombo', 'telon', 'estrella', 'caida']
LETRAS = ['cae', 'ola', 'maquina', 'revuelto', 'giro3d', 'enfoque', 'rebote', 'brillo',
          'desliza', 'columpio', 'neon', 'sube', 'espejo', 'gelatina', 'arcoiris', 'lluvia']
SONIDO_TRANSICION = {'mosaico': 'golpes', 'falla': 'falla', 'viaje': 'viento', 'hoja': 'papel', 'giro': 'zas', 'circulo': 'burbuja', 'tinta': 'burbuja',
                     'cubo': 'zas', 'rebanadas': 'golpes', 'remolino': 'viento', 'rombo': 'burbuja', 'telon': 'papel', 'estrella': 'brillo', 'caida': 'pop'}
# Cómo se señalan los botones en las capturas; se van turnando en cada video.
EFECTOS = ['anillo', 'trazo', 'esquinas', 'marcador', 'flecha', 'pulso', 'lupa', 'subrayado', 'destellos']


def volumen(archivo):
    with wave.open(archivo) as w:
        muestras = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float)
        tasa = w.getframerate()
    paso = tasa // CUADROS
    fuerza = [float(np.sqrt(np.mean(muestras[i:i + paso] ** 2))) if len(muestras[i:i + paso]) else 0 for i in range(0, len(muestras), paso)]
    tope = max(fuerza) or 1
    return [round(min(1, f / tope * 1.3), 2) for f in fuerza]


def palabras_con_tiempo(texto, segundos):
    palabras = texto.split()
    pesos = [len(p) + 2 + (4 if p[-1] in ',.;:!?' else 0) for p in palabras]
    total = sum(pesos) or 1
    t, salida = 0.0, []
    for p, w in zip(palabras, pesos):
        salida.append([p, round(t / total * segundos, 3)])
        t += w
    return salida


def sin_repetir(lista, opciones, n):
    # Si Gemini repitió con la escena anterior, se toma la siguiente de la lista.
    elegido = lista[n] if lista[n] in opciones else opciones[n % len(opciones)]
    if n and elegido == lista[n - 1]:
        elegido = opciones[(opciones.index(elegido) + 1 + n) % len(opciones)]
    lista[n] = elegido
    return elegido


if __name__ == '__main__':
    carpeta = sys.argv[1]
    guion = json.load(open(os.path.join(carpeta, 'guion.json'), encoding='utf-8'))
    contenido = json.load(open(os.path.join(carpeta, 'contenido.json'), encoding='utf-8'))
    transiciones = [e.get('transicion') for e in guion['escenas']]
    letras = [e.get('letras') for e in guion['escenas']]
    escenas, eventos, reloj = [], [], 0.0
    # Cada video empieza en un efecto distinto (según su título) y los va turnando.
    efecto_inicial, capturas_vistas = sum(map(ord, guion.get('titulo', ''))) % len(EFECTOS), 0
    for n, e in enumerate(guion['escenas']):
        voz = e['voz_segundos']
        largo = ANTES + voz + DESPUES + EXTRA.get(e['tipo'], 0)
        habla = reloj + ANTES + (0.7 if e['tipo'] == 'portada' else 0)
        escena = {
            'tipo': e['tipo'], 'voz': e['voz'], 'titulo': e.get('titulo', ''), 'inicio': round(reloj, 3), 'largo': round(largo, 3),
            'habla': round(habla, 3), 'voz_segundos': voz, 'transicion': sin_repetir(transiciones, TRANSICIONES, n),
            'letras': sin_repetir(letras, LETRAS, n), 'palabras': palabras_con_tiempo(e['narracion'], voz),
            'boca': volumen(os.path.join(carpeta, 'voz', f'e{n + 1:02d}.wav')), 'voz_archivo': f'e{n + 1:02d}.wav',
        }
        if n:
            eventos.append([SONIDO_TRANSICION.get(escena['transicion'], 'zas'), round(reloj, 3)])
        if escena['letras'] == 'maquina':
            eventos += [['tecla', round(reloj + 0.35 + i * 0.045, 3)] for i in range(min(len(escena['titulo']), 30))]
        elif escena['letras'] in ('brillo', 'revuelto', 'neon', 'arcoiris'):
            eventos.append(['brillo', round(reloj + 0.4, 3)])
        if e['tipo'] == 'captura':
            p = contenido['paginas'][e['pagina'] - 1]
            escena.update({'imagen': p['archivo'], 'direccion': p['direccion'], 'marcas': [],
                           'efecto': EFECTOS[(efecto_inicial + capturas_vistas) % len(EFECTOS)]})
            capturas_vistas += 1
            for k, m in enumerate(e.get('resaltar', [])[:2]):
                clic = habla + voz * (0.18 if k == 0 else 0.58)
                escena['marcas'].append({'caja': m['caja'], 'clic': round(clic, 3), 'nota': m.get('nota', '')})
                eventos.append(['clic', round(clic, 3)])
        elif e['tipo'] == 'puntos':
            escena['puntos'] = e.get('puntos', [])[:4]
            escena['aparecen'] = [round(habla + voz * (0.08 + 0.22 * i), 3) for i in range(len(escena['puntos']))]
            eventos += [['pop', t] for t in escena['aparecen']]
        else:
            escena.update({'imagen': contenido['paginas'][0]['archivo'], 'direccion': contenido['enlace']})
            eventos.append(['brillo', round(reloj + 0.25, 3)])
            if e['tipo'] == 'cierre':
                eventos.append(['campana', round(habla + voz + 0.3, 3)])
        escenas.append(escena)
        reloj += largo
    datos = {
        'titulo': guion.get('titulo', ''), 'lema': guion.get('lema', ''), 'fondo': guion.get('fondo', 'rayos'),
        'colores': [guion.get('color_principal', '#2f6bff'), guion.get('color_oscuro', '#0d2a6e'), guion.get('color_acento', '#f5b83d')],
        'duracion': round(reloj, 3), 'escenas': escenas, 'eventos': sorted(eventos, key=lambda x: x[1]),
        'capturas': 'capturas/', 'presentadoras': {c: {'nombre': VOCES[c]['nombre'], 'color': VOCES[c]['color']} for c in guion['voces']},
    }
    json.dump(datos, open(os.path.join(carpeta, 'linea.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    print(json.dumps({'avance': 100, 'texto': f'{len(escenas)} escenas, {round(reloj)} s'}))
