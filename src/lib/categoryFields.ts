// ─────────────────────────────────────────────────────────────────────────────
// Campos dinámicos de los productos por tipo de tienda.
//
// Cada categoría define los atributos que tiene un producto de esa tienda.
// Con esto:
//   • El formulario de "Publicar producto" muestra los campos que corresponden.
//   • La IA del chat conoce la variante exacta que eligió el cliente
//     (talla, número de habitaciones, porción, fecha, etc.).
//
// El frontend mantiene una copia espejo en frontend/src/lib/categoryFields.ts.
// Si cambias algo aquí, mantenlo sincronizado.
// ─────────────────────────────────────────────────────────────────────────────

export type BusinessType = "ROPA" | "CALZADO" | "ACCESORIOS" | "HOGAR" | "ALIMENTOS" | "SERVICIOS" | "OTRO";

export type AttributeType = "text" | "number" | "select" | "boolean";

export interface AttributeField {
  key: string;
  label: string;
  type: AttributeType;
  options?: string[];
  placeholder?: string;
  helper?: string;
  min?: number;
  max?: number;
}

export interface AttributeValue {
  key: string;
  label: string;
  value: string;
}

// Convierte un atributo a texto legible para la IA / chips ("2 hab", "Amoblado", "talla M").
export function attributeToText(key: string, value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? key : "";
  return `${key}: ${value}`.trim();
}

// Atributo → vale la pena mostrarlo en chips de producto.
export function isAttributeVisible(value: string | number | boolean | undefined): value is string | number | boolean {
  return value !== undefined && value !== null && value !== "" && value !== false;
}

/** Devuelve los campos definidos para un tipo de negocio. */
export function fieldsFor(businessType: BusinessType | undefined): AttributeField[] {
  return CATEGORY_FIELDS[businessType ?? "OTRO"] ?? CATEGORY_FIELDS.OTRO;
}

/** Convierte un objeto de atributos en una lista ordenada (para chips e IA). */
export function attributesToTitledList(
  businessType: BusinessType | undefined,
  attributes: Record<string, string | number | boolean> | null | undefined,
): AttributeValue[] {
  if (!attributes) return [];
  const fields = fieldsFor(businessType);
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const result: AttributeValue[] = [];
  for (const f of fields) {
    const value = attributes[f.key];
    if (isAttributeVisible(value)) {
      result.push({ key: f.key, label: f.label, value: String(value) });
    }
  }
  // Atributos libres que no estén en la definición (por compatibilidad)
  for (const [key, value] of Object.entries(attributes)) {
    if (!byKey.has(key) && isAttributeVisible(value)) {
      result.push({ key, label: key, value: String(value) });
    }
  }
  return result;
}

/** Resumen en una línea para la IA: "talla: M, color: azul". */
export function attributesSummary(
  businessType: BusinessType | undefined,
  attributes: Record<string, string | number | boolean> | null | undefined,
): string {
  return attributesToTitledList(businessType, attributes)
    .map((a) => `${a.label.toLowerCase()}: ${a.value}`)
    .join(", ");
}

/**
 * Deja pasar solo los atributos permitidos para la categoría de la tienda y
 * coacciona los tipos esperados. Devuelve un objeto limpio {} si no aplica.
 */
export function sanitizeAttributes(
  businessType: BusinessType | undefined,
  input: Record<string, unknown> | undefined | null,
): Record<string, string | number | boolean> {
  const clean: Record<string, string | number | boolean> = {};
  if (!input || typeof input !== "object") return clean;

  for (const field of fieldsFor(businessType)) {
    const value = input[field.key];
    if (value === undefined || value === null || value === "") continue;

    if (field.type === "number") {
      const n = Number(value);
      if (!Number.isNaN(n)) clean[field.key] = n;
    } else if (field.type === "boolean") {
      clean[field.key] = value === true || value === "true";
    } else if (field.type === "select") {
      if (typeof value === "string") clean[field.key] = value;
    } else {
      clean[field.key] = String(value).slice(0, 160);
    }
  }
  return clean;
}

export const CATEGORY_FIELDS: Record<BusinessType, AttributeField[]> = {
  ROPA: [
    { key: "talla", label: "Talla", type: "select", options: ["XS", "S", "M", "L", "XL", "XXL", "Personalizada"], placeholder: "Selecciona talla" },
    { key: "color", label: "Color", type: "text", placeholder: "Ej: azul marino" },
    { key: "material", label: "Material", type: "text", placeholder: "Ej: algodón" },
  ],
  CALZADO: [
    { key: "numero", label: "Número", type: "number", min: 20, max: 50, placeholder: "Ej: 42" },
    { key: "color", label: "Color", type: "text", placeholder: "Ej: blanco" },
  ],
  ACCESORIOS: [
    { key: "tipo", label: "Tipo", type: "select", options: ["Joyería", "Relojes", "Bijouterie", "Otro"], placeholder: "Selecciona tipo" },
    { key: "material", label: "Material", type: "text", placeholder: "Ej: acero inoxidable" },
    { key: "medida", label: "Medida", type: "text", placeholder: "Ej: diámetro 42mm / talla M de anillo" },
    { key: "color", label: "Color", type: "text", placeholder: "Ej: dorado" },
  ],
  HOGAR: [
    { key: "tipoUnidad", label: "Tipo de unidad", type: "select", options: ["Apartamento", "Casa", "Studio", "Habitación"], placeholder: "Selecciona tipo" },
    { key: "habitaciones", label: "Habitaciones", type: "number", min: 0, max: 20, placeholder: "Ej: 2" },
    { key: "banos", label: "Baños", type: "number", min: 0, max: 10, placeholder: "Ej: 1" },
    { key: "areaM2", label: "Área (m²)", type: "number", min: 1, max: 5000, placeholder: "Ej: 60" },
    { key: "amoblado", label: "Amoblado", type: "boolean" },
    { key: "ubicacion", label: "Ubicación / Zona", type: "text", placeholder: "Ej: El Prado, norte" },
    { key: "disponibleDesde", label: "Disponible desde", type: "text", placeholder: "Ej: marzo 2026" },
  ],
  ALIMENTOS: [
    { key: "porcion", label: "Porción / Unidad", type: "select", options: ["Porción", "Media docena", "Docena", "Unidad"], placeholder: "Selecciona" },
    { key: "restricciones", label: "Restricciones / Alérgenos", type: "text", placeholder: "Ej: contiene gluten, nueces" },
  ],
  SERVICIOS: [
    { key: "duracion", label: "Duración", type: "text", placeholder: "Ej: 1 hora / por sesión" },
    { key: "modalidad", label: "Modalidad", type: "select", options: ["Domicilio", "En el local", "Virtual"], placeholder: "Selecciona" },
  ],
  OTRO: [],
};