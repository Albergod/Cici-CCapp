import { Router, Request, Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { requireAuth, AuthRequest } from "../middleware/auth";

const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = EXT_BY_MIME[file.mimetype] || ".png";
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!EXT_BY_MIME[file.mimetype]) {
      return cb(new Error("Tipo de archivo no permitido"));
    }
    cb(null, true);
  },
});

const router = Router();

// Sube una imagen (logo, portada o producto) y devuelve su URL pública.
router.post("/", requireAuth, (req: AuthRequest, res: Response) => {
  upload.single("image")(req as Request, res as Response, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "La imagen no puede superar los 5 MB." });
    }
    if (err) {
      return res.status(400).json({ error: "Envía una imagen válida (jpg, png, webp, gif, avif)." });
    }
    if (!req.file) {
      return res.status(400).json({ error: "Selecciona un archivo de imagen." });
    }
    res.json({ url: `/uploads/${req.file.filename}` });
  });
});

export default router;