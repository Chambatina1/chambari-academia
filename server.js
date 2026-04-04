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

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// =============================
// MIDDLEWARE
// =============================
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));
app.use("/files", express.static(uploadDir));

// =============================
// DB
// =============================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// =============================
// TIPOS DE ARCHIVO
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
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (allowedExtensions.includes(ext)) return cb(null, true);
    cb(new Error("Tipo de archivo no permitido"));
  }
});

// =============================
// INIT DB
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
// HELPERS
// =============================
function getFilePathFromUrl(fileUrl) {
  try {
    if (!fileUrl) return null;
    const prefix = `${BASE_URL}/files/`;
    if (!fileUrl.startsWith(prefix)) return null;
    const filename = fileUrl.replace(prefix, "");
    return path.join(uploadDir, filename);
  } catch {
    return null;
  }
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
          ""
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
// VER CLASES DE MÓDULO
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
// DASHBOARD PROFESOR
// =============================
app.get("/api/dashboard", async (req, res) => {
  try {
    const modulesResult = await pool.query(`
      SELECT
        m.id,
        m.titulo,
        m.descripcion,
        m.publicado,
        m.created_at,
        COUNT(l.id)::int AS total_clases
      FROM modules m
      LEFT JOIN lessons l ON l.module_id = m.id AND l.publicado = true
      WHERE m.publicado = true
      GROUP BY m.id
      ORDER BY m.id ASC
    `);

    const lessonsResult = await pool.query(`
      SELECT *
      FROM lessons
      WHERE publicado = true
      ORDER BY id DESC
    `);

    const studentsResult = await pool.query(`
      SELECT id, nombre, email, created_at
      FROM students
      ORDER BY id DESC
    `);

    res.json({
      ok: true,
      resumen: {
        total_modulos: modulesResult.rows.length,
        total_clases: lessonsResult.rows.length,
        total_estudiantes: studentsResult.rows.length
      },
      modules: modulesResult.rows,
      lessons: lessonsResult.rows,
      students: studentsResult.rows
    });
  } catch (err) {
    console.error("DASHBOARD ERROR:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =============================
// ELIMINAR CLASE
// =============================
app.delete("/api/lesson/:id", async (req, res) => {
  try {
    const lessonId = Number(req.params.id);

    const existing = await pool.query(
      "SELECT * FROM lessons WHERE id = $1",
      [lessonId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Clase no encontrada" });
    }

    const lesson = existing.rows[0];
    const filePath = getFilePathFromUrl(lesson.file_url);

    await pool.query("DELETE FROM lessons WHERE id = $1", [lessonId]);

    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.error("No se pudo borrar archivo físico:", e.message);
      }
    }

    res.json({ ok: true, message: "Clase eliminada correctamente" });
  } catch (err) {
    console.error("DELETE LESSON ERROR:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =============================
// ELIMINAR MÓDULO
// =============================
app.delete("/api/module/:id", async (req, res) => {
  try {
    const moduleId = Number(req.params.id);

    const moduleResult = await pool.query(
      "SELECT * FROM modules WHERE id = $1",
      [moduleId]
    );

    if (moduleResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Módulo no encontrado" });
    }

    const lessonsResult = await pool.query(
      "SELECT * FROM lessons WHERE module_id = $1",
      [moduleId]
    );

    for (const lesson of lessonsResult.rows) {
      const filePath = getFilePathFromUrl(lesson.file_url);
      if (filePath && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          console.error("No se pudo borrar archivo físico:", e.message);
        }
      }
    }

    await pool.query("DELETE FROM modules WHERE id = $1", [moduleId]);

    res.json({ ok: true, message: "Módulo eliminado correctamente" });
  } catch (err) {
    console.error("DELETE MODULE ERROR:", err);
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
// START
// =============================
app.listen(PORT, () => {
  console.log("Servidor listo en puerto " + PORT);
});
