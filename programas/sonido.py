# Paso 5: arma el sonido del video: música hecha aquí mismo (cambia según la página),
# efectos en cada transición, clic, aparición y letra, y las voces encima.
# La música baja cuando alguien habla.
# Uso: python sonido.py <carpeta del trabajo>
import json, os, sys, wave
import numpy as np

TASA = 44100
carpeta = sys.argv[1]
linea = json.load(open(os.path.join(carpeta, 'linea.json'), encoding='utf-8'))
N = int(TASA * (linea['duracion'] + 0.5))
semilla = sum(map(ord, linea.get('titulo', ''))) % 1000
azar = np.random.default_rng(semilla)


def tiempos(s):
    return np.arange(int(TASA * s)) / TASA


def poner(pista, sonido, segundo, volumen=1.0):
    i = int(segundo * TASA)
    if i < 0:
        sonido, i = sonido[-i:], 0
    if i >= len(pista):
        return
    sonido = sonido[:len(pista) - i]
    pista[i:i + len(sonido)] += sonido * volumen


def banda(ruido, desde, hasta):
    espectro = np.fft.rfft(ruido)
    f = np.fft.rfftfreq(len(ruido), 1 / TASA)
    espectro[(f < desde) | (f > hasta)] = 0
    return np.fft.irfft(espectro, len(ruido))


def nota(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def marimba(f, largo=0.45):
    t = tiempos(largo)
    return (np.sin(2 * np.pi * f * t) * np.exp(-t * 8) + 0.3 * np.sin(2 * np.pi * f * 4 * t) * np.exp(-t * 28)) * np.minimum(1, t * 800)


def campanita(f, largo=0.9):
    t = tiempos(largo)
    return (np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t * 6)) * np.exp(-t * 4) * np.minimum(1, t * 900)


def bajo(f, largo):
    t = tiempos(largo)
    return (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * 2 * f * t)) * np.exp(-t * 3) * np.minimum(1, t * 300)


# --- Música: tres estilos, se elige uno por página ---
ESTILOS = [
    {'pulso': 60 / 112, 'acordes': [[60, 64, 67], [67, 71, 74], [69, 72, 76], [65, 69, 72]], 'timbre': marimba},
    {'pulso': 60 / 96, 'acordes': [[62, 65, 69], [58, 62, 65], [60, 64, 67], [57, 60, 64]], 'timbre': campanita},
    {'pulso': 60 / 124, 'acordes': [[64, 67, 71], [60, 64, 67], [62, 66, 69], [67, 71, 74]], 'timbre': marimba},
]
estilo = ESTILOS[semilla % len(ESTILOS)]
musica = np.zeros(N)
PULSO = estilo['pulso']
tb = tiempos(0.35)
bombo = np.sin(2 * np.pi * (50 + 110 * np.exp(-tb * 30)) * tb) * np.exp(-tb * 9)
platillo = banda(azar.standard_normal(int(TASA * 0.06)), 6000, 14000) * np.exp(-tiempos(0.06) * 70)
palma = banda(azar.standard_normal(int(TASA * 0.15)), 900, 4000) * np.exp(-tiempos(0.15) * 28)
compas, t0 = 0, 0.0
while t0 < N / TASA:
    acorde = estilo['acordes'][compas % 4]
    for pulso in range(4):
        tp = t0 + pulso * PULSO
        poner(musica, bombo, tp, 0.85)
        if pulso in (1, 3):
            poner(musica, palma, tp, 0.3)
        for medio in (0, 0.5):
            poner(musica, platillo, tp + medio * PULSO, 0.22)
        poner(musica, bajo(nota(acorde[0] - 24), PULSO * 0.9), tp, 0.42)
    for i in range(8):
        tono = acorde[[0, 1, 2, 1, 0, 2, 1, 2][i]] + (12 if compas % 2 and i in (5, 7) else 0)
        poner(musica, estilo['timbre'](nota(tono + 12)), t0 + i * PULSO / 2, 0.28)
    compas += 1
    t0 += 4 * PULSO

# --- Voces ---
voces, habla = np.zeros(N), np.zeros(N)
for e in linea['escenas']:
    with wave.open(os.path.join(carpeta, 'voz', e['voz_archivo'])) as w:
        m = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float) / 32768
    poner(voces, m / (np.max(np.abs(m)) or 1) * 0.9, e['habla'])
    a, b = int((e['habla'] - 0.25) * TASA), int((e['habla'] + e['voz_segundos'] + 0.2) * TASA)
    habla[max(0, a):b] = 1
ventana = int(TASA * 0.25)
suavizado = np.convolve(habla, np.ones(ventana) / ventana, mode='same')
musica *= (0.20 - 0.12 * suavizado) * np.minimum(1, np.arange(N) / TASA) * np.clip((N / TASA - np.arange(N) / TASA) / 2.5, 0, 1)

# --- Efectos ---
def ruido(s, desde, hasta):
    return banda(azar.standard_normal(int(TASA * s)), desde, hasta)

t = tiempos(0.5)
zas = ruido(0.5, 500, 7000) * np.sin(np.pi * t / 0.5) ** 2 * (0.5 + 0.5 * np.sin(2 * np.pi * (1 + 3 * t) * t))
t = tiempos(1.0)
viento = ruido(1.0, 200, 5000) * np.sin(np.pi * t) ** 2 * (0.3 + t)
t = tiempos(0.06)
clic = np.sin(2 * np.pi * 2400 * t) * np.exp(-t * 160) + 0.7 * np.sin(2 * np.pi * 180 * t) * np.exp(-t * 70)
t = tiempos(0.03)
tecla = ruido(0.03, 1500, 9000) * np.exp(-t * 200) + 0.5 * np.sin(2 * np.pi * 900 * t) * np.exp(-t * 150)
t = tiempos(0.14)
pop = np.sin(2 * np.pi * (300 + 900 * np.exp(-t * 35)) * t) * np.exp(-t * 26)
t = tiempos(0.35)
burbuja = np.sin(2 * np.pi * (250 + 1400 * t) * t) * np.exp(-t * 9)
golpes = np.zeros(int(TASA * 0.7))
for i in range(6):
    poner(golpes, bombo[:int(TASA * 0.12)], i * 0.09, 0.7 - i * 0.08)
t = tiempos(0.45)
falla = ruido(0.45, 100, 12000) * (np.sign(np.sin(2 * np.pi * 37 * t)) * 0.5 + 0.5) * np.exp(-t * 4)
papel = np.zeros(int(TASA * 0.5))
for i in range(3):
    poner(papel, ruido(0.08, 2000, 9000) * np.exp(-tiempos(0.08) * 40), i * 0.12, 0.8)
brillo = np.zeros(int(TASA * 1.2))
for i, n in enumerate([84, 88, 91, 96, 100]):
    poner(brillo, marimba(nota(n), 0.6), i * 0.09, 0.6)
campana = np.zeros(int(TASA * 2.6))
tc = tiempos(2.6)
for n in [72, 76, 79, 84]:
    campana += np.sin(2 * np.pi * nota(n) * tc) * np.exp(-tc * 1.6) * 0.5 + 0.2 * np.sin(2 * np.pi * nota(n) * 2.76 * tc) * np.exp(-tc * 4)
SONIDOS = {'zas': (zas, -0.15, 0.32), 'viento': (viento, -0.2, 0.3), 'clic': (clic, 0, 0.5), 'tecla': (tecla, 0, 0.18),
           'pop': (pop, 0, 0.45), 'burbuja': (burbuja, -0.05, 0.3), 'golpes': (golpes, 0, 0.35), 'falla': (falla, 0, 0.22),
           'papel': (papel, 0, 0.35), 'brillo': (brillo, 0, 0.32), 'campana': (campana, 0, 0.35)}
efectos = np.zeros(N)
for nombre, segundo in linea['eventos']:
    sonido, adelanto, vol = SONIDOS.get(nombre, SONIDOS['zas'])
    poner(efectos, sonido / (np.max(np.abs(sonido)) or 1), segundo + adelanto, vol)

mezcla = musica + voces + efectos
mezcla /= max(1.0, np.max(np.abs(mezcla)) / 0.95)
estereo = np.repeat((mezcla * 32767).astype(np.int16)[:, None], 2, axis=1)
with wave.open(os.path.join(carpeta, 'sonido.wav'), 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(TASA)
    w.writeframes(estereo.tobytes())
print(json.dumps({'avance': 100, 'texto': 'Sonido listo'}))
