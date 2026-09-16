import rateLimit from "express-rate-limit";

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: "Demasiadas solicitudes. Intenta en unos minutos." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (_req, res) => res.statusCode < 400,
});

// Estricto: solo para credenciales (login, recuperar/restablecer contraseña).
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // En tests se registran/loguean decenas de usuarios por correr (una vez por
  // fixture); en producción el cupo humano de 10 intentos se conserva.
  max:
    Number(process.env.AUTH_RATE_LIMIT) ||
    (process.env.NODE_ENV === "test" ? 500 : 10),
  message: { error: "Demasiados intentos de autenticación. Intenta de nuevo en unos minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Laxo: crear cuenta es una acción legítima; no debe compartir el cupo del login.
export const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: "Demasiados registros desde esta conexión. Intenta de nuevo en unos minutos." },
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