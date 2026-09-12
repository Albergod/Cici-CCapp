import rateLimit from "express-rate-limit";

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: "Demasiadas solicitudes. Intenta en unos minutos." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (_req, res) => res.statusCode < 400,
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Demasiados intentos de autenticación. Intenta de nuevo en unos minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});

export const paymentLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: { error: "Límite de preferencias alcanzado. Espera un minuto." },
  standardHeaders: true,
  legacyHeaders: false,
});