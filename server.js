const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();

// =============================
// CONFIG GENERAL
// =============================
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || "https://chambari-academia.onrender.com";

// =============================
// DISCO PERSISTENTE EN RENDER
// =============================
const uploadDir = "/var/data/files";

// crear carpeta si no existe
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// =============================
// MIDDLEWARE
// =============================
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// archivos estáticos normales
app.use(express.static(path.join(__dirname, "public")));

// servir archivos persistentes
app.use("/files", express.static(uploadDir));

// =============================
// CONEXIÓN DB
// =============================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// =============================
// TIPOS DE ARCHIVO PERMITIDOS
// =============================
const allowedExtensions = [
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".txt",
  ".csv"
];

// =============================
// MULTER
// =============================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 }, // 30MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();

    if (allowedExtensions.includes(ext)) {
      return cb(null, true);
    }

    cb(new Error("Tipo de archivo no permitido"));
  }
});

// =============================
// INICIALIZAR BASE
// =============================
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
      file_url TEXT DEFAULT '',
      file_name TEXT DEFAULT '',
      file_type TEXT DEFAULT '',
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

  // compatibilidad si venías de pdf_url
  await pool.query(`
    ALTER TABLE lessons
    ADD COLUMN IF NOT EXISTS file_url TEXT DEFAULT '';
  `);

  await pool.query(`
    ALTER TABLE lessons
    ADD COLUMN IF NOT EXISTS file_name TEXT DEFAULT '';
  `);

  await pool.query(`
    ALTER TABLE lessons
    ADD COLUMN IF NOT EXISTS file_type TEXT DEFAULT '';
  `);

  await pool.query(`
    ALTER TABLE lessons
    ADD COLUMN IF NOT EXISTS pdf_url TEXT;
  `);

  await pool.query(`
    UPDATE lessons
    SET file_url = COALESCE(NULLIF(file_url, ''), pdf_url),
        file_type = CASE
          WHEN COALESCE(file_type, '') = '' AND COALESCE(pdf_url, '') <> '' THEN 'pdf'
          ELSE file_type
        END
    WHERE COALESCE(pdf_url, '') <> '';
  `);
}

// =============================
// RUTAS BASE
// =============================
app.get("/", (req, res) => {
  res.send("Chambari Academy backend funcionando");
});

app.get("/api", (req, res) => {
  res.json({ ok: true, message: "Chambari Academy API funcionando" });
});

app.get("/api/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ ok: true, time: result.rows[0] });
  } catch (err) {
    console.error("DB ERROR:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =============================
// INIT DB
// =============================
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
        `INSERT INTO lessons (module_id, titulo, youtube_url, file_url, file_name, file_type, publicado)
         VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [
          moduleId,
          "Primera clase",
          "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          "",
          "",
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

// =============================
// SUBIR ARCHIVO
// =============================
app.post("/api/upload-file", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No se recibió ningún archivo" });
    }

    const ext = path.extname(req.file.originalname || "").toLowerCase().replace(".", "");
    const url = `${BASE_URL}/files/${req.file.filename}`;

    res.json({
      ok: true,
      url,
      filename: req.file.filename,
      originalname: req.file.originalname,
      filetype: ext
    });
  } catch (err) {
    console.error("UPLOAD FILE ERROR:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =============================
// REGISTRO
// =============================
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

// =============================
// CREAR MÓDULO
// =============================
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

// =============================
// CREAR CLASE
// =============================
app.post("/api/lesson", async (req, res) => {
  try {
    const { module_id, titulo, youtube_url, file_url, file_name, file_type } = req.body;

    if (!module_id || !titulo || !String(titulo).trim()) {
      return res.status(400).json({ ok: false, error: "Datos incompletos" });
    }

    const result = await pool.query(
      `INSERT INTO lessons (module_id, titulo, youtube_url, file_url, file_name, file_type, publicado)
       VALUES ($1,$2,$3,$4,$5,$6,true)
       RETURNING *`,
      [
        Number(module_id),
        String(titulo).trim(),
        (youtube_url || "").trim(),
        (file_url || "").trim(),
        (file_name || "").trim(),
        (file_type || "").trim()
      ]
    );

    res.json({ ok: true, lesson: result.rows[0] });
  } catch (err) {
    console.error("LESSON ERROR:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =============================
// VER MÓDULOS
// =============================
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

// =============================
// VER CLASES
// =============================
app.get("/api/lessons/:moduleId", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM lessons
       WHERE module_id = $1 AND publicado = true
       ORDER BY id ASC`,
      [req.params.moduleId]
    );

    res.json({ ok: true, lessons: result.rows });
  } catch (err) {
    console.error("GET LESSONS ERROR:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =============================
// ERROR GENERAL
// =============================
app.use((err, req, res, next) => {
  console.error("ERROR GENERAL:", err);

  if (err instanceof multer.MulterError) {
    return res.status(400).json({ ok: false, error: err.message });
  }

  if (err.message === "Tipo de archivo no permitido") {
    return res.status(400).json({ ok: false, error: err.message });
  }

  res.status(500).json({ ok: false, error: "Error interno del servidor" });
});

// =============================
// INICIO
// =============================
app.listen(PORT, () => {
  console.log("Servidor listo en puerto " + PORT);
});
