const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

app.use(cors({
  origin: [
    "https://chambatina1.github.io",
    "http://localhost:3000",
    "http://127.0.0.1:5500"
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

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

// ===== TEST API =====
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

    res.status(500).json({ ok: false, error: err.message || "Error registrando" });
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
    res.status(500).json({ ok: false, error: err.message || "Error creando módulo" });
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
      [
        module_id,
        titulo,
        youtube_url || "",
        pdf_url || ""
      ]
    );

    res.json({ ok: true, lesson: result.rows[0] });
  } catch (err) {
    console.error("LESSON ERROR:", err);
    res.status(500).json({ ok: false, error: err.message || "Error creando clase" });
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
    res.status(500).json({ ok: false, error: err.message || "Error cargando módulos" });
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
    res.status(500).json({ ok: false, error: err.message || "Error cargando clases" });
  }
});

// ===== ERROR GENERAL =====
app.use((err, req, res, next) => {
  console.error("ERROR GENERAL:", err);
  res.status(500).json({ ok: false, error: "Error interno del servidor" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor listo en puerto " + PORT);
});
