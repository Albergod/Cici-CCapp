import { Router, Request, Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { requireAuth, AuthRequest } from "../middleware/auth";

const uploadsDir = path.resolve(__dirname, "..", "..", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!EXT_BY_MIME[file.mimetype]) {
      return cb(new Error("Tipo de archivo no permitido"));
    }
    cb(null, true);
  },
});

function cloudinaryConfigured(): boolean {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  return Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET);
}

async function uploadToCloudinary(file: Express.Multer.File): Promise<string> {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new Error("Cloudinary no está configurado");
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `cc-products/${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const signature = crypto
    .createHmac("sha1", CLOUDINARY_API_SECRET)
    .update(`public_id=${publicId}&timestamp=${timestamp}`)
    .digest("hex");

  const form = new FormData();
  form.append("public_id", publicId);
  form.append("timestamp", String(timestamp));
  form.append("api_key", CLOUDINARY_API_KEY);
  form.append("signature", signature);
  form.append(
    "file",
    new Blob([file.buffer], { type: file.mimetype }),
    `cc-${Date.now()}${EXT_BY_MIME[file.mimetype] || ".png"}`,
  );

  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
  const response = await fetch(url, { method: "POST", body: form });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Cloudinary rechazó la imagen (${response.status}) ${text.slice(0, 300)}`);
  }
  const data = (await response.json()) as { secure_url?: string };
  if (!data.secure_url) {
    throw new Error("Cloudinary no devolvió una URL válida");
  }
  return data.secure_url;
}

const router = Router();

// Sube una imagen (logo, portada o producto) y devuelve su URL pública.
router.post("/", requireAuth, (req: AuthRequest, res: Response) => {
  upload.single("image")(req as Request, res as Response, async (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "La imagen no puede superar los 5 MB." });
    }
    if (err) {
      return res.status(400).json({ error: "Envía una imagen válida (jpg, png, webp, gif, avif)." });
    }
    if (!req.file) {
      return res.status(400).json({ error: "Selecciona un archivo de imagen." });
    }

    try {
      if (cloudinaryConfigured()) {
        const url = await uploadToCloudinary(req.file);
        return res.json({ url });
      }
      const ext = EXT_BY_MIME[req.file.mimetype] || ".png";
      const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
      fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
      return res.json({ url: `/uploads/${filename}` });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Error al subir la imagen";
      console.error("upload falló:", message);
      return res.status(502).json({ error: message });
    }
  });
});

export default router;