const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();

// ===== ASEGURAR CARPETAS =====
const pdfDir = path.join(__dirname, "public", "pdfs");
fs.mkdirSync(pdfDir, { recursive: true });

// ===== CONFIG =====
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || "https://chambari-academia.onrender.com";

// ===== MIDDLEWARE =====
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ===== CONEXIÓN DB =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ===== MULTER PDF =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, pdfDir);
  },
  filename: (req, file, cb) => {
    const safeExt = path.extname(file.originalname || ".pdf").toLowerCase();
    const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`;
    cb(null, fileName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const isPdfMime = file.mimetype === "application/pdf";
    const isPdfExt = path.extname(file.originalname || "").toLowerCase() === ".pdf";

    if (isPdfMime || isPdfExt) {
      return cb(null, true);
    }

    cb(new Error("Solo se permiten archivos PDF"));
  }
});

// ===== HELPERS =====
async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS modules (
      id SERIAL PRIMARY KEY,
      titulo TEXT NOT NULL,
      descripcion TEXT,
      publicado BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lessons (
      id SERIAL PRIMARY KEY,
      module_id INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
      titulo TEXT NOT NULL,
      youtube_url TEXT DEFAULT '',
      pdf_url TEXT DEFAULT '',
      publicado BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      nombre TEXT,
      email TEXT UNIQUE,
      password TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

// ===== RAÍZ =====
app.get("/", (req, res) => {
  res.send("Chambari Academy backend funcionando");
});

// ===== API BASE =====
app.get("/api", (req, res) => {
  res.json({ ok: true, message: "Chambari Academy API funcionando" });
});

// ===== TEST DB =====
app.get("/api/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ ok: true, time: result.rows[0] });
  } catch (err) {
    console.error("DB ERROR:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===== INIT DB =====
app.get("/api/init-db", async (req, res) => {
  try {
    await initDatabase();

    const countModules = await pool.query("SELECT COUNT(*)::int AS total FROM modules");
    const totalModules = countModules.rows[0].total;

    if (totalModules === 0) {
      const moduleInsert = await pool.query(`
        INSERT INTO modules (titulo, descripcion, publicado)
        VALUES ('Primer módulo', 'Introducción inicial', true)
        RETURNING id
      `);

      const moduleId = moduleInsert.rows[0].id;

      await pool.query(
        `INSERT INTO lessons (module_id, titulo, youtube_url, pdf_url, publicado)
         VALUES ($1, $2, $3, $4, true)`,
        [
          moduleId,
          "Primera clase",
          "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          "",
        ]
      );
    }

    res.json({ ok: true, message: "Base de datos creada correctamente" });
  } catch (err) {
    console.error("INIT DB ERROR:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===== REGISTRO =====
app.post("/api/register", async (req, res) => {
  try {
    const { nombre, email, password } = req.body;

    if (!nombre || !email || !password) {
      return res.status(400).json({ ok: false, error: "Faltan datos" });
    }

    const result = await pool.query(
      "INSERT INTO students (nombre, email, password) VALUES ($1,$2,$3) RETURNING id, nombre, email",
      [nombre, email, password]
    );

    res.json({ ok: true, user: result.rows[0] });
  } catch (err) {
    console.error("REGISTER ERROR:", err);

    if (err.code === "23505") {
      return res.status(400).json({ ok: false, error: "Email ya existe" });
    }

    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===== SUBIR PDF =====
app.post("/api/upload-pdf", upload.single("pdf"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No se recibió ningún PDF" });
    }

    const url = `${BASE_URL}/pdfs/${req.file.filename}`;
    res.json({
      ok: true,
      url,
      filename: req.file.filename
    });
  } catch (err) {
    console.error("UPLOAD PDF ERROR:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===== CREAR MÓDULO =====
app.post("/api/module", async (req, res) => {
  try {
    const { titulo, descripcion } = req.body;

    if (!titulo || !titulo.trim()) {
      return res.status(400).json({ ok: false, error: "Título requerido" });
    }

    const result = await pool.query(
      "INSERT INTO modules (titulo, descripcion, publicado) VALUES ($1,$2,true) RETURNING *",
      [titulo.trim(), (descripcion || "").trim()]
    );

    res.json({ ok: true, module: result.rows[0] });
  } catch (err) {
    console.error("MODULE ERROR:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===== CREAR CLASE =====
app.post("/api/lesson", async (req, res) => {
  try {
    const { module_id, titulo, youtube_url, pdf_url } = req.body;

    if (!module_id || !titulo || !String(titulo).trim()) {
      return res.status(400).json({ ok: false, error: "Datos incompletos" });
    }

    const result = await pool.query(
      `INSERT INTO lessons (module_id, titulo, youtube_url, pdf_url, publicado)
       VALUES ($1,$2,$3,$4,true)
       RETURNING *`,
      [
        Number(module_id),
        String(titulo).trim(),
        (youtube_url || "").trim(),
        (pdf_url || "").trim()
      ]
    );

    res.json({ ok: true, lesson: result.rows[0] });
  } catch (err) {
    console.error("LESSON ERROR:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===== VER MÓDULOS =====
app.get("/api/modules", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM modules WHERE publicado = true ORDER BY id ASC"
    );

    res.json({ ok: true, modules: result.rows });
  } catch (err) {
    console.error("GET MODULES ERROR:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===== VER CLASES DE UN MÓDULO =====
app.get("/api/lessons/:moduleId", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM lessons WHERE module_id = $1 AND publicado = true ORDER BY id ASC",
      [req.params.moduleId]
    );

    res.json({ ok: true, lessons: result.rows });
  } catch (err) {
    console.error("GET LESSONS ERROR:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===== ERROR MULTER / GENERAL =====
app.use((err, req, res, next) => {
  console.error("ERROR GENERAL:", err);

  if (err instanceof multer.MulterError) {
    return res.status(400).json({ ok: false, error: err.message });
  }

  if (err.message === "Solo se permiten archivos PDF") {
    return res.status(400).json({ ok: false, error: err.message });
  }

  res.status(500).json({ ok: false, error: "Error interno del servidor" });
});

// ===== INICIO =====
app.listen(PORT, () => {
  console.log("Servidor listo en puerto " + PORT);
});
