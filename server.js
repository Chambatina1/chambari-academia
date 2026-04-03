const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

app.disable("x-powered-by");
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const db = {
  progreso: [],
  modulos: [
    {
      id: 1,
      slug: "destrabar-conocimiento",
      titulo: "Destrabar conocimiento congelado",
      subtitulo: "Activación del banco cognitivo previo",
      descripcion: "El alumno reconoce que muchas veces sí sabe, pero no logra reaccionar.",
      activo: true,
      orden: 1
    },
    {
      id: 2,
      slug: "captacion-de-bloques",
      titulo: "Captación de nuevos bloques",
      subtitulo: "Ingreso estructurado de conocimiento nuevo",
      descripcion: "Cada nuevo bloque se registra con contexto, intención y reacción esperada.",
      activo: true,
      orden: 2
    },
    {
      id: 3,
      slug: "reaccion-verbal-coherente",
      titulo: "Reacción verbal coherente",
      subtitulo: "Responder con lógica e intención",
      descripcion: "No basta con saber palabras. Hay que reaccionar bien según el escenario.",
      activo: true,
      orden: 3
    },
    {
      id: 4,
      slug: "ciudadania-neuronal",
      titulo: "Ciudadanía estadounidense neuronal",
      subtitulo: "Idioma, cultura e intención social",
      descripcion: "Aprender el entorno de reacción verbal del lugar donde vives.",
      activo: true,
      orden: 4
    }
  ]
};

function cleanText(value) {
  return String(value || "").trim();
}

function sendError(res, status, message) {
  return res.status(status).json({
    ok: false,
    error: message
  });
}

app.get("/api/status", (req, res) => {
  res.status(200).json({
    ok: true,
    proyecto: "Chambari Academia",
    metodo: "Sinapsis",
    servidor: "activo",
    fecha: new Date().toISOString()
  });
});

app.get("/api/modulos", (req, res) => {
  const activos = db.modulos
    .filter((m) => m.activo)
    .sort((a, b) => a.orden - b.orden);

  res.status(200).json({
    ok: true,
    total: activos.length,
    data: activos
  });
});

app.post("/api/progreso", (req, res) => {
  try {
    const usuario = cleanText(req.body.usuario);
    const moduloId = Number(req.body.moduloId);
    const avance = Number(req.body.avance || 0);
    const respuesta = cleanText(req.body.respuesta);

    if (!usuario) {
      return sendError(res, 400, "El campo usuario es obligatorio");
    }

    if (!moduloId || Number.isNaN(moduloId)) {
      return sendError(res, 400, "El campo moduloId es obligatorio");
    }

    const moduloExiste = db.modulos.some((m) => m.id === moduloId);
    if (!moduloExiste) {
      return sendError(res, 404, "El módulo indicado no existe");
    }

    const registro = {
      id: Date.now(),
      usuario,
      moduloId,
      avance: Number.isNaN(avance) ? 0 : avance,
      respuesta,
      fecha: new Date().toISOString()
    };

    db.progreso.push(registro);

    res.status(201).json({
      ok: true,
      mensaje: "Progreso guardado correctamente",
      data: registro
    });
  } catch (error) {
    console.error("Error en /api/progreso POST:", error);
    res.status(500).json({
      ok: false,
      error: "Error interno al guardar progreso"
    });
  }
});

app.get("/api/progreso", (req, res) => {
  res.status(200).json({
    ok: true,
    total: db.progreso.length,
    data: db.progreso
  });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) {
    return sendError(res, 404, "Ruta API no encontrada");
  }

  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Servidor Sinapsis activo en puerto ${PORT}`);
});
