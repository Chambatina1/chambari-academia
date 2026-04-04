const express = require("express");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ===== TEST =====
app.get("/api/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ ok: true, time: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===== REGISTRO =====
app.post("/api/register", async (req, res) => {
  try {
    const { nombre, email, password } = req.body;

    const result = await pool.query(
      "INSERT INTO students (nombre, email, password) VALUES ($1,$2,$3) RETURNING *",
      [nombre, email, password]
    );

    res.json({ ok: true, user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Error registrando" });
  }
});

// ===== CREAR MODULO =====
app.post("/api/module", async (req, res) => {
  try {
    const { titulo, descripcion } = req.body;

    const result = await pool.query(
      "INSERT INTO modules (titulo, descripcion, publicado) VALUES ($1,$2,true) RETURNING *",
      [titulo, descripcion]
    );

    res.json({ ok: true, module: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false });
  }
});

// ===== CREAR CLASE =====
app.post("/api/lesson", async (req, res) => {
  try {
    const { module_id, titulo, youtube_url, pdf_url } = req.body;

    const result = await pool.query(
      "INSERT INTO lessons (module_id, titulo, youtube_url, pdf_url, publicado) VALUES ($1,$2,$3,$4,true) RETURNING *",
      [module_id, titulo, youtube_url, pdf_url]
    );

    res.json({ ok: true, lesson: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false });
  }
});

// ===== VER CLASES =====
app.get("/api/lessons/:moduleId", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM lessons WHERE module_id = $1 AND publicado = true",
      [req.params.moduleId]
    );

    res.json({ ok: true, lessons: result.rows });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor listo"));
