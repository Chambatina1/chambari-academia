const express = require("express");
const path = require("path");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 10000;

// =========================
// CONFIGURACIÓN GENERAL
// =========================
app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// =========================
// BASE TEMPORAL EN MEMORIA
// =========================
// Esto es suficiente por ahora.
// Más adelante lo cambias por PostgreSQL si quieres usuarios reales.
const db = {
  progreso: [],
  modulos: [
    {
      id: 1,
      slug: "destrabar-conocimiento",
      titulo: "Destrabar conocimiento congelado",
      subtitulo: "Activación del banco cognitivo previo",
      descripcion:
        "El alumno reconoce que muchas veces sí sabe, pero no logra reaccionar. Aquí se organiza y destraba lo ya aprendido.",
      activo: true,
      orden: 1
    },
    {
      id: 2,
      slug: "captacion-de-bloques",
      titulo: "Captación de nuevos bloques",
      subtitulo: "Ingreso estructurado de conocimiento nuevo",
      descripcion:
        "Cada nuevo bloque se registra con contexto, intención, forma verbal, variantes y reacción esperada.",
      activo: true,
      orden: 2
    },
    {
      id: 3,
      slug: "reaccion-verbal-coherente",
      titulo: "Reacción verbal coherente",
      subtitulo: "Responder con lógica e intención",
      descripcion:
        "No basta con saber palabras. Hay que reaccionar de forma correcta según el escenario humano y cultural.",
      activo: true,
      orden: 3
    },
    {
      id: 4,
      slug: "ciudadania-neuronal",
      titulo: "Ciudadanía estadounidense neuronal",
      subtitulo: "Idioma, cultura e intención social",
      descripcion:
        "Aprender el entorno de reacción verbal del lugar donde vives, no solo la gramática.",
      activo: true,
      orden: 4
    }
  ],
  biblioteca: [
    {
      id: 1,
      nombre: "Ciudadanía neuronal",
      tipo: "pdf",
      estado: "pendiente"
    },
    {
      id: 2,
      nombre: "Bloques cognitivos funcionales",
      tipo: "pdf",
      estado: "pendiente"
    }
  ]
};

// =========================
// FUNCIONES AUXILIARES
// =========================
function cleanText(value) {
  return String(value || "").trim();
}

function sendError(res, status, message) {
  return res.status(status).json({
    ok: false,
    error: message
  });
}

// =========================
// RUTAS API
// =========================

// Estado del servidor
app.get("/api/status", (req, res) => {
  res.status(200).json({
    ok: true,
    proyecto: "Chambari Academia",
    metodo: "Sinapsis",
    servidor: "activo",
    fecha: new Date().toISOString()
  });
});

// Obtener todos los módulos activos
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

// Obtener un módulo por ID
app.get("/api/modulos/:id", (req, res) => {
  const id = Number(req.params.id);
  const modulo = db.modulos.find((m) => m.id === id);

  if (!modulo) {
    return sendError(res, 404, "Módulo no encontrado");
  }

  res.status(200).json({
    ok: true,
    data: modulo
  });
});

// Obtener biblioteca
app.get("/api/biblioteca", (req, res) => {
  res.status(200).json({
    ok: true,
    total: db.biblioteca.length,
    data: db.biblioteca
  });
});

// Guardar progreso
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

// Ver todo el progreso
app.get("/api/progreso", (req, res) => {
  res.status(200).json({
    ok: true,
    total: db.progreso.length,
    data: db.progreso
  });
});

// Ver progreso por usuario
app.get("/api/progreso/usuario/:nombre", (req, res) => {
  try {
    const nombre = cleanText(req.params.nombre).toLowerCase();

    const resultados = db.progreso.filter(
      (item) => item.usuario.toLowerCase() === nombre
    );

    res.status(200).json({
      ok: true,
      usuario: nombre,
      total: resultados.length,
      data: resultados
    });
  } catch (error) {
    console.error("Error en /api/progreso/usuario/:nombre:", error);
    res.status(500).json({
      ok: false,
      error: "Error interno al consultar progreso"
    });
  }
});

// Reinicio manual de progreso en memoria
app.delete("/api/progreso", (req, res) => {
  db.progreso.length = 0;

  res.status(200).json({
    ok: true,
    mensaje: "Progreso temporal reiniciado"
  });
});

// =========================
// RUTA PRINCIPAL WEB
// =========================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// =========================
// MANEJO DE RUTAS NO API
// =========================
app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) {
    return sendError(res, 404, "Ruta API no encontrada");
  }

  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// =========================
// INICIO DEL SERVIDOR
// =========================
app.listen(PORT, () => {
  console.log(`Servidor Sinapsis activo en puerto ${PORT}`);
});
