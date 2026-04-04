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
  if (raw === "true") return "published";
  if (raw === "false") return "draft";

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

function autoModuleTitle(id = "") {
  return `Módulo recuperado ${id || Date.now()}`;
}

function autoLessonTitle(id = "") {
  return `Clase recuperada ${id || Date.now()}`;
}

function normalizeModuleRow(row) {
  return {
    ...row,
    titulo: row.title,
    descripcion: row.description || "",
    estado: toLegacyStatus(row.status)
  };
}

function normalizeLessonRow(row) {
  const normalizedStatus =
    row.status ||
    (row.publicado === true ? "published" : "draft");

  return {
    ...row,
    titulo: row.title,
    descripcion: row.description || "",
    contenido: row.text_content || "",
    estado: toLegacyStatus(normalizedStatus),
    module_titulo: row.module_title || row.module_titulo || null
  };
}

// =========================
// ESQUEMA Y REPARACIÓN
// =========================
async function ensureSchema() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // =========================
    // MODULES
    // =========================
    await client.query(`
      CREATE TABLE IF NOT EXISTS modules (
        id SERIAL PRIMARY KEY,
        title TEXT,
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

    // Compatibilidad con tablas/columnas viejas
    await client.query(`ALTER TABLE modules ADD COLUMN IF NOT EXISTS titulo TEXT`);
    await client.query(`ALTER TABLE modules ADD COLUMN IF NOT EXISTS descripcion TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE modules ADD COLUMN IF NOT EXISTS estado TEXT DEFAULT 'published'`);

    // =========================
    // LESSONS
    // =========================
    await client.query(`
      CREATE TABLE IF NOT EXISTS lessons (
        id SERIAL PRIMARY KEY,
        module_id INTEGER REFERENCES modules(id) ON DELETE CASCADE,
        title TEXT,
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

    // Compatibilidad con campos viejos
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS titulo TEXT`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS descripcion TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS contenido TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS estado TEXT DEFAULT 'draft'`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS pdf_url TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS publicado BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS file_type TEXT DEFAULT ''`);

    // =========================
    // STUDENTS
    // =========================
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

    // =========================
    // PROGRESS
    // =========================
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

    // =========================
    // MIGRACIÓN DE DATOS VIEJOS
    // =========================

    // modules: copiar datos viejos a los nuevos
    await client.query(`
      UPDATE modules
      SET title = COALESCE(NULLIF(TRIM(title), ''), NULLIF(TRIM(titulo), ''))
      WHERE title IS NULL OR TRIM(title) = ''
    `);

    await client.query(`
      UPDATE modules
      SET description = COALESCE(NULLIF(description, ''), COALESCE(descripcion, ''))
      WHERE description IS NULL OR description = ''
    `);

    await client.query(`
      UPDATE modules
      SET status = COALESCE(NULLIF(status, ''), CASE
        WHEN LOWER(COALESCE(estado, '')) = 'publicado' THEN 'published'
        WHEN LOWER(COALESCE(estado, '')) = 'archivado' THEN 'archived'
        WHEN LOWER(COALESCE(estado, '')) = 'borrador' THEN 'draft'
        ELSE 'published'
      END)
      WHERE status IS NULL OR status = ''
    `);

    await client.query(`
      UPDATE modules
      SET title = 'Módulo recuperado ' || id
      WHERE title IS NULL OR TRIM(title) = ''
    `);

    // lessons: copiar datos viejos a los nuevos
    await client.query(`
      UPDATE lessons
      SET title = COALESCE(NULLIF(TRIM(title), ''), NULLIF(TRIM(titulo), ''))
      WHERE title IS NULL OR TRIM(title) = ''
    `);

    await client.query(`
      UPDATE lessons
      SET description = COALESCE(NULLIF(description, ''), COALESCE(descripcion, ''))
      WHERE description IS NULL OR description = ''
    `);

    await client.query(`
      UPDATE lessons
      SET text_content = COALESCE(NULLIF(text_content, ''), COALESCE(contenido, ''))
      WHERE text_content IS NULL OR text_content = ''
    `);

    await client.query(`
      UPDATE lessons
      SET file_url = COALESCE(NULLIF(file_url, ''), COALESCE(pdf_url, ''))
      WHERE file_url IS NULL OR file_url = ''
    `);

    await client.query(`
      UPDATE lessons
      SET status = COALESCE(NULLIF(status, ''), CASE
        WHEN publicado = TRUE THEN 'published'
        WHEN LOWER(COALESCE(estado, '')) = 'publicado' THEN 'published'
        WHEN LOWER(COALESCE(estado, '')) = 'archivado' THEN 'archived'
        WHEN LOWER(COALESCE(estado, '')) = 'borrador' THEN 'draft'
        ELSE 'draft'
      END)
      WHERE status IS NULL OR status = ''
    `);

    await client.query(`
      UPDATE lessons
      SET title = 'Clase recuperada ' || id
      WHERE title IS NULL OR TRIM(title) = ''
    `);

    // Intentar reforzar NOT NULL si ya los datos están sanos
    await client.query(`
      DO $$
      BEGIN
        BEGIN
          ALTER TABLE modules ALTER COLUMN title SET NOT NULL;
        EXCEPTION WHEN others THEN
          NULL;
        END;

        BEGIN
          ALTER TABLE lessons ALTER COLUMN title SET NOT NULL;
        EXCEPTION WHEN others THEN
          NULL;
        END;
      END $$;
    `);

    await client.query("COMMIT");
    console.log("✅ Esquema verificado y datos reparados");
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
        SELECT
          l.*,
          m.title AS module_title
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
    const finalTitle = rawTitle || autoModuleTitle(id);
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
    res.status(500).
