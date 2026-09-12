# GUIA-IA.md — Cómo actuar con la IA del chat( sin depender de nadie )

## Por qué no tienes que preocuparte

La IA de la app **no está atada a ningún proveedor**. Todo el sistema se apoya en 3 piezas intercambiables:

| Pieza | Dónde | Rol |
|---|---|---|
| Cliente OpenAI-compatible | `src/lib/ai.ts` | Habla con cualquier API que respete el formato de OpenAI |
| Variables de entorno | `.env` | `AI_BASE_URL`, `AI_MODEL`, `GROQ_API_KEY` / `OPENAI_API_KEY` |
| Fallback determinístico | `src/lib/ai.ts` | Respuestas armadas desde el catálogo si no hay IA disponible |

**Cambiar de proveedor = editar 2 líneas del `.env` + reiniciar.** No hay que tocar código.

---

## Escenario 1 — Probar ahora (ya configurado)

Key de Groq puesta. El chat PRO/BUSINESS responde con el modelo `openai/gpt-oss-120b`.

- Quieres otro modelo → lista los disponibles y cambia `AI_MODEL`:

  ```
  curl -s https://api.groq.com/openai/v1/models \
    -H "Authorization: Bearer $GROQ_API_KEY" | python3 -m json.tool
  ```

- Groq es gratis pero con límites; si notas lentitud, cambia `AI_MODEL` a uno más chico (`openai/gpt-oss-20b`).

## Escenario 2 — Groq baja, da error 401/429/404 o desaparece

1. Revisa qué está pasando: el log del backend (`/tmp/cc-backend.log`) y esta llamada rápida:

   ```
   curl -s https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY"
   ```

2. **Mientras tanto la app NO se cae**: el `catch` en `src/lib/ai.ts` usa el fallback determinístico. El chat sigue funcionando con respuestas del catálogo, sin error visible para el usuario.

3. Cambias de proveedor en `.env`:
   - **OpenAI**: `AI_BASE_URL="https://api.openai.com/v1"`, `AI_MODEL="gpt-4o-mini"` (o el que uses), y usa `OPENAI_API_KEY`.
   - **Together** / **Mistral** / **AnyOpenAI**: misma lógica, solo cambian URL y modelo.
   - **Autohospedado** (ver escenario 4): apunta `AI_BASE_URL` a tu propio servidor.

4. Reinicia: matar el proceso de :3000 y levantar de nuevo (mismo procedimiento de siempre).

## Escenario 3 — Antes de lanzar al mercado

Nadie puede controlar que un tercero (Groq, OpenAI...) cambie precios, límites o cierre. Antes del launch, decide cuál de estas 3 opciones usarás:

- **A) Gratis/barato**: mantenerse en Groq (gratis hoy) o colocar una key de OpenAI con límite de gasto mensual.
- **B) Autohospedado (recomendado)**: corre tú mismo un modelo libre con **Ollama** o **vLLM** en un VPS. Costo fijo (~$5-20/mes), sin API key, sin sorpresas. Detalle abajo.
- **C) Híbrido (máxima seguridad)**: autohospedado como `AI_BASE_URL` principal + un respaldo en la nube. Si el tuyo falla, cambias la URL y listo.

> Regla de oro: **nunca dependas de un solo proveedor**. El sistema está hecho para que el cambio sea de 2 minutos.

## Escenario 4 — Cómo autohospedar con Ollama (plan B / plan principal)

Servidor: un VPS con mínimo 8-16 GB RAM (ej. alguno de los buenos y baratos del mercado). Instalar:

### 1. Instalar Ollama en el servidor

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

### 2. Traer un modelo de peso libre (bueno para respuestas de catálogo)

```bash
ollama pull qwen2.5:7b         # rápido, corre en 8-16 GB
# o, si el servidor tiene RAM de sobra:
ollama pull qwen2.5:14b        # más inteligente
```

### 3. Exponer la API compatible OpenAI

Ollama nativo ya sirve la ruta `/v1/chat/completions` en el puerto 11434,
que es compatible con el cliente que usa la app.

- En local (solo para probar): `http://localhost:11434/v1`
- En el VPS expón el puerto, o mejor ponlo detrás de un proxy (Caddy/nginx) con HTTPS.

### 4. Configurar la app

```env
AI_BASE_URL="https://tu-servidor.com/v1"   # o http://IP_DEL_VPS:11434/v1
AI_MODEL="qwen2.5:7b"
GROQ_API_KEY=""                            # deja vacía o bórrala
OPENAI_API_KEY=""
```

Reinicia el backend y el chat usará tu servidor. **Sin key, sin cuota, sin que un tercero lo pueda quitar.**

### Coste estimado

| Proveedor | Costo mensual | Dependencia |
|---|---|---|
| Groq (hoy) | $0 | Sí, tercero |
| OpenAI | según uso (key con tope) | Sí, tercero |
| Ollama (8 GB) | ~$6-10 VPS | No, es tuyo |

---

## Comprobación rápida (después de cualquier cambio)

1. Reiniciar backend.
2. Abrir `http://localhost:3000/health` → `{"ok":true}`.
3. Abrir una conversación con una tienda PRO/BUSINESS y enviar un mensaje.
   La respuesta IA debe llegar guardada con `aiGenerated: true`.
4. Si la IA fallara, el chat responde igual (fallback). Revisa `/tmp/cc-backend.log` para ver errores reales.

## Recuerda

- El código de la IA **no necesita cambios** para ninguna de estas opciones.
- El fallback existe para que el chat **nunca se vea roto** ante el usuario.
- Lo que convierte la IA en algo "tuyo" no es el modelo: es tu catálogo, tus instrucciones
  (en `src/lib/ai.ts`) y la lógica de negocio. Eso ya lo tienes.