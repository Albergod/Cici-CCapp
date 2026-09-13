import { OpenAI } from "openai";
import { attributesSummary, BusinessType } from "./categoryFields";

// ── Configuración por entorno ──────────────────────────────────────────
const AI_PROVIDER = process.env.AI_PROVIDER || "groq";
const AI_BASE_URL = process.env.AI_BASE_URL || "https://api.groq.com/openai/v1";
const AI_API_KEY = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || "";
const AI_MODEL = process.env.AI_MODEL || "openai/gpt-oss-120b";

export const openai = AI_API_KEY
  ? new OpenAI({ apiKey: AI_API_KEY, baseURL: AI_BASE_URL })
  : null;

// ── Perfiles por tipo de negocio ──────────────────────────────────────
// Cada categoría define cómo la IA debe acompañar la venta: qué datos
// verificar ANTES de confirmar un pedido, cómo escribir la línea Producto
// de la factura, si la factura lleva campos extra (fecha/lugar), y qué
// nunca debe preguntar ni asumir.
type BusinessProfile = {
  label: string;
  closingQuestions: string;
  productPlaceholder: string;
  productNote?: string;
  invoiceExtra?: string[];
  neverAsk: string;
  greetingNote: string;
};

const BUSINESS_TYPE_PROFILES: Record<string, BusinessProfile> = {
  ROPA: {
    label: "tienda de ropa",
    closingQuestions:
      "pregunta la talla deseada si el cliente no la menciona y confirma que esté disponible; también pregunta el color o estilo que prefiere si el cliente no lo indicó.",
    productPlaceholder: "[Nombre del producto] (talla [número])",
    productNote: "solo agrega (color [color]) si el cliente lo mencionó.",
    neverAsk: "medidas corporales ni tallas distintas a las del catálogo; no inventes tallas disponibles.",
    greetingNote: "tienda de ropa",
  },
  CALZADO: {
    label: "tienda de calzado",
    closingQuestions:
      "pregunta el número de calzado si el cliente no lo menciona y confirma que esté disponible.",
    productPlaceholder: "[Nombre del producto] (talla [número])",
    neverAsk: "tallajes corporales ni medidas distintas a las del catálogo.",
    greetingNote: "tienda de calzado",
  },
  ACCESORIOS: {
    label: "tienda de accesorios, joyería o relojes",
    closingQuestions:
      "pregunta la variante deseada (color, modelo o material) si el cliente no la indica. Si el artículo es anillo, pulsera o reloj, pregunta el tamaño/diámetro que prefiere (p. ej. medida en mm) sin llamarlo 'talla'.",
    productPlaceholder: "[Nombre del producto] (variante [color/modelo/material])",
    productNote: "solo agrega (medida [mm o tamaño]) si el cliente la mencionó o si aplica al artículo.",
    neverAsk:
      "'talla' en ropas ni tallajes en NINGÚN caso, ni aunque el catálogo o la descripción de un producto mencione talles o medidas; un número que mencione el cliente (p. ej. 'esfera de 42mm') es una medida, no una talla. Preguntá siempre por la variante (color/modelo/material) y, si aplica, la medida del artículo.",
    greetingNote: "tienda de accesorios, joyería o relojes",
  },
  HOGAR: {
    label: "tienda de arriendos de apartamentos",
    closingQuestions:
      "pregunta el periodo de arriendo (desde cuándo y por cuánto tiempo), si la unidad debe ser amoblada o no, la zona/ubicación preferida y cuántas personas la ocuparán; verifica que la unidad cumpla lo pedido según sus atributos (habitaciones, baños, área).",
    productPlaceholder: "[Nombre del apartamento] (período [desde – hasta])",
    productNote:
      "usa los atributos del producto (habitaciones, baños, área, amoblado, ubicación) para describir la unidad en la conversación.",
    invoiceExtra: ["*Período:* [fecha desde – hasta]", "*Amoblado:* [sí / no]"],
    neverAsk: "tallas, medidas corporales ni 'talles' de ropa; un arriendo no se compra ni lleva talla.",
    greetingNote: "tienda de arriendos de apartamentos",
  },
  ALIMENTOS: {
    label: "tienda de alimentos",
    closingQuestions:
      "confirma la cantidad o porción; pregunta si hay restricciones o alérgenos relevantes que considerar; y pregunta si el cliente prefiere retirar en el local o que se entregue a domicilio.",
    productPlaceholder: "[Nombre del producto] x[cantidad] (porción si aplica)",
    neverAsk: "tallas corporales; si el cliente menciona alérgenos, no hagas recomendaciones médicas.",
    greetingNote: "tienda de alimentos",
  },
  SERVICIOS: {
    label: "prestador de servicios",
    closingQuestions:
      "pregunta la fecha deseada, la hora y el lugar donde se prestará el servicio (a domicilio o en el local).",
    productPlaceholder: "[Nombre del servicio]",
    invoiceExtra: [
      "*Fecha y hora:* [fecha y hora acordadas]",
      "*Lugar:* [dirección o 'en el local']",
    ],
    neverAsk: "tallas ni medidas corporales en ningún caso.",
    greetingNote: "prestador de servicios",
  },
  OTRO: {
    label: "tienda",
    closingQuestions:
      "verifica cualquier variante relevante que el catálogo indique para el producto (sin inventar opciones).",
    productPlaceholder: "[Nombre del producto]",
    neverAsk: "tallas de ropa salvo que el nombre del producto o el catálogo lo indique.",
    greetingNote: "tienda",
  },
};

// `needsSizes` por compatibilidad: solo ROPA/CALZADO piden tallas.
function storeBusinessType(store: StoreInfo): string {
  return (store.businessType ?? "OTRO").toUpperCase();
}

function profileFor(store: StoreInfo): BusinessProfile {
  return BUSINESS_TYPE_PROFILES[storeBusinessType(store)] ?? BUSINESS_TYPE_PROFILES.OTRO;
}

export function storeNeedsSizes(store: StoreInfo): boolean {
  const type = storeBusinessType(store);
  return type === "ROPA" || type === "CALZADO";
}

// ── Tipos auxiliares ──────────────────────────────────────────────────
type ProductShort = {
  name: string;
  price: number;
  description?: string;
  stock?: number | null;
  attributes?: Record<string, string | number | boolean>;
};
type StoreInfo = {
  name: string;
  plan: "FREE" | "PRO" | "BUSINESS";
  prestigeActive: boolean;
  whatsapp?: string | null;
  businessType?: string;
};

// ── Fallback determinístico ────────────────────────────────────────────
function formatPrice(p: number): string {
  return Number(p).toFixed(2);
}

// Detecta si una respuesta de la IA es una factura (pedido confirmado).
export function isInvoice(content: string): boolean {
  return content.includes("Pedido Confirmado");
}

// A partir de la factura que genera la IA (entre guiones ---), arma las dos
// versiones del mensaje:
//  - `chat`: lo que ve el cliente en la app (aviso para que espere respuesta).
//  - `wa`:   lo que el comerciante recibe por WhatsApp (aviso para ir a la app).
export function buildInvoiceVersions(invoiceBlock: string): { chat: string; wa: string } | null {
  if (!isInvoice(invoiceBlock)) return null;
  const body = invoiceBlock
    .split("\n")
    .filter((line) => line.trim() !== "---")
    .join("\n")
    .trim();
  if (!body) return null;
  return {
    chat: `📋 ${body}\n\n_Quédate pendiente en la aplicación: el comerciante puede escribirte por este mismo chat para confirmar o coordinar la entrega._`,
    wa: `📦 Pedido nuevo:\n\n${body}\n\n_Si quieres comunicarte con el cliente, ve a la aplicación._`,
  };
}

const WHATSAPP_PATTERN = /^\d{7,15}$/;

// Enlace de WhatsApp hacia un número. Con `text` genera un mensaje precargado
// (deep link); sin `text`, solo el contacto.
export function buildStoreWaLink(phone: string | null | undefined, text?: string): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!WHATSAPP_PATTERN.test(digits)) return null;
  return text
    ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
    : `https://wa.me/${digits}`;
}

function fallbackGreeting({
  storeName,
  productName,
}: {
  storeName: string;
  productName?: string;
}) {
  if (productName) {
    return `¡Hola! Vi que te interesa el producto "${productName}". Soy el asistente de ${storeName}. ¿En qué puedo ayudarte?`;
  }
  return `¡Hola! Bienvenido a ${storeName}. Soy tu asistente virtual. ¿Tienes alguna pregunta sobre nuestros productos?`;
}

function fallbackReply({
  storeName,
  storeWhatsapp,
  products,
  lastMessageContent,
  contextProductName,
}: {
  storeName: string;
  storeWhatsapp?: string | null;
  products: ProductShort[];
  lastMessageContent?: string;
  contextProductName?: string;
}) {
  const productNames: string[] = [];
  for (let i = 0; i < products.length && i < 3; i++) {
    productNames.push(products[i].name);
  }
  const intro = `En ${storeName} tenemos: ${productNames}. `;
  const prices = products.slice(0, 3).map((p) => formatPrice(p.price)).join(" / ");
  const mid = `Nuestros precios van desde ${prices}. `;
  const end = "¿En qué más puedo ayudarte?";
  const context = contextProductName
    ? `Sobre "${contextProductName}", ` :
    "";
  const agotado = contextProductName && products.some((p) => p.name === contextProductName && p.stock !== undefined && p.stock !== null && p.stock <= 0)
    ? `Ese producto se agotó. ¿Te interesa otro del catálogo? `
    : "";
  const wa = storeWhatsapp && /^\d{7,15}$/.test(storeWhatsapp)
    ? `Si quieres cerrar la compra o necesitas más información, escríbenos directo por WhatsApp al ${storeWhatsapp}. `
    : "";
  return intro + mid + context + agotado + wa + end;
}

// ── Generador de saludo inicial ────────────────────────────────────────

export async function getStoreGreeting(
  store: StoreInfo,
  product?: { name: string },
): Promise<string> {
  if (store.plan === "FREE" || !openai) {
    return fallbackGreeting({ storeName: store.name, productName: product?.name });
  }
  try {
    const profile = profileFor(store);
    const prompt = `Eres un asistente virtual de "${store.name}" (plan ${store.plan}, ${profile.label}). El cliente acaba de abrir el chat mirando el producto "${product?.name}". Escribe un saludo cálido, natural y breve (máx. 30 palabras) que invite a preguntar por ese producto o por otras dudas. No menciones precios ni disponibilidad en el saludo inicial; solo presentate y abre la conversación.`;
    const resp = await openai!.chat.completions.create({
      model: AI_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });
    return (
      resp.choices[0]?.message?.content?.trim() || fallbackGreeting({ storeName: store.name, productName: product?.name })
    );
  } catch {
    return fallbackGreeting({ storeName: store.name, productName: product?.name });
  }
}

// ── Generador de respuesta guardada ────────────────────────────────────

export async function getIAStoreReply({
  store,
  products,
  history,
  contextProduct,
  customerName,
}: {
  store: StoreInfo;
  products: ProductShort[];
  history?: { content: string }[];
  contextProduct?: { name: string; attributes?: Record<string, string | number | boolean> } | null;
  customerName?: string;
}): Promise<string> {
  const lastMessage = history && history.length > 0 ? history[history.length - 1] : undefined;
  const lastMessageContent = lastMessage?.content;
  // Si no es plan de pago o no hay key, fallback determinístico
  if (store.plan === "FREE" || !openai) {
    return fallbackReply({
      storeName: store.name,
      storeWhatsapp: store.whatsapp,
      products,
      lastMessageContent,
      contextProductName: contextProduct?.name,
    });
  }
  try {
    // Catálogo resumido (máx. 5 productos)
    const catalogLines = products
      .slice(0, 5)
      .map((p) => {
        const stockNote =
          p.stock !== undefined && p.stock !== null && p.stock <= 0
            ? " [AGOTADO, no ofrecer venta]"
            : p.stock !== undefined && p.stock !== null && p.stock < 10
              ? ` [solo quedan ${p.stock}]`
              : "";
        const attrsNote =
          p.attributes && Object.keys(p.attributes).length > 0
            ? ` (${attributesSummary(store.businessType as BusinessType | undefined, p.attributes)})`
            : "";
        return `- ${p.name}: $${formatPrice(p.price)}${attrsNote}${p.description ? ` - ${p.description.substring(0, 60)}` : ""}${stockNote}`;
      })
      .join("\n");
    const waLine = store.whatsapp && /^\d{7,15}$/.test(store.whatsapp)
      ? `WhatsApp del comerciante para cerrar ventas: ${store.whatsapp}`
      : "El comerciante aún no configuró un número de WhatsApp. Si el cliente quiere cerrar una compra, ofrécele dejarlo anotado para que el dueño le escriba.";
    const contextLine = contextProduct?.name
      ? `El cliente llegó al chat mirando este producto: "${contextProduct.name}". Respóndele como si ese producto fuera el foco de tu atención, sin olvidar que también tienes el resto del catálogo.${
          contextProduct.attributes && Object.keys(contextProduct.attributes).length > 0
            ? ` ${contextProduct.name} tiene estos atributos: ${attributesSummary(store.businessType as BusinessType | undefined, contextProduct.attributes)}.`
            : ""
        }`
      : "El cliente abrió el chat sin seleccionar un producto específico, así que acompaña su consulta con naturalidad.";

    const profile = profileFor(store);

    // Comportamiento según el tipo de negocio: qué preguntar antes de una
    // venta y qué nunca preguntar ni asumir.
    const sizeInstruct = `
Tipo de tienda: ${profile.label} (definido por el comerciante). Para acompañar una venta:
- ${profile.closingQuestions}

Qué NO hacer:
- ${profile.neverAsk}

Si el cliente ya dio esos datos en mensajes anteriores, no se los vuelvas a pedir.`;

    // Historial de la conversación para no repetir preguntas ya respondidas
    const historyLines = (history ?? []).slice(-10).map((h) => `- ${h.content}`).join("\n");

    const invoiceExtraLines = profile.invoiceExtra ? `\n${profile.invoiceExtra.join("\n")}\n` : "";
    const productNoteLine = profile.productNote
      ? `\nNota para la línea Producto de la factura: ${profile.productNote}`
      : "";

    // Instrucciones de pedido y factura (adaptadas a la categoría)
    const orderInstruct = `
Cuando el cliente confirme que quiere comprar un producto:
1. Verifica que tengas el nombre del cliente${customerName ? ` (en esta conversación el cliente se llama: ${customerName})` : ". Si no lo conoces, pídelo"}.
2. Verifica que tengas la dirección de entrega completa.
3. Verifica que tengas un número de teléfono de contacto.
4. ${profile.closingQuestions}
Si falta alguno de estos datos, pídelos de forma natural antes de confirmar el pedido (siempre respetando lo indicado en el perfil de la tienda).${productNoteLine}

Cuando tengas todos los datos, responde SOLO con la factura siguiente (formato WhatsApp con *negrita*, delimitada por ---):

---
✅ *Pedido Confirmado*

*Cliente:* ${customerName || "[Nombre del cliente]"}
*Producto:* ${profile.productPlaceholder}
*Precio:* $[precio]
${invoiceExtraLines}
*Dirección de entrega:* [Dirección completa]
*Teléfono:* [Teléfono de contacto]

Total: $[precio]
---

No agregues nada fuera de esos guiones ni después de la línea de Total: ni saludos, ni explicaciones, ni despedidas, ni notas.`;

    const prompt = `Sos el asistente de la tienda "${store.name}" (plan ${store.plan}, ${profile.label}). El cliente acaba de escribir: "${lastMessage?.content || "hola"}".
Respondé de forma natural, breve (máx. 80 palabras), en español, como si fueras el dueño de la tienda.
Usá solo la información del catálogo a continuación. Si un producto está marcado [AGOTADO], decile que se agotó y ofrecé ayuda con otros productos; nunca ofrezcas vender un producto agotado. No inventes precios ni datos que no sean los del catálogo ni del WhatsApp del comerciante.

Contexto de esta conversación:
${contextLine}

Conversación previa del cliente (mensajes anteriores, ya respondidos):
${historyLines ? historyLines : "(no hay mensajes previos)"}

${sizeInstruct}

${orderInstruct}

Dato importante:
${waLine}

Catálogo:
${catalogLines}
`;
    const resp = await openai!.chat.completions.create({
      model: AI_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
    });
    return (
      resp.choices[0]?.message?.content?.trim() ||
      fallbackReply({
        storeName: store.name,
        storeWhatsapp: store.whatsapp,
        products,
        lastMessageContent,
        contextProductName: contextProduct?.name,
      })
    );
  } catch {
    return fallbackReply({
      storeName: store.name,
      storeWhatsapp: store.whatsapp,
      products,
      lastMessageContent,
      contextProductName: contextProduct?.name,
    });
  }
}
