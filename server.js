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

// Ruta directa pública
app.use("/files", express.static(DISK_FILES_DIR, {
  fallthrough: false,
  etag: true,
  maxAge: "1d",
  setHeaders: (res, filePath) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const ext = path.extname(filePath).toLowerCase();
    const inlineExts = [".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp3", ".wav", ".ogg", ".mp4", ".webm", ".txt"];
    if (inlineExts.includes(ext)) {
      res.setHeader("Content-Disposition", "inline");
    }
  }
}));

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

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  const map = {
    ".pdf": "application/pdf",
    ".txt": "text/plain; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".zip": "application/zip",
    ".rar": "application/vnd.rar",
    ".7z": "application/x-7z-compressed"
  };

  return map[ext] || "application/octet-stream";
}

function isInlineFriendly(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return [
    ".pdf",
    ".txt",
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".svg",
    ".mp3",
    ".wav",
    ".ogg",
    ".m4a",
    ".mp4",
    ".webm",
    ".mov"
  ].includes(ext);
}

function sanitizeViewerName(fileName) {
  return path.basename(String(fileName || ""));
}

function safeParseJsonArray(value) {
  try {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeDocumentItem(doc) {
  if (!doc) return null;

  if (typeof doc === "string") {
    const cleanUrl = doc.trim();
    if (!cleanUrl) return null;
    return {
      name: path.basename(cleanUrl) || "Documento",
      url: cleanUrl,
      directUrl: cleanUrl,
      viewerUrl: cleanUrl.includes("/viewer/") ? cleanUrl : cleanUrl
    };
  }

  const url =
    doc.url ||
    doc.file_url ||
    doc.fileUrl ||
    doc.directUrl ||
    doc.viewerUrl ||
    "";

  if (!url) return null;

  const name =
    doc.name ||
    doc.file_name ||
    doc.fileName ||
    path.basename(url) ||
    "Documento";

  const viewerUrl =
    doc.viewerUrl ||
    (url.includes("/files/")
      ? url.replace("/files/", "/viewer/")
      : url);

  return {
    ...doc,
    name,
    url,
    directUrl: doc.directUrl || url,
    viewerUrl
  };
}

function normalizeLessonRow(row) {
  const docsRaw =
    row.document_urls ??
    row.documents_json ??
    row.documentos_json ??
    "[]";

  const parsedDocs = safeParseJsonArray(docsRaw)
    .map(normalizeDocumentItem)
    .filter(Boolean);

  const mainFile = row.file_url
    ? [{
        name: row.file_name || path.basename(row.file_url) || "Documento principal",
        url: row.file_url,
        directUrl: row.file_url,
        viewerUrl: row.file_url.includes("/files/")
          ? row.file_url.replace("/files/", "/viewer/")
          : row.file_url
      }]
    : [];

  const combined = [...mainFile, ...parsedDocs];

  const uniqueDocuments = combined.filter((doc, index, arr) => {
    return index === arr.findIndex((d) => d.url === doc.url);
  });

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
    song_url: row.song_url ?? "",
    song_lyrics: row.song_lyrics ?? "",
    song_translation: row.song_translation ?? "",
    song_notes: row.song_notes ?? "",
    file_url: row.file_url ?? "",
    file_name: row.file_name ?? "",

    // Compatibilidad máxima para frontend
    document_urls: uniqueDocuments,
    documents_json: uniqueDocuments,
    documentos_json: uniqueDocuments,
    documents: uniqueDocuments
  };
}

// =========================
// ASEGURAR ESQUEMA
// =========================
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
        document_urls TEXT DEFAULT '[]',
        documents_json TEXT DEFAULT '[]',
        documentos_json TEXT DEFAULT '[]',
        link TEXT DEFAULT '',
        link_1 TEXT DEFAULT '',
        link_2 TEXT DEFAULT '',
        link_3 TEXT DEFAULT '',
        link_4 TEXT DEFAULT '',
        link_5 TEXT DEFAULT '',
        song_title TEXT DEFAULT '',
        song_url TEXT DEFAULT '',
        song_lyrics TEXT DEFAULT '',
        song_translation TEXT DEFAULT '',
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
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS document_urls TEXT DEFAULT '[]'`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS documents_json TEXT DEFAULT '[]'`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS documentos_json TEXT DEFAULT '[]'`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS link TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS link_1 TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS link_2 TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS link_3 TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS link_4 TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS link_5 TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS song_title TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS song_url TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS song_lyrics TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS song_translation TEXT DEFAULT ''`);
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
        last_login_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS nombre TEXT`);
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS email TEXT`);
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS password TEXT`);
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP`);
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
        document_urls = COALESCE(document_urls, '[]'),
        documents_json = COALESCE(documents_json, document_urls, '[]'),
        documentos_json = COALESCE(documentos_json, documents_json, document_urls, '[]'),
        estado = COALESCE(NULLIF(TRIM(estado), ''), NULLIF(TRIM(status), ''), 'draft'),
        status = COALESCE(NULLIF(TRIM(status), ''), NULLIF(TRIM(estado), ''), 'draft'),
        link_1 = COALESCE(link_1, ''),
        link_2 = COALESCE(link_2, ''),
        link_3 = COALESCE(link_3, ''),
        link_4 = COALESCE(link_4, ''),
        link_5 = COALESCE(link_5, ''),
        song_title = COALESCE(song_title, ''),
        song_url = COALESCE(song_url, ''),
        song_lyrics = COALESCE(song_lyrics, ''),
        song_translation = COALESCE(song_translation, ''),
        song_notes = COALESCE(song_notes, ''),
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
  limits: { fileSize: 60 * 1024 * 1024 }
});

// =========================
// VISOR ESTABLE DE ARCHIVOS
// =========================
app.get("/viewer/:file", (req, res) => {
  try {
    const fileName = sanitizeViewerName(req.params.file);
    const filePath = path.join(DISK_FILES_DIR, fileName);

    if (!fileName || !fs.existsSync(filePath)) {
      return res.status(404).send("Archivo no encontrado");
    }

    const stat = fs.statSync(filePath);
    const mimeType = getMimeType(filePath);
    const range = req.headers.range;

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Content-Disposition", isInlineFriendly(filePath) ? "inline" : `attachment; filename="${fileName}"`);

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;

      if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= stat.size) {
        res.status(416).setHeader("Content-Range", `bytes */${stat.size}`);
        return res.end();
      }

      const chunkSize = (end - start) + 1;
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
      res.setHeader("Content-Length", chunkSize);

      const stream = fs.createReadStream(filePath, { start, end });
      stream.on("error", (err) => {
        console.error("VIEWER STREAM ERROR:", err);
        if (!res.headersSent) {
          res.status(500).end("Error leyendo archivo");
        } else {
          res.end();
        }
      });
      return stream.pipe(res);
    }

    res.setHeader("Content-Length", stat.size);

    const stream = fs.createReadStream(filePath);
    stream.on("error", (err) => {
      console.error("VIEWER STREAM ERROR:", err);
      if (!res.headersSent) {
        res.status(500).end("Error leyendo archivo");
      } else {
        res.end();
      }
    });
    return stream.pipe(res);

  } catch (error) {
    console.error("VIEWER ERROR:", error);
    return res.status(500).send("Error abriendo archivo");
  }
});

// =========================
// API DE SOPORTE DE ARCHIVOS
// =========================
app.get("/api/files", (req, res) => {
  try {
    const files = fs.readdirSync(DISK_FILES_DIR).map((name) => {
      const filePath = path.join(DISK_FILES_DIR, name);
      const stat = fs.statSync(filePath);
      return {
        name,
        size: stat.size,
        modified_at: stat.mtime,
        url: `/files/${name}`,
        viewer_url: `/viewer/${name}`
      };
    }).sort((a, b) => new Date(b.modified_at) - new Date(a.modified_at));

    res.json({ ok: true, files });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
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
// MODULES
// =========================
app.get("/api/modules", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, titulo, title, descripcion, description, estado, status, created_at, updated_at
      FROM modules
      ORDER BY id DESC
    `);

    res.json({
      ok: true,
      modules: result.rows.map(normalizeModuleRow)
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/modules", async (req, res) => {
  try {
    const rawTitle = normalizeText(req.body.titulo || req.body.title);
    const rawDesc = normalizeText(req.body.descripcion || req.body.description);
    const rawStatus = normalizeStatus(req.body.estado || req.body.status || "published", "published");

    const finalTitle = rawTitle || autoModuleTitle();

    const result = await pool.query(`
      INSERT INTO modules (
        titulo, title, descripcion, description, estado, status, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
      RETURNING *
    `, [finalTitle, finalTitle, rawDesc, rawDesc, rawStatus, rawStatus]);

    res.json({
      ok: true,
      module: normalizeModuleRow(result.rows[0]),
      message: "Módulo creado correctamente"
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.delete("/api/modules/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const result = await pool.query(`DELETE FROM modules WHERE id = $1 RETURNING id`, [id]);
    if (!result.rowCount) return res.status(404).json({ ok: false, error: "Módulo no encontrado" });

    res.json({ ok: true, message: "Módulo eliminado correctamente" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// =========================
// LESSONS
// =========================
app.get("/api/lessons/:moduleId", async (req, res) => {
  try {
    const moduleId = Number(req.params.moduleId);
    if (!moduleId) return res.status(400).json({ ok: false, error: "moduleId inválido" });

    const result = await pool.query(`
      SELECT l.*, COALESCE(m.titulo, m.title, '') AS module_titulo, COALESCE(m.title, m.titulo, '') AS module_title
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
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/lesson/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const result = await pool.query(`
      SELECT l.*, COALESCE(m.titulo, m.title, '') AS module_titulo, COALESCE(m.title, m.titulo, '') AS module_title
      FROM lessons l
      LEFT JOIN modules m ON m.id = l.module_id
      WHERE l.id = $1
      LIMIT 1
    `, [id]);

    if (!result.rowCount) return res.status(404).json({ ok: false, error: "Clase no encontrada" });

    res.json({
      ok: true,
      lesson: normalizeLessonRow(result.rows[0])
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/lessons", async (req, res) => {
  try {
    const moduleId = Number(req.body.module_id || req.body.moduleId);
    if (!moduleId) {
      return res.status(400).json({ ok: false, error: "Debes seleccionar un módulo" });
    }

    const moduleExists = await pool.query(`SELECT id FROM modules WHERE id = $1 LIMIT 1`, [moduleId]);
    if (!moduleExists.rowCount) {
      return res.status(404).json({ ok: false, error: "El módulo seleccionado no existe" });
    }

    const rawTitle = normalizeText(req.body.titulo || req.body.title);
    const rawDesc = normalizeText(req.body.descripcion || req.body.description);
    const rawContent = normalizeText(req.body.contenido || req.body.text_content || req.body.textContent);

    const videoUrl = normalizeText(req.body.video_url || req.body.videoUrl);
    const youtubeUrl = normalizeText(req.body.youtube_url || req.body.youtubeUrl || req.body.link);
    const tiktokUrl = normalizeText(req.body.tiktok_url || req.body.tiktokUrl);
    const audioUrl = normalizeText(req.body.audio_url || req.body.audioUrl);

    const fileUrl = normalizeText(req.body.file_url || req.body.fileUrl);
    const fileName = normalizeText(req.body.file_name || req.body.fileName);

    const link1 = normalizeText(req.body.link_1);
    const link2 = normalizeText(req.body.link_2);
    const link3 = normalizeText(req.body.link_3);
    const link4 = normalizeText(req.body.link_4);
    const link5 = normalizeText(req.body.link_5);

    const songTitle = normalizeText(req.body.song_title);
    const songUrl = normalizeText(req.body.song_url);
    const songLyrics = normalizeText(req.body.song_lyrics);
    const songTranslation = normalizeText(req.body.song_translation);
    const songNotes = normalizeText(req.body.song_notes);

    const documentUrlsRaw =
      req.body.document_urls ||
      req.body.documents_json ||
      req.body.documentos_json ||
      "[]";

    const docsArray = safeParseJsonArray(documentUrlsRaw);
    const normalizedDocs = docsArray
      .map(normalizeDocumentItem)
      .filter(Boolean);

    if (fileUrl) {
      normalizedDocs.unshift({
        name: fileName || path.basename(fileUrl) || "Documento principal",
        url: fileUrl,
        directUrl: fileUrl,
        viewerUrl: fileUrl.includes("/files/")
          ? fileUrl.replace("/files/", "/viewer/")
          : fileUrl
      });
    }

    const uniqueDocs = normalizedDocs.filter((doc, index, arr) => {
      return index === arr.findIndex((d) => d.url === doc.url);
    });

    const docsJson = JSON.stringify(uniqueDocs);

    const rawStatus = normalizeStatus(req.body.estado || req.body.status || "draft", "draft");
    const finalTitle = rawTitle || autoLessonTitle();

    const result = await pool.query(`
      INSERT INTO lessons (
        module_id,
        titulo, title,
        descripcion, description,
        contenido, text_content,
        video_url, youtube_url, tiktok_url, audio_url,
        file_url, file_name,
        document_urls, documents_json, documentos_json,
        link,
        link_1, link_2, link_3, link_4, link_5,
        song_title, song_url, song_lyrics, song_translation, song_notes,
        estado, status,
        created_at, updated_at
      )
      VALUES (
        $1,
        $2, $3,
        $4, $5,
        $6, $7,
        $8, $9, $10, $11,
        $12, $13,
        $14, $15, $16,
        $17,
        $18, $19, $20, $21, $22,
        $23, $24, $25, $26, $27,
        $28, $29,
        NOW(), NOW()
      )
      RETURNING *
    `, [
      moduleId,
      finalTitle, finalTitle,
      rawDesc, rawDesc,
      rawContent, rawContent,
      videoUrl, youtubeUrl, tiktokUrl, audioUrl,
      fileUrl, fileName,
      docsJson, docsJson, docsJson,
      youtubeUrl,
      link1, link2, link3, link4, link5,
      songTitle, songUrl, songLyrics, songTranslation, songNotes,
      rawStatus, rawStatus
    ]);

    res.json({
      ok: true,
      lesson: normalizeLessonRow(result.rows[0]),
      message: "Clase creada correctamente"
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.put("/api/lessons/:id/publish", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const result = await pool.query(`
      UPDATE lessons
      SET estado = 'published', status = 'published', updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [id]);

    if (!result.rowCount) return res.status(404).json({ ok: false, error: "Clase no encontrada" });

    res.json({
      ok: true,
      lesson: normalizeLessonRow(result.rows[0]),
      message: "Clase publicada correctamente"
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.put("/api/lessons/:id/archive", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const result = await pool.query(`
      UPDATE lessons
      SET estado = 'archived', status = 'archived', updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [id]);

    if (!result.rowCount) return res.status(404).json({ ok: false, error: "Clase no encontrada" });

    res.json({
      ok: true,
      lesson: normalizeLessonRow(result.rows[0]),
      message: "Clase archivada correctamente"
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.delete("/api/lessons/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: "ID inválido" });

    const lessonResult = await pool.query(`
      SELECT file_url, documents_json, document_urls, documentos_json
      FROM lessons
      WHERE id = $1
      LIMIT 1
    `, [id]);

    const result = await pool.query(`DELETE FROM lessons WHERE id = $1 RETURNING id`, [id]);
    if (!result.rowCount) return res.status(404).json({ ok: false, error: "Clase no encontrada" });

    if (lessonResult.rowCount) {
      const lesson = lessonResult.rows[0];
      const fileCandidates = [];

      if (lesson.file_url) {
        const name = sanitizeViewerName(String(lesson.file_url).split("/").pop());
        if (name) fileCandidates.push(name);
      }

      const docs = safeParseJsonArray(
        lesson.documents_json || lesson.document_urls || lesson.documentos_json || "[]"
      );

      docs.forEach((d) => {
        const url = typeof d === "string" ? d : (d.url || d.file_url || "");
        const name = sanitizeViewerName(String(url).split("/").pop());
        if (name) fileCandidates.push(name);
      });

      [...new Set(fileCandidates)].forEach((name) => {
        const filePath = path.join(DISK_FILES_DIR, name);
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch (e) {
            console.error("No se pudo borrar archivo físico:", name, e.message);
          }
        }
      });
    }

    res.json({ ok: true, message: "Clase eliminada correctamente" });
  } catch (error) {
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
        s.last_login_at,
        s.created_at,
        COALESCE(AVG(p.progress_percent), 0)::int AS progreso_promedio
      FROM students s
      LEFT JOIN progress p ON p.student_id = s.id
      GROUP BY s.id
      ORDER BY s.id DESC
    `);

    res.json({ ok: true, students: result.rows });
  } catch (error) {
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

    const existing = await pool.query(`SELECT id FROM students WHERE email = $1 LIMIT 1`, [email]);
    if (existing.rowCount > 0) {
      return res.status(400).json({ ok: false, error: "Ese correo ya está registrado" });
    }

    const result = await pool.query(`
      INSERT INTO students (nombre, email, password, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      RETURNING id, nombre, email, created_at
    `, [nombre, email, password]);

    res.json({ ok: true, student: result.rows[0], message: "Estudiante registrado correctamente" });
  } catch (error) {
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

    if (!result.rowCount) {
      return res.status(401).json({ ok: false, error: "Correo o contraseña incorrectos" });
    }

    await pool.query(`
      UPDATE students
      SET last_login_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [result.rows[0].id]);

    res.json({
      ok: true,
      student: {
        ...result.rows[0],
        last_login_at: new Date().toISOString()
      },
      message: "Login correcto"
    });
  } catch (error) {
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

    res.json({ ok: true, progress: result.rows[0], message: "Progreso guardado correctamente" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/progress/:studentId", async (req, res) => {
  try {
    const studentId = Number(req.params.studentId);
    if (!studentId) return res.status(400).json({ ok: false, error: "studentId inválido" });

    const result = await pool.query(`
      SELECT
        p.*,
        COALESCE(l.titulo, l.title, '') AS lesson_title,
        l.module_id
      FROM progress p
      LEFT JOIN lessons l ON l.id = p.lesson_id
      WHERE p.student_id = $1
      ORDER BY p.id DESC
    `, [studentId]);

    res.json({ ok: true, progress: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// =========================
// SUBIDA DE ARCHIVOS
// =========================
app.post("/api/upload-file", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No se recibió ningún archivo" });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const directUrl = `${baseUrl}/files/${req.file.filename}`;
    const viewerUrl = `${baseUrl}/viewer/${req.file.filename}`;

    res.json({
      ok: true,
      file: {
        originalName: req.file.originalname,
        savedName: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
        url: directUrl,
        directUrl,
        viewerUrl,
        diskPath: req.file.path
      },
      file_url: directUrl,
      file_name: req.file.originalname,
      viewer_url: viewerUrl,
      message: "Archivo subido correctamente"
    });
  } catch (error) {
    console.error("UPLOAD ERROR:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// =========================
// API PÚBLICA ALUMNO
// =========================
app.get("/api/public/modules", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, titulo, title, descripcion, description, estado, status
      FROM modules
      WHERE COALESCE(status, estado) = 'published'
      ORDER BY id ASC
    `);

    res.json({
      ok: true,
      modules: result.rows.map(normalizeModuleRow)
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/public/lessons/:moduleId", async (req, res) => {
  try {
    const moduleId = Number(req.params.moduleId);
    if (!moduleId) return res.status(400).json({ ok: false, error: "moduleId inválido" });

    const result = await pool.query(`
      SELECT l.*, COALESCE(m.titulo, m.title, '') AS module_titulo, COALESCE(m.title, m.titulo, '') AS module_title
      FROM lessons l
      LEFT JOIN modules m ON m.id = l.module_id
      WHERE l.module_id = $1 AND COALESCE(l.status, l.estado) = 'published'
      ORDER BY l.id ASC
    `, [moduleId]);

    res.json({
      ok: true,
      lessons: result.rows.map(normalizeLessonRow)
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/student-dashboard", async (req, res) => {
  try {
    const [modulesResult, lessonsResult] = await Promise.all([
      pool.query(`
        SELECT id, titulo, title, descripcion, description, estado, status
        FROM modules
        WHERE COALESCE(status, estado) = 'published'
        ORDER BY id ASC
      `),
      pool.query(`
        SELECT l.*, COALESCE(m.titulo, m.title, '') AS module_titulo, COALESCE(m.title, m.titulo, '') AS module_title
        FROM lessons l
        LEFT JOIN modules m ON m.id = l.module_id
        WHERE COALESCE(l.status, l.estado) = 'published'
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
    res.status(500).json({ ok: false, error: error.message });
  }
});

// =========================
// 404 / ERROR
// =========================
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Ruta no encontrada" });
});

app.use((error, req, res, next) => {
  console.error("ERROR GLOBAL:", error);
  res.status(500).json({ ok: false, error: error.message || "Error interno del servidor" });
});

// =========================
// START
// =========================
async function startServer() {
  try {
    await ensureSchema();
    app.listen(PORT, () => {
      console.log(`✅ Servidor corriendo en puerto ${PORT}`);
      console.log(`✅ Disk mount path: ${DISK_MOUNT_PATH}`);
      console.log(`✅ Disk files dir: ${DISK_FILES_DIR}`);
    });
  } catch (error) {
    console.error("❌ No se pudo iniciar el servidor:", error.message);
    process.exit(1);
  }
}

startServer();
