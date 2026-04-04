const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

// =========================
// CONFIG GENERAL
// =========================
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

app.use("/public", express.static(path.join(__dirname, "public")));
app.use("/files", express.static(path.join(__dirname, "public", "files")));

// =========================
// DB
// =========================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// =========================
// UTILIDADES
// =========================
function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeStatus(value, fallback = "draft") {
  const raw = normalizeText(value).toLowerCase();
  if (!raw) return fallback;

  if (raw === "publicado") return "published";
  if (raw === "archivado") return "archived";
  if (raw === "borrador") return "draft";

  return raw;
}

function toLegacyStatus(value) {
  if (value === "published") return "publicado";
  if (value === "archived") return "archivado";
  if (value === "draft") return "borrador";
  return value || "borrador";
}

function safeFileName(name) {
  const original = String(name || "archivo").trim();
  const ext = path.extname(original);
  const base = path.basename(original, ext)
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "archivo";
  return `${Date.now()}_${base}${ext}`;
}

function autoModuleTitle() {
  return `Módulo rápido ${new Date().toISOString().slice(0, 19).replace("T", " ")}`;
}

function autoLessonTitle() {
  return `Clase rápida ${new Date().toISOString().slice(0, 19).replace("T", " ")}`;
}

function normalizeModuleRow(row) {
  return {
    ...row,
    titulo: row.title,
    descripcion: row.description,
    estado: toLegacyStatus(row.status)
  };
}

function normalizeLessonRow(row) {
  return {
    ...row,
    titulo: row.title,
    descripcion: row.description,
    contenido: row.text_content,
    estado: toLegacyStatus(row.status),
    module_titulo: row.module_title || row.module_titulo || null
  };
}

async function ensureSchema() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS modules (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        status TEXT DEFAULT 'published',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`ALTER TABLE modules ADD COLUMN IF NOT EXISTS title TEXT`);
    await client.query(`ALTER TABLE modules ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE modules ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'published'`);
    await client.query(`ALTER TABLE modules ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
    await client.query(`ALTER TABLE modules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS lessons (
        id SERIAL PRIMARY KEY,
        module_id INTEGER REFERENCES modules(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        video_url TEXT DEFAULT '',
        youtube_url TEXT DEFAULT '',
        tiktok_url TEXT DEFAULT '',
        audio_url TEXT DEFAULT '',
        text_content TEXT DEFAULT '',
        file_url TEXT DEFAULT '',
        file_name TEXT DEFAULT '',
        link TEXT DEFAULT '',
        status TEXT DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS module_id INTEGER REFERENCES modules(id) ON DELETE CASCADE`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS title TEXT`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS video_url TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS youtube_url TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS tiktok_url TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS audio_url TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS text_content TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS file_url TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS file_name TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS link TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft'`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS nombre TEXT`);
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS email TEXT`);
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS password TEXT`);
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS progress (
        id SERIAL PRIMARY KEY,
        student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
        completed BOOLEAN DEFAULT FALSE,
        progress_percent INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`ALTER TABLE progress ADD COLUMN IF NOT EXISTS student_id INTEGER REFERENCES students(id) ON DELETE CASCADE`);
    await client.query(`ALTER TABLE progress ADD COLUMN IF NOT EXISTS lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE`);
    await client.query(`ALTER TABLE progress ADD COLUMN IF NOT EXISTS completed BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE progress ADD COLUMN IF NOT EXISTS progress_percent INTEGER DEFAULT 0`);
    await client.query(`ALTER TABLE progress ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
    await client.query(`ALTER TABLE progress ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS progress_student_lesson_unique
      ON progress(student_id, lesson_id)
    `);

    await client.query("COMMIT");
    console.log("✅ Esquema verificado correctamente");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error asegurando esquema:", error.message);
    throw error;
  } finally {
    client.release();
  }
}

// =========================
// ARCHIVOS
// =========================
const filesDir = path.join(__dirname, "public", "files");
fs.mkdirSync(filesDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, filesDir),
  filename: (req, file, cb) => cb(null, safeFileName(file.originalname))
});

const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 }
});

// =========================
// RUTAS BASE
// =========================
app.get("/", (req, res) => {
  res.json({ ok: true, message: "Servidor Chambari Academy activo" });
});

app.get("/api/test", (req, res) => {
  res.json({
    ok: true,
    server: "Chambari Academy",
    time: new Date().toISOString()
  });
});

app.get("/api/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS now");
    res.json({ ok: true, db_time: result.rows[0].now });
  } catch (error) {
    console.error("DB TEST ERROR:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// =========================
// DASHBOARD PROFESOR
// =========================
app.get("/api/dashboard", async (req, res) => {
  try {
    const [modulesResult, lessonsResult, studentsCount] = await Promise.all([
      pool.query(`
        SELECT id, title, description, status, created_at, updated_at
        FROM modules
        ORDER BY id DESC
      `),
      pool.query(`
        SELECT l.*, m.title AS module_title
        FROM lessons l
        LEFT JOIN modules m ON m.id = l.module_id
        ORDER BY l.id DESC
      `),
      pool.query("SELECT COUNT(*)::int AS total FROM students")
    ]);

    const modules = modulesResult.rows.map((module) => ({
      ...normalizeModuleRow(module),
      lessons: lessonsResult.rows
        .filter((lesson) => lesson.module_id === module.id)
        .map(normalizeLessonRow)
    }));

    res.json({
      ok: true,
      summary: {
        modules: modules.length,
        lessons: lessonsResult.rows.length,
        students: studentsCount.rows[0].total
      },
      modules,
      students: studentsCount.rows[0].total
    });
  } catch (error) {
    console.error("DASHBOARD ERROR:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// =========================
// MODULES
// =========================
app.get("/api/modules", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, title, description, status, created_at, updated_at
      FROM modules
      ORDER BY id DESC
    `);

    res.json({
      ok: true,
      modules: result.rows.map(normalizeModuleRow)
    });
  } catch (error) {
    console.error("GET MODULES ERROR:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/modules", async (req, res) => {
  try {
    const rawTitle = normalizeText(req.body.title || req.body.titulo);
    const finalTitle = rawTitle || autoModuleTitle();
    const description = normalizeText(req.body.description || req.body.descripcion);
    const status = normalizeStatus(req.body.status || req.body.estado || "published", "published");

    const result = await pool.query(`
      INSERT INTO modules (title, description, status, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      RETURNING *
    `, [finalTitle, description, status]);

    res.json({
      ok: true,
      module: normalizeModuleRow(result.rows[0]),
      message: "Módulo creado correctamente"
    });
  } catch (error) {
    console.error("CREATE MODULE ERROR:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.put("/api/modules/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rawTitle = normalizeText(req.body.title || req.body.titulo);
    const finalTitle = rawTitle || autoModuleTitle();
    const description = normalizeText(req.body.description || req.body.descripcion);
    const status = normalizeStatus(req.body.status || req.body.estado || "published", "published");

    if (!id) {
      return res.status(400).json({ ok: false, error: "ID inválido" });
    }

    const result = await pool.query(`
      UPDATE modules
      SET title = $1,
          description = $2,
          status = $3,
          updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `, [finalTitle, description, status, id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "Módulo no encontrado" });
    }

    res.json({
      ok: true,
      module: normalizeModuleRow(result.rows[0]),
      message: "Módulo actualizado correctamente"
    });
  } catch (error) {
    console.error("UPDATE MODULE ERROR:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.delete("/api/modules/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!id) {
      return res.status(400).json({ ok: false, error: "ID inválido" });
    }

    const result = await pool.query(`
      DELETE FROM modules
      WHERE id = $1
      RETURNING id
    `, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "Módulo no encontrado" });
    }

    res.json({ ok: true, message: "Módulo eliminado correctamente" });
  } catch (error) {
    console.error("DELETE MODULE ERROR:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// =========================
// LESSONS
// =========================
app.get("/api/lessons/:moduleId", async (req, res) => {
  try {
    const moduleId = Number(req.params.moduleId);

    if (!moduleId) {
      return res.status(400).json({ ok: false, error: "moduleId inválido" });
    }

    const result = await pool.query(`
      SELECT l.*, m.title AS module_title
      FROM lessons l
      LEFT JOIN modules m ON m.id = l.module_id
      WHERE l.module_id = $1
      ORDER BY l.id ASC
    `, [moduleId]);

    res.json({
      ok: true,
      lessons: result.rows.map(normalizeLessonRow)
    });
  } catch (error) {
    console.error("GET LESSONS ERROR:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/lesson/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!id) {
      return res.status(400).json({ ok: false, error: "ID inválido" });
    }

    const result = await pool.query(`
      SELECT l.*, m.title AS module_title
      FROM lessons l
      LEFT JOIN modules m ON m.id = l.module_id
      WHERE l.id = $1
      LIMIT 1
    `, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "Clase no encontrada" });
    }

    res.json({
      ok: true,
      lesson: normalizeLessonRow(result.rows[0])
    });
  } catch (error) {
    console.error("GET LESSON ERROR:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/lessons", async (req, res) => {
  try {
    const moduleId = Number(req.body.module_id || req.body.moduleId);
    const rawTitle = normalizeText(req.body.title || req.body.titulo);
    const finalTitle = rawTitle || autoLessonTitle();
    const description = normalizeText(req.body.description || req.body.descripcion);
    const videoUrl = normalizeText(req.body.video_url || req.body.videoUrl);
    const youtubeUrl = normalizeText(req.body.youtube_url || req.body.youtubeUrl || req.body.link);
    const tiktokUrl = normalizeText(req.body.tiktok_url || req.body.tiktokUrl);
    const audioUrl = normalizeText(req.body.audio_url || req.body.audioUrl);
    const textContent = normalizeText(req.body.text_content || req.body.textContent || req.body.contenido);
    const fileUrl = normalizeText(req.body.file_url || req.body.fileUrl);
    const fileName = normalizeText(req.body.file_name || req.body.fileName);
    const status = normalizeStatus(req.body.status || req.body.estado || "draft", "draft");

    if (!moduleId) {
      return res.status(400).json({ ok: false, error: "Debes seleccionar un módulo" });
    }

    const moduleExists = await pool.query(
      "SELECT id FROM modules WHERE id = $1 LIMIT 1",
      [moduleId]
    );

    if (moduleExists.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "El módulo seleccionado no existe" });
    }

    const result = await pool.query(`
      INSERT INTO lessons (
        module_id,
        title,
        description,
        video_url,
        youtube_url,
        tiktok_url,
        audio_url,
        text_content,
        file_url,
        file_name,
        link,
        status,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())
      RETURNING *
    `, [
      moduleId,
      finalTitle,
      description,
      videoUrl,
      youtubeUrl,
      tiktokUrl,
      audioUrl,
      textContent,
      fileUrl,
      fileName,
      youtubeUrl,
      status
    ]);

    res.json({
      ok: true,
      lesson: normalizeLessonRow(result.rows[0]),
      message: "Clase creada correctamente"
    });
  } catch (error) {
    console.error("CREATE LESSON ERROR:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.put("/api/lessons/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const moduleId = Number(req.body.module_id || req.body.moduleId);
    const rawTitle = normalizeText(req.body.title || req.body.titulo);
    const finalTitle = rawTitle || autoLessonTitle();
    const description = normalizeText(req.body.description || req.body.descripcion);
    const videoUrl = normalizeText(req.body.video_url || req.body.videoUrl);
    const youtubeUrl = normalizeText(req.body.youtube_url || req.body.youtubeUrl || req.body.link);
    const tiktokUrl = normalizeText(req.body.tiktok_url || req.body.tiktokUrl);
    const audioUrl = normalizeText(req.body.audio_url || req.body.audioUrl);
    const textContent = normalizeText(req.body.text_content || req.body.textContent || req.body.contenido);
    const fileUrl = normalizeText(req.body.file_url || req.body.fileUrl);
    const fileName = normalizeText(req.body.file_name || req.body.fileName);
    const status = normalizeStatus(req.body.status || req.body.estado || "draft", "draft");

    if (!id) {
      return res.status(400).json({ ok: false, error: "ID inválido" });
    }

    if (!moduleId) {
      return res.status(400).json({ ok: false, error: "Debes seleccionar un módulo" });
    }

    const result = await pool.query(`
      UPDATE lessons
      SET module_id = $1,
          title = $2,
          description = $3,
          video_url = $4,
          youtube_url = $5,
          tiktok_url = $6,
          audio_url = $7,
          text_content = $8,
          file_url = $9,
          file_name = $10,
          link = $11,
          status = $12,
          updated_at = NOW()
      WHERE id = $13
      RETURNING *
    `, [
      moduleId,
      finalTitle,
      description,
      videoUrl,
      youtubeUrl,
      tiktokUrl,
      audioUrl,
      textContent,
      fileUrl,
      fileName,
      youtubeUrl,
      status,
      id
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "Clase no encontrada" });
    }

    res.json({
      ok: true,
      lesson: normalizeLessonRow(result.rows[0]),
      message: "Clase actualizada correctamente"
    });
  } catch (error) {
    console.error("UPDATE LESSON ERROR:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.put("/api/lessons/:id/publish", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!id) {
      return res.status(400).json({ ok: false, error: "ID inválido" });
    }

    const result = await pool.query(`
      UPDATE lessons
      SET status = 'published',
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "Clase no encontrada" });
    }

    res.json({
      ok: true,
      lesson: normalizeLessonRow(result.rows[0]),
      message: "Clase publicada correctamente"
    });
  } catch (error) {
    console.error("PUBLISH LESSON ERROR:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.put("/api/lessons/:id/archive", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!id) {
      return res.status(400).json({ ok: false, error: "ID inválido" });
    }

    const result = await pool.query(`
      UPDATE lessons
      SET status = 'archived',
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "Clase no encontrada" });
    }

    res.json({
      ok: true,
      lesson: normalizeLessonRow(result.rows[0]),
      message: "Clase archivada correctamente"
    });
  } catch (error) {
    console.error("ARCHIVE LESSON ERROR:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.delete("/api/lessons/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!id) {
      return res.status(400).json({ ok: false, error: "ID inválido" });
    }

    const result = await pool.query(`
      DELETE FROM lessons
      WHERE id = $1
      RETURNING id
    `, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "Clase no encontrada" });
    }

    res.json({ ok: true, message: "Clase eliminada correctamente" });
  } catch (error) {
    console.error("DELETE LESSON ERROR:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// =========================
// STUDENTS
// =========================
app.get("/api/students", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        s.id,
        s.nombre,
        s.email,
        s.created_at,
        COALESCE(AVG(p.progress_percent), 0)::int AS progreso_promedio
      FROM students s
      LEFT JOIN progress p ON p.student_id = s.id
      GROUP BY s.id
      ORDER BY s.id DESC
    `);

    res.json({ ok: true, students: result.rows });
  } catch (error) {
    console.error("GET STUDENTS ERROR:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/register", async (req, res) => {
  try {
    const nombre = normalizeText(req.body.nombre || req.body.name);
    const email = normalizeText(req.body.email).toLowerCase();
    const password = normalizeText(req.body.password);

    if (!nombre || !email || !password) {
      return res.status(400).json({ ok: false, error: "Faltan datos" });
    }

    const existing = await pool.query(
      "SELECT id FROM students WHERE email = $1 LIMIT 1",
      [email]
    );

    if (existing.rowCount > 0) {
      return res.status(400).json({ ok: false, error: "Ese correo ya está registrado" });
    }

    const result = await pool.query(`
      INSERT INTO students (nombre, email, password, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      RETURNING id, nombre, email, created_at
    `, [nombre, email, password]);

    res.json({
      ok: true,
      student: result.rows[0],
      message: "Estudiante registrado correctamente"
    });
  } catch (error) {
    console.error("REGISTER ERROR:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const email = normalizeText(req.body.email).toLowerCase();
    const password = normalizeText(req.body.password);

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "Faltan credenciales" });
    }

    const result = await pool.query(`
      SELECT id, nombre, email, created_at
      FROM students
      WHERE email = $1 AND password = $2
      LIMIT 1
    `, [email, password]);

    if (result.rowCount === 0) {
      return res.status(401).json({ ok: false, error: "Correo o contraseña incorrectos" });
    }

    res.json({
      ok: true,
      student: result.rows[0],
      message: "Login correcto"
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// =========================
// PROGRESS
// =========================
app.post("/api/progress", async (req, res) => {
  try {
    const studentId = Number(req.body.student_id || req.body.studentId);
    const lessonId = Number(req.body.lesson_id || req.body.lessonId);
    const completed = Boolean(req.body.completed);
    const progressPercent = Math.max(
      0,
      Math.min(100, Number(req.body.progress_percent || req.body.progressPercent || 0))
    );

    if (!studentId || !lessonId) {
      return res.status(400).json({ ok: false, error: "student_id y lesson_id son obligatorios" });
    }

    const result = await pool.query(`
      INSERT INTO progress (
        student_id, lesson_id, completed, progress_percent, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (student_id, lesson_id)
      DO UPDATE SET
        completed = EXCLUDED.completed,
        progress_percent = EXCLUDED.progress_percent,
        updated_at = NOW()
      RETURNING *
    `, [studentId, lessonId, completed, progressPercent]);

    res.json({
      ok: true,
      progress: result.rows[0],
      message: "Progreso guardado correctamente"
    });
  } catch (error) {
    console.error("SAVE PROGRESS ERROR:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/progress/:studentId", async (req, res) => {
  try {
    const studentId = Number(req.params.studentId);

    if (!studentId) {
      return res.status(400).json({ ok: false, error: "studentId inválido" });
    }

    const result = await pool.query(`
      SELECT
        p.*,
        l.title AS lesson_title,
        l.module_id
      FROM progress p
      LEFT JOIN lessons l ON l.id = p.lesson_id
      WHERE p.student_id = $1
      ORDER BY p.id DESC
    `, [studentId]);

    res.json({ ok: true, progress: result.rows });
  } catch (error) {
    console.error("GET PROGRESS ERROR:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// =========================
// UPLOAD FILE
// =========================
app.post("/api/upload-file", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No se recibió ningún archivo" });
    }

    const fileUrl = `/files/${req.file.filename}`;

    res.json({
      ok: true,
      file: {
        originalName: req.file.originalname,
        savedName: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
        url: fileUrl
      },
      file_url: fileUrl,
      file_name: req.file.filename,
      message: "Archivo subido correctamente"
    });
  } catch (error) {
    console.error("UPLOAD FILE ERROR:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// =========================
// SOLO CONTENIDO PUBLICADO
// =========================
app.get("/api/public/modules", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, title, description, status
      FROM modules
      WHERE status = 'published'
      ORDER BY id ASC
    `);

    res.json({
      ok: true,
      modules: result.rows.map(normalizeModuleRow)
    });
  } catch (error) {
    console.error("GET PUBLIC MODULES ERROR:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/public/lessons/:moduleId", async (req, res) => {
  try {
    const moduleId = Number(req.params.moduleId);

    if (!moduleId) {
      return res.status(400).json({ ok: false, error: "moduleId inválido" });
    }

    const result = await pool.query(`
      SELECT l.*, m.title AS module_title
      FROM lessons l
      LEFT JOIN modules m ON m.id = l.module_id
      WHERE l.module_id = $1
        AND l.status = 'published'
      ORDER BY l.id ASC
    `, [moduleId]);

    res.json({
      ok: true,
      lessons: result.rows.map(normalizeLessonRow)
    });
  } catch (error) {
    console.error("GET PUBLIC LESSONS ERROR:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// =========================
// PANEL ALUMNO
// =========================
app.get("/api/student-dashboard", async (req, res) => {
  try {
    const [modulesResult, lessonsResult] = await Promise.all([
      pool.query(`
        SELECT id, title, description, status
        FROM modules
        WHERE status = 'published'
        ORDER BY id ASC
      `),
      pool.query(`
        SELECT l.*, m.title AS module_title
        FROM lessons l
        LEFT JOIN modules m ON m.id = l.module_id
        WHERE l.status = 'published'
        ORDER BY l.id ASC
      `)
    ]);

    const modules = modulesResult.rows.map((module) => ({
      ...normalizeModuleRow(module),
      lessons: lessonsResult.rows
        .filter((lesson) => lesson.module_id === module.id)
        .map(normalizeLessonRow)
    }));

    res.json({ ok: true, modules });
  } catch (error) {
    console.error("STUDENT DASHBOARD ERROR:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// =========================
// 404
// =========================
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Ruta no encontrada" });
});

// =========================
// ERROR GLOBAL
// =========================
app.use((error, req, res, next) => {
  console.error("ERROR GLOBAL:", error);
  res.status(500).json({
    ok: false,
    error: error.message || "Error interno del servidor"
  });
});

// =========================
// START
// =========================
async function startServer() {
  try {
    await ensureSchema();

    app.listen(PORT, () => {
      console.log(`✅ Servidor corriendo en puerto ${PORT}`);
    });
  } catch (error) {
    console.error("❌ No se pudo iniciar el servidor:", error.message);
    process.exit(1);
  }
}

startServer();
