const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Detecta si es móvil o escritorio
function esMovil(userAgent = '') {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(userAgent);
}

// RAÍZ: móvil = app / escritorio = web
app.get('/', (req, res) => {
  const userAgent = req.headers['user-agent'] || '';

  if (esMovil(userAgent)) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }

  return res.sendFile(path.join(__dirname, 'public', 'web.html'));
});

// Forzar versión web
app.get('/web', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'web.html'));
});

// Forzar versión app
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API de módulos/modelos
app.get('/api/modulos', (req, res) => {
  try {
    const ruta = path.join(__dirname, 'data', 'modulos.json');

    if (!fs.existsSync(ruta)) {
      return res.status(500).json({
        ok: false,
        data: [],
        error: 'No existe data/modulos.json'
      });
    }

    const contenido = fs.readFileSync(ruta, 'utf8');
    const modulos = JSON.parse(contenido);

    return res.json({
      ok: true,
      data: modulos
    });
  } catch (error) {
    console.error('Error en /api/modulos:', error.message);

    return res.status(500).json({
      ok: false,
      data: [],
      error: error.message
    });
  }
});

// Guardar progreso simple
app.post('/api/progreso', (req, res) => {
  try {
    console.log('Progreso recibido:', req.body);

    return res.json({
      ok: true,
      mensaje: 'Progreso recibido correctamente'
    });
  } catch (error) {
    console.error('Error en /api/progreso:', error.message);

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    servicio: 'Chambari Academy',
    tiempo: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
