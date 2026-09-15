// Espejo de src/lib/categoryFields.ts (backend). Mantén sincronizado.
// Define los campos dinámicos de un producto según el tipo de tienda.
export type BusinessType = "ROPA" | "CALZADO" | "ACCESORIOS" | "HOGAR" | "ALIMENTOS" | "SERVICIOS" | "BELLEZA" | "OTRO";

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

export function fieldsFor(businessType: BusinessType | undefined): AttributeField[] {
  return CATEGORY_FIELDS[businessType ?? "OTRO"] ?? CATEGORY_FIELDS.OTRO;
}

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
    if (value !== undefined && value !== null && value !== "" && value !== false) {
      result.push({ key: f.key, label: f.label, value: String(value) });
    }
  }
  for (const [key, value] of Object.entries(attributes)) {
    if (!byKey.has(key) && value !== undefined && value !== null && value !== "" && value !== false) {
      result.push({ key, label: key, value: String(value) });
    }
  }
  return result;
}

export function attributesSummary(
  businessType: BusinessType | undefined,
  attributes: Record<string, string | number | boolean> | null | undefined,
): string {
  return attributesToTitledList(businessType, attributes)
    .map((a) => `${a.label.toLowerCase()}: ${a.value}`)
    .join(" · ");
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
  BELLEZA: [],
  OTRO: [],
};