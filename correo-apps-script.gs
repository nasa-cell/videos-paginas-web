// Envía los códigos de la página desde la cuenta de Gmail, por HTTPS.
// Se pega en script.google.com y se publica como «Aplicación web»
// (Ejecutar como: yo; Quién tiene acceso: cualquier usuario).
// CLAVE debe ser igual al secreto CORREO_SCRIPT_CLAVE del servidor.
const CLAVE = 'CAMBIAR_POR_LA_CLAVE';

function doPost(e) {
  let respuesta;
  try {
    const datos = JSON.parse(e.postData.contents);
    if (datos.clave !== CLAVE) {
      respuesta = { ok: false, error: 'clave incorrecta' };
    } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(datos.para || '')) {
      respuesta = { ok: false, error: 'correo de destino inválido' };
    } else {
      MailApp.sendEmail({
        to: datos.para,
        subject: String(datos.asunto).slice(0, 200),
        body: datos.texto,
        htmlBody: datos.html,
        name: 'Explícame la página',
      });
      respuesta = { ok: true, quedan: MailApp.getRemainingDailyQuota() };
    }
  } catch (error) {
    respuesta = { ok: false, error: String(error) };
  }
  return ContentService.createTextOutput(JSON.stringify(respuesta))
    .setMimeType(ContentService.MimeType.JSON);
}
