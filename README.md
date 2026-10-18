# Explícame la página

Pega el enlace de una página web y recibe un **video que la explica**, contado por voces de anime:
de qué trata, para qué se creó y cómo se usa, con zoom a cada botón, música, efectos y subtítulos.
Si la página es informativa (un artículo, una noticia, Wikipedia), el video enseña el tema.

**Página:** _se publica pronto_

## Qué puedes hacer

- Crear tu cuenta con tu correo (llega un código para confirmarlo) y recuperar la contraseña si la olvidas.
- Elegir **una o dos voces** entre 16 y la **duración**: 1, 2, 3 o 5 minutos.
- Tener **hasta 3 videos creándose a la vez**. Puedes cerrar la página: siguen creándose y suena un aviso al terminar.
- Subir **tus propias capturas** (opcional) si la página pide iniciar sesión o no deja entrar a programas.
- Guardar tus videos en **Mi almacén** para verlos, descargarlos o borrarlos, con la fecha y hora en que se crearon.

## Cómo se hace un video

1. **Visitar:** un navegador automático recorre la página, cierra los avisos de cookies y saca capturas.
2. **Guion:** Gemini mira las capturas y escribe qué decir en cada escena.
3. **Voces:** Fish Audio graba cada frase.
4. **Armar:** la plantilla dibuja cada cuadro (fondos, 12 transiciones, 8 animaciones de letras) y se une con la música.

## Dónde funciona cada parte

| Parte | Dónde | Plan |
|---|---|---|
| Página (cuentas, pedidos, almacén) | Render | gratis |
| Creación de cada video | GitHub Actions de este repositorio | gratis |
| Cuentas y avance | Neon (PostgreSQL) | gratis |
| Videos terminados | Repositorio privado de datos en Hugging Face | gratis |

## Claves (nunca van en el código)

En **Render**: `DATABASE_URL`, `GH_TOKEN`, `HF_TOKEN`, `SMTP_USUARIO`, `SMTP_CLAVE`, `BASE_URL`
(las demás están en `render.yaml`).
En **GitHub → Settings → Secrets → Actions**: `DATABASE_URL`, `GEMINI_API_KEY`, `FISH_API_KEY`, `HF_TOKEN`, `HF_ALMACEN`.

## Probar en el PC

Necesita Python 3.11, Node.js 22, ffmpeg y Chrome.

```
pip install -r requirements.txt
npm install
python arrancar_local.py
```

Abre `http://127.0.0.1:5090`. En el PC los videos se hacen en la misma computadora.

## Límites

- Solo páginas públicas. Algunas bloquean a los programas (Stack Overflow, NYTimes, Reddit): en esas, sube tus capturas.
- Las voces imitan a personajes de anime: úsalas para fines personales o educativos.
