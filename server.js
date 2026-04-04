const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.static("public"));

// ===== CONEXIÓN DB =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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

// ===== INICIALIZAR TABLAS =====
app.get("/api/init-db", async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS modules (
        id SERIAL PRIMARY KEY,
        titulo TEXT NOT NULL,
        descripcion TEXT,
        publicado BOOLEAN DEFAULT true
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS lessons (
        id SERIAL PRIMARY KEY,
        module_id INTEGER REFERENCES modules(id) ON DELETE CASCADE,
        titulo TEXT NOT NULL,
        youtube_url TEXT,
        pdf_url TEXT,
        publicado BOOLEAN DEFAULT true
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        nombre TEXT,
        email TEXT UNIQUE,
        password TEXT
      );
    `);

    const checkModule = await pool.query("SELECT COUNT(*) AS total FROM modules");
    const totalModules = Number(checkModule.rows[0].total);

    if (totalModules === 0) {
      await pool.query(`
        INSERT INTO modules (titulo, descripcion, publicado)
        VALUES ('Primer módulo', 'Introducción inicial', true);
      `);

      await pool.query(`
        INSERT INTO lessons (module_id, titulo, youtube_url, pdf_url, publicado)
        VALUES (
          1,
          'Primera clase',
          'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          '',
          true
        );
      `);
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

// ===== CREAR MÓDULO =====
app.post("/api/module", async (req, res) => {
  try {
    const { titulo, descripcion } = req.body;

    if (!titulo) {
      return res.status(400).json({ ok: false, error: "Título requerido" });
    }

    const result = await pool.query(
      "INSERT INTO modules (titulo, descripcion, publicado) VALUES ($1,$2,true) RETURNING *",
      [titulo, descripcion || ""]
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

    if (!module_id || !titulo) {
      return res.status(400).json({ ok: false, error: "Datos incompletos" });
    }

    const result = await pool.query(
      `INSERT INTO lessons (module_id, titulo, youtube_url, pdf_url, publicado)
       VALUES ($1,$2,$3,$4,true)
       RETURNING *`,
      [module_id, titulo, youtube_url || "", pdf_url || ""]
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

// ===== VER CLASES =====
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

// ===== ERROR GENERAL =====
app.use((err, req, res, next) => {
  console.error("ERROR GENERAL:", err);
  res.status(500).json({ ok: false, error: "Error interno del servidor" });
});

// ===== PUERTO =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor listo en puerto " + PORT);
});
