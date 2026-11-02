// Validación compartida de los datos de PSE (checkout autenticado e invitado).
import { z } from "zod";

export const PSE_SCHEMA = z.object({
  // Wompi: 0 = persona natural, 1 = persona jurídica.
  userType: z.union([z.literal(0), z.literal(1)]),
  legalIdType: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2,5}$/, "Tipo de documento inválido (CC, CE, NIT, PP).")
    .transform((v) => v.toUpperCase()),
  legalId: z.string().trim().regex(/^\d{5,15}$/, "Número de documento inválido."),
  financialInstitutionCode: z.string().trim().min(1).max(10),
  fullName: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(80).optional(),
});

export type PseInput = z.infer<typeof PSE_SCHEMA>;
