"""Envío de correos con códigos de 6 números por Gmail: para confirmar el correo de una
cuenta nueva y para cambiar la contraseña.

Dos formas de enviar, según los secretos del servidor (nunca van escritos en el código):
- CORREO_SCRIPT_URL y CORREO_SCRIPT_CLAVE: un Google Apps Script en la cuenta de Gmail
  (ver correo-apps-script.gs) recibe el correo por HTTPS y lo envía. Sirve en Render
  gratis, que bloquea los puertos de correo.
- SMTP_USUARIO y SMTP_CLAVE: la dirección de Gmail y su contraseña de aplicación (SMTP).
"""
import html
import json
import os
import urllib.request
import smtplib
import ssl
from email.message import EmailMessage

TEXTOS = {
    'registro': {
        'asunto': 'Tu código para confirmar tu correo: {codigo}',
        'motivo': 'Gracias por crear tu cuenta. Para confirmar que este correo es tuyo, usa este código:',
        'uso': 'Escríbelo en la página para terminar de crear tu cuenta.',
        'si_no': 'Si no creaste ninguna cuenta, no hagas nada: sin este código no se crea.',
    },
    'recuperar': {
        'asunto': 'Tu código para cambiar la contraseña: {codigo}',
        'motivo': 'Recibimos un pedido para cambiar la contraseña de tu cuenta. Este es tu código:',
        'uso': 'Escríbelo en la página para elegir tu contraseña nueva.',
        'si_no': 'Si no lo pediste tú, no hagas nada: tu contraseña sigue igual y nadie puede entrar sin este código.',
    },
}


def activo():
    return (bool(os.environ.get('CORREO_SCRIPT_URL') and os.environ.get('CORREO_SCRIPT_CLAVE'))
            or bool(os.environ.get('SMTP_USUARIO') and os.environ.get('SMTP_CLAVE'))
            or bool(os.environ.get('CORREO_DE_PRUEBA')))


def enviar_codigo(destino, nombre, codigo, motivo='recuperar'):
    # Solo para pruebas en el PC: el código se deja en un archivo en vez de mandarlo.
    if os.environ.get('CORREO_DE_PRUEBA') and not (os.environ.get('SMTP_USUARIO') or os.environ.get('CORREO_SCRIPT_URL')):
        with open(os.environ['CORREO_DE_PRUEBA'], 'w', encoding='utf-8') as archivo:
            archivo.write(codigo)
        return
    t = TEXTOS[motivo]
    remitente = os.environ.get('SMTP_USUARIO', '')
    mensaje = EmailMessage()
    mensaje['Subject'] = t['asunto'].format(codigo=codigo)
    mensaje['From'] = f'Explícame la página <{remitente}>'
    mensaje['To'] = destino
    nombre = html.escape(nombre)
    mensaje.set_content(
        f'Hola, {nombre}:\n\n'
        'Somos «Explícame la página», la página que convierte el enlace de una web en un video explicado.\n'
        f'{t["motivo"]}\n\n'
        f'    {codigo}\n\n'
        f'{t["uso"]} Vence en 15 minutos.\n'
        f'{t["si_no"]}\n\n'
        'El equipo de Explícame la página\n')
    cifras = ''.join(f'<td style="width:46px;height:56px;background:#10245c;border:2px solid #f5b83d;border-radius:10px;'
                     f'text-align:center;font-size:30px;font-weight:bold;color:#ffd98a">{c}</td><td style="width:6px"></td>' for c in codigo)
    mensaje.add_alternative(f"""\
<div style="background:#e6ecf7;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
 <div style="max-width:520px;margin:auto;background:#071233;color:#f4f8ff;border-radius:18px;overflow:hidden">
  <div style="padding:22px 28px;background:#0a1a4a;border-bottom:3px solid #f5b83d">
   <span style="display:inline-block;width:30px;height:30px;border-radius:8px;background:#2f6bff;vertical-align:middle;text-align:center;color:#fff;font-size:16px;line-height:30px">▶</span>
   <b style="font-size:18px;vertical-align:middle;margin-left:8px">Explícame la página</b>
  </div>
  <div style="padding:26px 28px 30px">
   <p style="font-size:17px;margin:0 0 12px">Hola, {nombre}:</p>
   <p style="color:#c4d2f5;line-height:1.55;margin:0 0 6px">Somos <b style="color:#fff">Explícame la página</b>, la página que convierte el enlace de una web en un video explicado con voces de anime.</p>
   <p style="color:#c4d2f5;line-height:1.55;margin:0 0 20px">{t['motivo']}</p>
   <table role="presentation" style="border-collapse:separate;margin:0 auto 20px"><tr>{cifras}</tr></table>
   <p style="color:#c4d2f5;line-height:1.55;margin:0 0 6px">{t['uso']} <b style="color:#ffd98a">Vence en 15 minutos.</b></p>
   <p style="color:#8ea3d6;font-size:14px;line-height:1.5;margin:18px 0 0">{t['si_no']}</p>
  </div>
 </div>
</div>""", subtype='html')
    if os.environ.get('CORREO_SCRIPT_URL'):
        enviar_por_script(mensaje)
        return
    with smtplib.SMTP_SSL('smtp.gmail.com', 465, context=ssl.create_default_context(), timeout=20) as servidor:
        servidor.login(remitente, os.environ['SMTP_CLAVE'].replace(' ', ''))
        servidor.send_message(mensaje)


def enviar_por_script(mensaje):
    """Manda el correo al Apps Script por HTTPS. Si algo falla lanza OSError."""
    texto = mensaje.get_body(('plain',)).get_content()
    pagina = mensaje.get_body(('html',)).get_content()
    datos = json.dumps({
        'clave': os.environ['CORREO_SCRIPT_CLAVE'],
        'para': mensaje['To'],
        'asunto': mensaje['Subject'],
        'texto': texto,
        'html': pagina,
    }).encode('utf-8')
    pedido = urllib.request.Request(os.environ['CORREO_SCRIPT_URL'], data=datos,
                                    headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(pedido, timeout=30) as respuesta:
            cuerpo = respuesta.read().decode('utf-8', 'replace')
    except Exception as error:
        raise OSError(f'Apps Script no respondió: {type(error).__name__}') from error
    try:
        resultado = json.loads(cuerpo)
    except ValueError:
        raise OSError('Apps Script devolvió algo que no es JSON (¿está publicado para «Cualquier usuario»?)')
    if not resultado.get('ok'):
        raise OSError(f"Apps Script no envió el correo: {resultado.get('error', 'sin detalle')}")
