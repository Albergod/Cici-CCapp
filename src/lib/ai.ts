import { OpenAI } from "openai";

// ── Configuración por entorno ──────────────────────────────────────────
const AI_PROVIDER = process.env.AI_PROVIDER || "groq";
const AI_BASE_URL = process.env.AI_BASE_URL || "https://api.groq.com/openai/v1";
const AI_API_KEY = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || "";
const AI_MODEL = process.env.AI_MODEL || "openai/gpt-oss-120b";

export const openai = AI_API_KEY
  ? new OpenAI({ apiKey: AI_API_KEY, baseURL: AI_BASE_URL })
  : null;

// ── Tipos auxiliares ──────────────────────────────────────────────────
type ProductShort = { name: string; price: number; description?: string; stock?: number | null };
type StoreInfo = {
  name: string;
  plan: "FREE" | "PRO" | "BUSINESS";
  prestigeActive: boolean;
  whatsapp?: string | null;
  // Si la tienda vende ROPA o CALZADO, la IA debe pedir la talla al cliente.
  needsSizes?: boolean;
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
    const prompt = `Eres un asistente virtual de una tienda llamada "${store.name}" (plan ${store.plan}). El cliente acaba de abrir el chat mirando el producto "${product?.name}". Escribe un saludo cálido, natural y breve (máx. 30 palabras) que invite a preguntar por ese producto o por otras dudas. No menciones precios ni disponibilidad en el saludo inicial; solo presentate y abre la conversación.`;
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
  contextProduct?: { name: string } | null;
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
        return `- ${p.name}: $${formatPrice(p.price)}${p.description ? ` - ${p.description.substring(0, 60)}` : ""}${stockNote}`;
      })
      .join("\n");
    const waLine = store.whatsapp && /^\d{7,15}$/.test(store.whatsapp)
      ? `WhatsApp del comerciante para cerrar ventas: ${store.whatsapp}`
      : "El comerciante aún no configuró un número de WhatsApp. Si el cliente quiere cerrar una compra, ofrécele dejarlo anotado para que el dueño le escriba.";
    const contextLine = contextProduct?.name
      ? `El cliente llegó al chat mirando este producto: "${contextProduct.name}". Respóndele como si ese producto fuera el foco de tu atención, sin olvidar que también tienes el resto del catálogo.`
      : "El cliente abrió el chat sin seleccionar un producto específico, así que acompaña su consulta con naturalidad.";

    // Talla: solo en tiendas ROPA/CALZADO. En relojes, joyas, accesorios u
    // otros, nunca ofrecer ni preguntar por tallas al cliente.
    const sizeInstruct = store.needsSizes
      ? "Esta tienda vende ROPA o CALZADO: al atender un pedido o una duda de compra, pregunta la talla deseada si el cliente no la menciona, y confirma que esté disponible."
      : "Esta tienda NO vende ropa ni calzado: no preguntes por tallas, talles ni medidas. Un número que mencione el cliente (ej. 'esfera de 42mm') no es una talla; no lo asumas como tal.";

    // Historial de la conversación para no repetir preguntas ya respondidas
    const historyLines = (history ?? []).slice(-10).map((h) => `- ${h.content}`).join("\n");

    // Instrucciones de pedido y factura
    const orderInstruct = `
Cuando el cliente confirme que quiere comprar un producto:
1. Verifica que tengas el nombre del cliente${customerName ? ` (en esta conversación el cliente se llama: ${customerName})` : ". Si no lo conoces, pídelo"}.
2. Verifica que tengas la dirección de entrega completa.
3. Verifica que tengas un número de teléfono de contacto.
Si falta alguno de estos datos, pídelos de forma natural antes de confirmar el pedido.

Cuando tengas todos los datos, responde SOLO con la factura siguiente (formato WhatsApp con *negrita*, delimitada por ---, y donde [número] es cualquier talla):

---
✅ *Pedido Confirmado*

*Cliente:* ${customerName || "[Nombre del cliente]"}
*Producto:* [Nombre del producto][ si necesita talla: (talla [número])]
*Precio:* $[precio]

*Dirección de entrega:* [Dirección completa]
*Teléfono:* [Teléfono de contacto]

Total: $[precio]
---

No agregues nada fuera de esos guiones ni después de la línea de Total: ni saludos, ni explicaciones, ni despedidas, ni notas.`;

    const prompt = `Sos el asistente de la tienda "${store.name}" (plan ${store.plan}). El cliente acaba de escribir: "${lastMessage?.content || "hola"}".
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
