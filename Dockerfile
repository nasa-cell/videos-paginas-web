FROM python:3.11-slim

# ffmpeg para el video, Node.js para el navegador automático y fuentes (con emojis) para que las páginas se vean bien.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg curl ca-certificates gnupg fonts-noto-color-emoji fonts-noto-core fonts-noto-cjk fonts-liberation fonts-dejavu-core \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PYTHONUNBUFFERED=1 \
    CALIDAD=720 \
    MAX_A_LA_VEZ=3

WORKDIR /app
COPY requirements.txt package.json ./
RUN pip install --no-cache-dir -r requirements.txt \
 && npm install --omit=dev --no-audit --no-fund \
 && npx playwright-core install --with-deps chromium

RUN useradd -m -u 1000 usuario && mkdir -p /app/datos /app/almacen /app/trabajos && chown -R 1000:1000 /app
COPY --chown=1000:1000 . .
USER 1000

EXPOSE 7860
CMD ["gunicorn", "-w", "1", "--threads", "16", "-b", "0.0.0.0:7860", "--timeout", "120", "servidor.app:app"]
