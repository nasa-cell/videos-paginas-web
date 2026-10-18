# Prueba el análisis con muchas páginas de distintos tipos: visita cada una y le pide el guion a Gemini.
# Uso: python probar_enlaces.py <carpeta de resultados>
# Necesita GEMINI_API_KEY en el entorno. Corre de a dos páginas a la vez.
import concurrent.futures, json, os, subprocess, sys, time

ENLACES = [
    'https://nasa-cell.github.io/eco-cafe/', 'https://www.youtube.com/', 'https://es.wikipedia.org/wiki/Caf%C3%A9',
    'https://www.amazon.com/', 'https://www.mercadolibre.com.pe/', 'https://elcomercio.pe/', 'https://www.bbc.com/mundo',
    'https://github.com/', 'https://www.google.com/', 'https://example.com/', 'https://www.apple.com/es/', 'https://www.nasa.gov/',
    'https://www.netflix.com/pe/', 'https://www.instagram.com/', 'https://www.facebook.com/', 'https://www.reddit.com/',
    'https://stackoverflow.com/', 'https://www.gob.pe/', 'https://www.duolingo.com/', 'https://www.canva.com/',
    'https://www.w3schools.com/', 'https://www.spotify.com/pe/', 'https://www.tiktok.com/', 'https://x.com/',
    'https://www.notion.com/', 'https://www.booking.com/', 'https://store.steampowered.com/', 'https://www.nytimes.com/',
    'https://www.coursera.org/', 'https://votacciones.onrender.com/',
    # Enlaces que deben dar un aviso claro
    'https://esto-no-existe-ninguna-pagina-12345.com/', 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
]
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROGRAMAS = os.path.join(RAIZ, 'programas')


def probar(n, enlace, salida):
    carpeta = os.path.join(salida, f'{n:02d}')
    os.makedirs(carpeta, exist_ok=True)
    resultado = {'n': n, 'enlace': enlace}
    empezo = time.time()
    p = subprocess.run(['node', 'capturar.js', enlace, carpeta, '6'], cwd=PROGRAMAS, capture_output=True, text=True, encoding='utf-8', errors='replace')
    resultado['visita_s'] = round(time.time() - empezo)
    if p.returncode != 0:
        try:
            resultado['error'] = json.load(open(os.path.join(carpeta, 'error.json'), encoding='utf-8'))['causa']
        except Exception:
            resultado['error'] = (p.stderr.strip().splitlines() or ['?'])[-1][:150]
        return resultado
    contenido = json.load(open(os.path.join(carpeta, 'contenido.json'), encoding='utf-8'))
    resultado['capturas'] = len(contenido['paginas'])
    resultado['elementos'] = sum(len(x['elementos']) for x in contenido['paginas'])
    resultado['letras'] = sum(len(x['texto']) for x in contenido['paginas'])
    empezo = time.time()
    g = subprocess.run([sys.executable, 'guion.py', carpeta, 'filo,dazai', '1'], cwd=PROGRAMAS, capture_output=True, text=True, encoding='utf-8', errors='replace',
                       env={**os.environ, 'PYTHONIOENCODING': 'utf-8'})
    resultado['guion_s'] = round(time.time() - empezo)
    if g.returncode != 0:
        resultado['error_guion'] = (g.stderr.strip().splitlines() or ['?'])[-1][:150]
        return resultado
    guion = json.load(open(os.path.join(carpeta, 'guion.json'), encoding='utf-8'))
    resultado['titulo'] = guion.get('titulo')
    resultado['tipo'] = guion.get('tipo_pagina', '?')
    resultado['escenas'] = len(guion['escenas'])
    resultado['muestra'] = guion['escenas'][1]['narracion'][:140] if len(guion['escenas']) > 1 else ''
    return resultado


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    salida = sys.argv[1]
    os.makedirs(salida, exist_ok=True)
    resultados = []
    # Opcional: números de enlace separados por coma, para repetir solo esos.
    elegidos = [int(x) for x in sys.argv[2].split(',')] if len(sys.argv) > 2 else range(1, len(ENLACES) + 1)
    with concurrent.futures.ThreadPoolExecutor(2) as hilos:
        for r in hilos.map(lambda n: probar(n, ENLACES[n - 1], salida), elegidos):
            resultados.append(r)
            estado = ('ERROR: ' + r['error']) if 'error' in r else ('GUION FALLÓ: ' + r['error_guion']) if 'error_guion' in r else \
                f"{r['capturas']} capturas, {r['elementos']} elementos, {r['escenas']} escenas · «{r['titulo']}» · {r['muestra']}"
            if 'tipo' in r: estado = f"[{r['tipo']}] " + estado
            print(f"{r['n']:02d} {r['enlace'][:45]:45} {r.get('visita_s', 0):>3}s+{r.get('guion_s', 0):>3}s | {estado}", flush=True)
    json.dump(resultados, open(os.path.join(salida, f'resultados-{int(time.time())}.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
