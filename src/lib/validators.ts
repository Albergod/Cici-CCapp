import { z } from "zod";

// Valida imagen: URL absoluta (http/https) o ruta relativa subida al servidor (/uploads/...).
export function imageUrl() {
  return z.string().refine(
    (value) => /^https?:\/\/\S+$/i.test(value) || /^\/uploads\/[\w.\-]+$/i.test(value),
    { message: "URL de imagen inválida" },
  );
}