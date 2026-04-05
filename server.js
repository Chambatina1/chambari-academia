const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

app.use("/public", express.static(path.join(__dirname, "public")));

// =========================
// DISCO RENDER OBLIGATORIO
// =========================
const DISK_MOUNT_PATH = process.env.RENDER_DISK_PATH;

if (!DISK_MOUNT_PATH) {
  console.error("❌ Falta la variable RENDER_DISK_PATH");
  process.exit(1);
}

const DISK_FILES_DIR = path.join(DISK_MOUNT_PATH, "files");

try {
  fs.mkdirSync(DISK_FILES_DIR, { recursive: true });

  const testFile = path.join(DISK_FILES_DIR, ".write-test");
  fs.writeFileSync(testFile, "ok");
  fs.unlinkSync(testFile);

  console.log("✅ Disco listo para escritura en:", DISK_FILES_DIR);
} catch (err) {
  console.error("❌ No se puede escribir en el disco:", DISK_FILES_DIR);
  console.error(err.message);
  process.exit(1);
}

app.use("/files", express.static(DISK_FILES_DIR));

// =========================
// DB
// =========================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

function normalizeText(value) {
  return String(value || "").trim();
}

function safeFileName(name) {
  const original = String(name || "archivo").trim();
  const ext = path.extname(original);
  const base = path
    .basename(original, ext)
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "archivo";
  return `${Date.now()}_${base}${ext}`;
}

function autoModuleTitle() {
  return `Módulo automático ${Date.now()}`;
}

function autoLessonTitle() {
  return `Clase automática ${Date.now()}`;
}

function normalizeStatus(value, fallback = "draft") {
  const raw = normalizeText(value).toLowerCase();
  if (!raw) return fallback;
  if (raw === "publicado") return "published";
  if (raw === "archivado") return "archived";
  if (raw === "borrador") return "draft";
  return raw;
}

function legacyStatus(value) {
  if (value === "published") return "publicado";
  if (value === "archived") return "archivado";
  if (value === "draft") return "borrador";
  return value || "borrador";
}

function normalizeModuleRow(row) {
  return {
    ...row,
    titulo: row.titulo ?? row.title ?? "",
    descripcion: row.descripcion ?? row.description ?? "",
    estado: legacyStatus(row.estado ?? row.status ?? "draft")
  };
}

function normalizeLessonRow(row) {
  return {
    ...row,
    titulo: row.titulo ?? row.title ?? "",
    descripcion: row.descripcion ?? row.description ?? "",
    contenido: row.contenido ?? row.text_content ?? "",
    estado: legacyStatus(row.estado ?? row.status ?? "draft"),
    module_titulo: row.module_titulo ?? row.module_title ?? "",
    link_1: row.link_1 ?? "",
    link_2: row.link_2 ?? "",
    link_3: row.link_3 ?? "",
    link_4: row.link_4 ?? "",
    link_5: row.link_5 ?? "",
    song_title: row.song_title ?? "",
    song_artist: row.song_artist ?? "",
    song_url: row.song_url ?? "",
    song_lyrics: row.song_lyrics ?? "",
    song_notes: row.song_notes ?? ""
  };
}

async function ensureSchema() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS modules (
        id SERIAL PRIMARY KEY,
        titulo TEXT,
        title TEXT,
        descripcion TEXT DEFAULT '',
        description TEXT DEFAULT '',
        estado TEXT DEFAULT 'published',
        status TEXT DEFAULT 'published',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`ALTER TABLE modules ADD COLUMN IF NOT EXISTS titulo TEXT`);
    await client.query(`ALTER TABLE modules ADD COLUMN IF NOT EXISTS title TEXT`);
    await client.query(`ALTER TABLE modules ADD COLUMN IF NOT EXISTS descripcion TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE modules ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE modules ADD COLUMN IF NOT EXISTS estado TEXT DEFAULT 'published'`);
    await client.query(`ALTER TABLE modules ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'published'`);
    await client.query(`ALTER TABLE modules ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
    await client.query(`ALTER TABLE modules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS lessons (
        id SERIAL PRIMARY KEY,
        module_id INTEGER REFERENCES modules(id) ON DELETE CASCADE,
        titulo TEXT,
        title TEXT,
        descripcion TEXT DEFAULT '',
        description TEXT DEFAULT '',
        contenido TEXT DEFAULT '',
        text_content TEXT DEFAULT '',
        video_url TEXT DEFAULT '',
        youtube_url TEXT DEFAULT '',
        tiktok_url TEXT DEFAULT '',
        audio_url TEXT DEFAULT '',
        file_url TEXT DEFAULT '',
        file_name TEXT DEFAULT '',
        link TEXT DEFAULT '',
        link_1 TEXT DEFAULT '',
        link_2 TEXT DEFAULT '',
        link_3 TEXT DEFAULT '',
        link_4 TEXT DEFAULT '',
        link_5 TEXT DEFAULT '',
        song_title TEXT DEFAULT '',
        song_artist TEXT DEFAULT '',
        song_url TEXT DEFAULT '',
        song_lyrics TEXT DEFAULT '',
        song_notes TEXT DEFAULT '',
        estado TEXT DEFAULT 'draft',
        status TEXT DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS module_id INTEGER REFERENCES modules(id) ON DELETE CASCADE`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS titulo TEXT`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS title TEXT`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS descripcion TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS contenido TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS text_content TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS video_url TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS youtube_url TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS tiktok_url TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS audio_url TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS file_url TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS file_name TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS link TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS link_1 TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS link_2 TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS link_3 TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS link_4 TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS link_5 TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS song_title TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS song_artist TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS song_url TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS song_lyrics TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS song_notes TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS estado TEXT DEFAULT 'draft'`);
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

    await client.query(`
      UPDATE modules
      SET
        titulo = COALESCE(NULLIF(TRIM(titulo), ''), NULLIF(TRIM(title), ''), 'Módulo recuperado ' || id),
        title = COALESCE(NULLIF(TRIM(title), ''), NULLIF(TRIM(titulo), ''), 'Módulo recuperado ' || id),
        descripcion = COALESCE(descripcion, description, ''),
        description = COALESCE(description, descripcion, ''),
        estado = COALESCE(NULLIF(TRIM(estado), ''), NULLIF(TRIM(status), ''), 'published'),
        status = COALESCE(NULLIF(TRIM(status), ''), NULLIF(TRIM(estado), ''), 'published'),
        updated_at = NOW()
    `);

    await client.query(`
      UPDATE lessons
      SET
        titulo = COALESCE(NULLIF(TRIM(titulo), ''), NULLIF(TRIM(title), ''), 'Clase recuperada ' || id),
        title = COALESCE(NULLIF(TRIM(title), ''), NULLIF(TRIM(titulo), ''), 'Clase recuperada ' || id),
        descripcion = COALESCE(descripcion, description, ''),
        description = COALESCE(description, descripcion, ''),
        contenido = COALESCE(contenido, text_content, ''),
        text_content = COALESCE(text_content, contenido, ''),
        estado = COALESCE(NULLIF(TRIM(estado), ''), NULLIF(TRIM(status), ''), 'draft'),
        status = COALESCE(NULLIF(TRIM(status), ''), NULLIF(TRIM(estado), ''), 'draft'),
        updated_at = NOW()
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
// MULTER
// =========================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, DISK_FILES_DIR);
  },
  filename: (req, file, cb) => {
    cb(null, safeFileName(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 }
});

// =========================
// RUTAS BASE
// =========================
app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Servidor Chambari Academy activo",
    disk_mount_path: DISK_MOUNT_PATH,
    disk_files_dir: DISK_FILES_DIR
  });
});

app.get("/api/test", (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    disk_mount_path: DISK_MOUNT_PATH,
    disk_files_dir: DISK_FILES_DIR
  });
});

app.get("/api/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS now");
    res.json({ ok: true, db_time: result.rows[0].now });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// =========================
// DASHBOARD
// =========================
app.get("/api/dashboard", async (req, res) => {
  try {
    const [modulesResult, lessonsResult, studentsCount] = await Promise.all([
      pool.query(`
        SELECT id, titulo, title, descripcion, description, estado, status, created_at, updated_at
        FROM modules
        ORDER BY id DESC
      `),
      pool.query(`
        SELECT l.*, COALESCE(m.titulo, m.title, '') AS module_titulo, COALESCE(m.title, m.titulo, '') AS module_title
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
    res.status(500).json({ ok: false, error: error.message });
  }
});

// =========================
