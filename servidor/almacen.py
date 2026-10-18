"""Almacén de videos terminados de cada usuario.

Siempre se guarda una copia en el disco (carpeta «almacen»). Si existen las variables
HF_TOKEN y HF_ALMACEN (un repositorio privado de datos en Hugging Face), cada video se
sube también ahí, para que no se pierda cuando el servidor se reinicia.
"""
import os
import shutil
import threading

RAIZ = os.environ.get('CARPETA_ALMACEN', os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'almacen'))
REPO = os.environ.get('HF_ALMACEN')
TOKEN = os.environ.get('HF_TOKEN')
_api = None


def _hf():
    global _api
    if _api is None and REPO and TOKEN:
        from huggingface_hub import HfApi
        _api = HfApi(token=TOKEN)
        _api.create_repo(REPO, repo_type='dataset', private=True, exist_ok=True)
    return _api


def ruta(usuario_id, video_id, nombre):
    return os.path.join(RAIZ, usuario_id, video_id, nombre)


def guardar(usuario_id, video_id, archivos, esperar=False):
    """archivos: {nombre en el almacén: ruta local}. Copia al disco y sube a Hugging Face
    (sin esperar, salvo esperar=True: el trabajador de GitHub sí espera antes de terminar)."""
    destino = os.path.join(RAIZ, usuario_id, video_id)
    os.makedirs(destino, exist_ok=True)
    for nombre, origen in archivos.items():
        shutil.copyfile(origen, os.path.join(destino, nombre))
    if _hf():
        def subir():
            for nombre in archivos:
                try:
                    _hf().upload_file(path_or_fileobj=os.path.join(destino, nombre), path_in_repo=f'{usuario_id}/{video_id}/{nombre}',
                                      repo_id=REPO, repo_type='dataset')
                except Exception as error:
                    print('No se pudo subir al almacén:', error, flush=True)
        if esperar:
            subir()
        else:
            threading.Thread(target=subir, daemon=True).start()


def subir_capturas(video_id, carpeta):
    """El servidor deja las capturas del usuario en el almacén para que el trabajador las baje."""
    if _hf():
        _hf().upload_folder(folder_path=carpeta, path_in_repo=f'subidas/{video_id}', repo_id=REPO, repo_type='dataset')


def bajar_capturas(video_id, destino):
    """El trabajador baja las capturas del usuario (si hay). Devuelve True si bajó alguna."""
    if not _hf():
        return False
    from huggingface_hub import hf_hub_download
    archivos = [f for f in _hf().list_repo_files(REPO, repo_type='dataset') if f.startswith(f'subidas/{video_id}/')]
    os.makedirs(destino, exist_ok=True)
    for f in archivos:
        shutil.copyfile(hf_hub_download(REPO, f, repo_type='dataset', token=TOKEN), os.path.join(destino, os.path.basename(f)))
    return bool(archivos)


def borrar_capturas(video_id):
    if _hf():
        try:
            _hf().delete_folder(path_in_repo=f'subidas/{video_id}', repo_id=REPO, repo_type='dataset')
        except Exception:
            pass


def abrir(usuario_id, video_id, nombre):
    """Devuelve la ruta local del archivo, bajándolo de Hugging Face si hace falta (o None)."""
    local = ruta(usuario_id, video_id, nombre)
    if os.path.exists(local):
        return local
    if _hf():
        try:
            from huggingface_hub import hf_hub_download
            bajado = hf_hub_download(REPO, f'{usuario_id}/{video_id}/{nombre}', repo_type='dataset', token=TOKEN)
            os.makedirs(os.path.dirname(local), exist_ok=True)
            shutil.copyfile(bajado, local)
            return local
        except Exception:
            return None
    return None


def borrar(usuario_id, video_id):
    shutil.rmtree(os.path.join(RAIZ, usuario_id, video_id), ignore_errors=True)
    if _hf():
        def quitar():
            try:
                _hf().delete_folder(path_in_repo=f'{usuario_id}/{video_id}', repo_id=REPO, repo_type='dataset')
            except Exception:
                pass
        threading.Thread(target=quitar, daemon=True).start()
