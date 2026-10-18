// Abre Chrome: en el PC usa el Chrome instalado; en el servidor, el Chromium que trae Playwright.
const { chromium } = require('playwright-core');

async function abrirNavegador() {
  const opciones = { args: ['--disable-dev-shm-usage', '--no-sandbox', '--font-render-hinting=none', '--disable-blink-features=AutomationControlled'] };
  if (process.env.CHROMIUM_RUTA) return chromium.launch({ ...opciones, executablePath: process.env.CHROMIUM_RUTA });
  try { return await chromium.launch({ ...opciones, channel: 'chrome' }); }
  catch { return chromium.launch(opciones); }
}

module.exports = { abrirNavegador };
