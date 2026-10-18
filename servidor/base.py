"""Base de datos: SQLite en el PC; PostgreSQL (Neon) si existe la variable DATABASE_URL.

Las consultas se escriben con «?» y aquí se cambian a «%s» cuando la base es PostgreSQL.
"""
import os
import sqlite3
import threading

DIRECCION = os.environ.get('DATABASE_URL', '')
ES_POSTGRES = DIRECCION.startswith('postgres')
_local = threading.local()

TABLAS = """
CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  correo TEXT UNIQUE,
  nombre TEXT NOT NULL,
  clave_hash TEXT,
  proveedor TEXT NOT NULL,
  proveedor_id TEXT,
  foto TEXT,
  creado DOUBLE PRECISION NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_proveedor ON usuarios (proveedor, proveedor_id);
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL,
  enlace TEXT NOT NULL,
  voces TEXT NOT NULL,
  minutos DOUBLE PRECISION NOT NULL,
  estado TEXT NOT NULL,
  fase TEXT,
  avance DOUBLE PRECISION DEFAULT 0,
  mensaje TEXT,
  titulo TEXT,
  duracion DOUBLE PRECISION,
  tamano BIGINT,
  creado DOUBLE PRECISION NOT NULL,
  terminado DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS videos_usuario ON videos (usuario_id, creado);
CREATE TABLE IF NOT EXISTS pendientes (
  correo TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  clave_hash TEXT NOT NULL,
  codigo_hash TEXT NOT NULL,
  vence DOUBLE PRECISION NOT NULL,
  intentos INTEGER DEFAULT 0,
  enviado DOUBLE PRECISION NOT NULL
);
CREATE TABLE IF NOT EXISTS codigos (
  correo TEXT PRIMARY KEY,
  codigo_hash TEXT NOT NULL,
  vence DOUBLE PRECISION NOT NULL,
  intentos INTEGER DEFAULT 0,
  enviado DOUBLE PRECISION NOT NULL
);
"""


def conexion():
    if getattr(_local, 'con', None) is None:
        if ES_POSTGRES:
            import psycopg
            _local.con = psycopg.connect(DIRECCION, autocommit=True)
        else:
            ruta = os.environ.get('BASE_SQLITE', os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'datos', 'base.db'))
            os.makedirs(os.path.dirname(ruta), exist_ok=True)
            _local.con = sqlite3.connect(ruta, check_same_thread=False, isolation_level=None, timeout=30)
            _local.con.execute('PRAGMA journal_mode=WAL')
    return _local.con


def _adaptar(sql):
    return sql.replace('?', '%s') if ES_POSTGRES else sql


def ejecutar(sql, parametros=()):
    for intento in range(2):
        try:
            cursor = conexion().cursor()
            cursor.execute(_adaptar(sql), parametros)
            return cursor
        except Exception:
            # Una conexión cortada (pasa con Neon cuando duerme) se vuelve a abrir una vez.
            if intento or not ES_POSTGRES:
                raise
            _local.con = None


def uno(sql, parametros=()):
    cursor = ejecutar(sql, parametros)
    fila = cursor.fetchone()
    if fila is None:
        return None
    return dict(zip([c[0] for c in cursor.description], fila))


def todos(sql, parametros=()):
    cursor = ejecutar(sql, parametros)
    nombres = [c[0] for c in cursor.description]
    return [dict(zip(nombres, f)) for f in cursor.fetchall()]


def preparar():
    for orden in TABLAS.strip().split(';'):
        if orden.strip():
            ejecutar(orden)
