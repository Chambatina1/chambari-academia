const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function esMovil(userAgent = '') {
  return /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(userAgent);
}

function esTablet(userAgent = '') {
  return /iPad|Tablet/i.test(userAgent);
}

// Entra por dominio principal:
// - iPhone/Android => app
// - iPad/Mac/PC => web
app.get('/', (req, res) => {
  const ua = req.headers['user-agent'] || '';

  if (esMovil(ua) && !esTablet(ua)) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }

  return res.sendFile(path.join(__dirname, 'public', 'web.html'));
});

app.get('/web', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'web.html'));
});

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/modulos', (req, res) => {
  try {
    const ruta = path.join(__dirname, 'data', 'modulos.json');

    if (!fs.existsSync(ruta)) {
      return res.status(500).json({
        ok: false,
        data: [],
        error: 'No existe el archivo data/modulos.json'
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

app.post('/api/progreso', (req, res) => {
  console.log('Progreso recibido:', req.body);
  res.json({
    ok: true
  });
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    servicio: 'Chambari Academy'
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
