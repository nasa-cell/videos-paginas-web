"""Cuentas: registro con correo y contraseña, y entrada con Google o GitHub.

Google y GitHub solo aparecen si sus claves están puestas en el servidor
(GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET y GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET).
"""
import json
import os
import re
import secrets
import time
import urllib.parse
import urllib.request
from collections import defaultdict, deque

from flask import Blueprint, jsonify, redirect, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from . import base

cuentas = Blueprint('cuentas', __name__)
CORREO = re.compile(r'^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,24}$')
NOMBRE = re.compile(r"^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]{2,40}$")


def problema_clave(clave):
    """Reglas de la contraseña: 8 a 64 caracteres, con número, mayúscula, minúscula y símbolo."""
    faltan = []
    if not 8 <= len(clave) <= 64:
        return 'La contraseña debe tener entre 8 y 64 caracteres.'
    if not re.search(r'\d', clave):
        faltan.append('un número')
    if not re.search(r'[A-ZÁÉÍÓÚÑ]', clave):
        faltan.append('una mayúscula')
    if not re.search(r'[a-záéíóúñ]', clave):
        faltan.append('una minúscula')
    if not re.search(r'[^A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ\s]', clave):
        faltan.append('un símbolo como @')
    if faltan:
        return 'A la contraseña le falta ' + (', '.join(faltan[:-1]) + ' y ' + faltan[-1] if len(faltan) > 1 else faltan[0]) + '.'
    return None
_intentos = defaultdict(deque)


def direccion_base():
    return os.environ.get('BASE_URL', request.host_url.rstrip('/'))


def proveedores():
    from . import correo as envio
    return {
        'recuperar': envio.activo(),
        'google': bool(os.environ.get('GOOGLE_CLIENT_ID') and os.environ.get('GOOGLE_CLIENT_SECRET')),
        'github': bool(os.environ.get('GITHUB_CLIENT_ID') and os.environ.get('GITHUB_CLIENT_SECRET')),
    }


def usuario_actual():
    uid = session.get('usuario')
    return base.uno('SELECT id, correo, nombre, foto, proveedor FROM usuarios WHERE id = ?', (uid,)) if uid else None


def demasiados_intentos():
    # Máximo 10 intentos de entrar cada 10 minutos por dirección.
    ip = request.headers.get('X-Forwarded-For', request.remote_addr or '').split(',')[0].strip()
    cola, ahora = _intentos[ip], time.time()
    while cola and ahora - cola[0] > 600:
        cola.popleft()
    cola.append(ahora)
    return len(cola) > 10


def iniciar(usuario_id):
    session.clear()
    session['usuario'] = usuario_id
    session.permanent = True


@cuentas.post('/api/registro')
def registro():
    datos = request.get_json(silent=True) or {}
    correo = str(datos.get('correo', '')).strip().lower()
    nombre = ' '.join(str(datos.get('nombre', '')).split())
    clave = str(datos.get('clave', ''))
    if demasiados_intentos():
        return jsonify(error='Demasiados intentos. Espera unos minutos.'), 429
    if len(correo) > 120 or not CORREO.match(correo):
        return jsonify(error='Escribe un correo válido (máximo 120 caracteres).'), 400
    if not NOMBRE.match(nombre):
        return jsonify(error='Escribe tu nombre con letras, de 2 a 40 caracteres.'), 400
    if problema_clave(clave):
        return jsonify(error=problema_clave(clave)), 400
    if base.uno('SELECT id FROM usuarios WHERE correo = ?', (correo,)):
        return jsonify(error='Ya hay una cuenta con ese correo. Entra con tu contraseña.'), 409
    from . import correo as envio
    if not envio.activo():
        # Sin correo configurado (solo en pruebas) la cuenta se crea sin confirmar.
        crear_cuenta(correo, nombre, generate_password_hash(clave))
        return jsonify(ok=True)
    # La cuenta queda pendiente hasta que escriba el código que le llega al correo.
    previo = base.uno('SELECT enviado FROM pendientes WHERE correo = ?', (correo,))
    if previo and time.time() - previo['enviado'] < 60:
        return jsonify(error='Ya te mandamos un código. Espera un minuto antes de pedir otro.'), 429
    codigo = f'{secrets.randbelow(1000000):06d}'
    try:
        envio.enviar_codigo(correo, nombre, codigo, 'registro')
    except Exception:
        return jsonify(error='No pudimos mandar el correo a esa dirección. Revisa que esté bien escrita.'), 502
    base.ejecutar('DELETE FROM pendientes WHERE correo = ?', (correo,))
    base.ejecutar('INSERT INTO pendientes (correo, nombre, clave_hash, codigo_hash, vence, intentos, enviado) VALUES (?, ?, ?, ?, ?, 0, ?)',
                  (correo, nombre, generate_password_hash(clave), generate_password_hash(codigo), time.time() + 900, time.time()))
    return jsonify(confirmar=True)


def crear_cuenta(correo, nombre, clave_hash):
    uid = secrets.token_hex(12)
    base.ejecutar('INSERT INTO usuarios (id, correo, nombre, clave_hash, proveedor, proveedor_id, creado) VALUES (?, ?, ?, ?, ?, ?, ?)',
                  (uid, correo, nombre, clave_hash, 'correo', correo, time.time()))
    iniciar(uid)


@cuentas.post('/api/registro/confirmar')
def confirmar_registro():
    datos = request.get_json(silent=True) or {}
    correo = str(datos.get('correo', '')).strip().lower()
    codigo = re.sub(r'\D', '', str(datos.get('codigo', '')))
    fila = base.uno('SELECT * FROM pendientes WHERE correo = ?', (correo,))
    if not fila or fila['vence'] < time.time():
        return jsonify(error='El código venció. Vuelve a tocar «Crear mi cuenta» para recibir otro.'), 400
    if fila['intentos'] >= 5:
        base.ejecutar('DELETE FROM pendientes WHERE correo = ?', (correo,))
        return jsonify(error='Fallaste el código 5 veces. Vuelve a crear la cuenta.'), 429
    if not check_password_hash(fila['codigo_hash'], codigo):
        base.ejecutar('UPDATE pendientes SET intentos = intentos + 1 WHERE correo = ?', (correo,))
        quedan = 4 - fila['intentos']
        return jsonify(error=f'Código incorrecto. Te quedan {quedan} intentos.' if quedan else 'Código incorrecto. Vuelve a crear la cuenta.'), 400
    base.ejecutar('DELETE FROM pendientes WHERE correo = ?', (correo,))
    if base.uno('SELECT id FROM usuarios WHERE correo = ?', (correo,)):
        return jsonify(error='Ya hay una cuenta con ese correo. Entra con tu contraseña.'), 409
    crear_cuenta(correo, fila['nombre'], fila['clave_hash'])
    return jsonify(ok=True)


@cuentas.post('/api/entrar')
def entrar():
    datos = request.get_json(silent=True) or {}
    correo = str(datos.get('correo', '')).strip().lower()
    clave = str(datos.get('clave', ''))
    if demasiados_intentos():
        return jsonify(error='Demasiados intentos. Espera unos minutos.'), 429
    fila = base.uno('SELECT id, clave_hash FROM usuarios WHERE correo = ?', (correo,))
    if not fila or not fila['clave_hash'] or not check_password_hash(fila['clave_hash'], clave):
        return jsonify(error='Correo o contraseña incorrectos.'), 401
    iniciar(fila['id'])
    return jsonify(ok=True)


@cuentas.post('/api/recuperar')
def recuperar():
    """Manda un código de 6 números al correo, solo si tiene cuenta con contraseña."""
    from . import correo as envio
    datos = request.get_json(silent=True) or {}
    correo = str(datos.get('correo', '')).strip().lower()
    if not envio.activo():
        return jsonify(error='El envío de correos no está activado en el servidor.'), 503
    if demasiados_intentos():
        return jsonify(error='Demasiados intentos. Espera unos minutos.'), 429
    if not CORREO.match(correo):
        return jsonify(error='Escribe un correo válido.'), 400
    fila = base.uno('SELECT nombre, proveedor FROM usuarios WHERE correo = ?', (correo,))
    if not fila:
        return jsonify(error='Ese correo no tiene cuenta. Revisa que esté bien escrito o crea una cuenta.'), 404
    if fila['proveedor'] != 'correo':
        return jsonify(error=f'Esa cuenta entra con {fila["proveedor"].capitalize()}, no con contraseña. Usa ese botón.'), 400
    previo = base.uno('SELECT enviado FROM codigos WHERE correo = ?', (correo,))
    if previo and time.time() - previo['enviado'] < 60:
        return jsonify(error='Ya te mandamos un código. Espera un minuto antes de pedir otro.'), 429
    codigo = f'{secrets.randbelow(1000000):06d}'
    try:
        envio.enviar_codigo(correo, fila['nombre'], codigo)
    except Exception:
        return jsonify(error='No se pudo enviar el correo ahora. Intenta en unos minutos.'), 502
    base.ejecutar('DELETE FROM codigos WHERE correo = ?', (correo,))
    base.ejecutar('INSERT INTO codigos (correo, codigo_hash, vence, intentos, enviado) VALUES (?, ?, ?, 0, ?)',
                  (correo, generate_password_hash(codigo), time.time() + 900, time.time()))
    return jsonify(ok=True)


def _revisar_codigo(correo, codigo):
    """Devuelve None si el código sirve, o (mensaje, estado) si no. Cuenta los intentos fallidos."""
    fila = base.uno('SELECT * FROM codigos WHERE correo = ?', (correo,))
    if not fila or fila['vence'] < time.time():
        return 'El código venció o no existe. Pide uno nuevo.', 400
    if fila['intentos'] >= 5:
        base.ejecutar('DELETE FROM codigos WHERE correo = ?', (correo,))
        return 'Fallaste el código 5 veces. Pide uno nuevo.', 429
    if not check_password_hash(fila['codigo_hash'], codigo):
        base.ejecutar('UPDATE codigos SET intentos = intentos + 1 WHERE correo = ?', (correo,))
        quedan = 4 - fila['intentos']
        return (f'Código incorrecto. Te quedan {quedan} intentos.' if quedan else 'Código incorrecto. Pide uno nuevo.'), 400
    return None


@cuentas.post('/api/recuperar/verificar')
def verificar_codigo():
    datos = request.get_json(silent=True) or {}
    problema = _revisar_codigo(str(datos.get('correo', '')).strip().lower(), re.sub(r'\D', '', str(datos.get('codigo', ''))))
    if problema:
        return jsonify(error=problema[0]), problema[1]
    return jsonify(ok=True)


@cuentas.post('/api/recuperar/cambiar')
def cambiar_clave():
    datos = request.get_json(silent=True) or {}
    correo = str(datos.get('correo', '')).strip().lower()
    codigo = re.sub(r'\D', '', str(datos.get('codigo', '')))
    clave = str(datos.get('clave', ''))
    if problema_clave(clave):
        return jsonify(error=problema_clave(clave)), 400
    problema = _revisar_codigo(correo, codigo)
    if problema:
        return jsonify(error=problema[0]), problema[1]
    base.ejecutar('DELETE FROM codigos WHERE correo = ?', (correo,))
    base.ejecutar('UPDATE usuarios SET clave_hash = ? WHERE correo = ?', (generate_password_hash(clave), correo))
    usuario = base.uno('SELECT id FROM usuarios WHERE correo = ?', (correo,))
    iniciar(usuario['id'])
    return jsonify(ok=True)


@cuentas.post('/api/salir')
def salir():
    session.clear()
    return jsonify(ok=True)


@cuentas.get('/api/yo')
def yo():
    return jsonify(usuario=usuario_actual(), proveedores=proveedores())


# ---------------- Google y GitHub ----------------
CONFIG = {
    'google': {
        'autorizar': 'https://accounts.google.com/o/oauth2/v2/auth',
        'token': 'https://oauth2.googleapis.com/token',
        'perfil': 'https://openidconnect.googleapis.com/v1/userinfo',
        'alcance': 'openid email profile',
    },
    'github': {
        'autorizar': 'https://github.com/login/oauth/authorize',
        'token': 'https://github.com/login/oauth/access_token',
        'perfil': 'https://api.github.com/user',
        'alcance': 'read:user user:email',
    },
}


def _pedir(direccion, datos=None, token=None):
    cabeceras = {'Accept': 'application/json', 'User-Agent': 'explicame-la-pagina'}
    if token:
        cabeceras['Authorization'] = 'Bearer ' + token
    cuerpo = urllib.parse.urlencode(datos).encode() if datos else None
    return json.loads(urllib.request.urlopen(urllib.request.Request(direccion, data=cuerpo, headers=cabeceras), timeout=20).read())


@cuentas.get('/auth/<proveedor>')
def ir_a_proveedor(proveedor):
    if not proveedores().get(proveedor):
        return redirect('/?aviso=' + urllib.parse.quote('Esa forma de entrar no está activada.'))
    estado = secrets.token_urlsafe(24)
    session['oauth_estado'] = estado
    c = CONFIG[proveedor]
    parametros = {'client_id': os.environ[proveedor.upper() + '_CLIENT_ID'], 'redirect_uri': f'{direccion_base()}/auth/{proveedor}/vuelta',
                  'scope': c['alcance'], 'state': estado, 'response_type': 'code'}
    if proveedor == 'google':
        parametros['prompt'] = 'select_account'
    return redirect(c['autorizar'] + '?' + urllib.parse.urlencode(parametros))


@cuentas.get('/auth/<proveedor>/vuelta')
def vuelta_del_proveedor(proveedor):
    if proveedor not in CONFIG or not proveedores().get(proveedor):
        return redirect('/')
    if not request.args.get('code') or request.args.get('state') != session.pop('oauth_estado', None):
        return redirect('/?aviso=' + urllib.parse.quote('No se pudo entrar. Vuelve a intentarlo.'))
    c = CONFIG[proveedor]
    try:
        token = _pedir(c['token'], {
            'client_id': os.environ[proveedor.upper() + '_CLIENT_ID'], 'client_secret': os.environ[proveedor.upper() + '_CLIENT_SECRET'],
            'code': request.args['code'], 'redirect_uri': f'{direccion_base()}/auth/{proveedor}/vuelta', 'grant_type': 'authorization_code',
        })['access_token']
        perfil = _pedir(c['perfil'], token=token)
        if proveedor == 'google':
            pid, nombre, correo, foto = perfil['sub'], perfil.get('name') or 'Usuario', perfil.get('email'), perfil.get('picture')
            if not perfil.get('email_verified'):
                correo = None
        else:
            pid, nombre, foto = str(perfil['id']), perfil.get('name') or perfil.get('login'), perfil.get('avatar_url')
            correos = _pedir('https://api.github.com/user/emails', token=token)
            correo = next((x['email'] for x in correos if x.get('primary') and x.get('verified')), None)
    except Exception:
        return redirect('/?aviso=' + urllib.parse.quote(f'{proveedor.capitalize()} no respondió. Vuelve a intentarlo.'))
    correo = correo.lower() if correo else None
    fila = base.uno('SELECT id FROM usuarios WHERE proveedor = ? AND proveedor_id = ?', (proveedor, pid))
    if not fila and correo:
        # Si ya entró antes con el otro proveedor y el mismo correo verificado, se usa esa cuenta.
        # Las cuentas con contraseña no se juntan: su correo nadie lo verificó.
        fila = base.uno("SELECT id FROM usuarios WHERE correo = ? AND proveedor <> 'correo'", (correo,))
        if not fila and base.uno('SELECT id FROM usuarios WHERE correo = ?', (correo,)):
            correo = None
    if fila:
        uid = fila['id']
        base.ejecutar('UPDATE usuarios SET foto = COALESCE(?, foto) WHERE id = ?', (foto, uid))
    else:
        uid = secrets.token_hex(12)
        base.ejecutar('INSERT INTO usuarios (id, correo, nombre, proveedor, proveedor_id, foto, creado) VALUES (?, ?, ?, ?, ?, ?, ?)',
                      (uid, correo, str(nombre)[:40], proveedor, pid, foto, time.time()))
    iniciar(uid)
    return redirect('/')
