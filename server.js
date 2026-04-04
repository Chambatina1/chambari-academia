const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();

app.use(express.json());
app.use(express.static('public'));

// HOME APP
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// WEB VERSION
app.get('/web', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'web.html'));
});

// MODULOS
app.get('/api/modulos', (req, res) => {
  try {
    const ruta = path.join(__dirname, 'data', 'modulos.json');
    const modulos = JSON.parse(fs.readFileSync(ruta, 'utf8'));

    res.json({
      ok: true,
      data: modulos
    });

  } catch (error) {
    console.log(error);

    res.json({
      ok: false,
      data: []
    });
  }
});

// PROGRESO
app.post('/api/progreso', (req, res) => {
  console.log(req.body);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('Servidor corriendo en puerto ' + PORT);
});
