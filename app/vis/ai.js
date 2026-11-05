// Comptage par IA (Claude, Anthropic) — utilisé seulement quand l'utilisateur
// appuie sur « IA ». Le SDK est chargé à la demande pour que l'application
// reste entièrement utilisable hors ligne sans lui.

const SDK_URL = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.137.0/+esm";
const MODEL = "claude-opus-5-5";

const SCHEMA = {
  type: "object",
  properties: {
    count: { type: "integer", description: "Nombre total de vis visibles" },
    screws: {
      type: "array",
      description: "Position de la tête de chaque vis, en pixels de l'image fournie",
      items: {
        type: "object",
        properties: { x: { type: "number" }, y: { type: "number" } },
        required: ["x", "y"],
        additionalProperties: false,
      },
    },
    notes: { type: "string", description: "Remarque courte en français (zones incertaines, vis cachées), ou chaîne vide" },
  },
  required: ["count", "screws", "notes"],
  additionalProperties: false,
};

/**
 * @param {string} apiKey
 * @param {string} jpegBase64  image JPEG encodée en base64 (sans préfixe data:)
 * @param {number} width       dimensions de l'image envoyée
 * @param {number} height
 * @param {number|null} lengthHint  longueur approximative d'une vis dans cette image (px)
 * @param {boolean} [masked=false]  des parties de l'image sont masquées en gris uni (hors zone)
 * @returns {Promise<{count:number, screws:{x:number,y:number}[], notes:string}>}
 */
export async function countWithClaude(apiKey, jpegBase64, width, height, lengthHint, masked = false) {
  let Anthropic;
  try {
    ({ default: Anthropic } = await import(SDK_URL));
  } catch {
    throw new Error("Impossible de charger le module IA : vérifiez la connexion Internet.");
  }
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const hint = lengthHint
    ? ` Pour vous repérer, une vis mesure environ ${Math.round(lengthHint)} px de long dans cette image.`
    : "";
  const prompt =
    `Cette photo (${width} × ${height} px) montre des vis posées sur une surface, étalées ou en vrac, qui peuvent se croiser et se chevaucher.` +
    hint +
    (masked ? " Les parties en gris uni sont masquées : ne comptez que les vis visibles hors de ces parties grises." : "") +
    " Repérez chaque vis, y compris celles en partie cachées sous d'autres vis (une tête ou une pointe qui dépasse suffit)," +
    " et donnez la position de sa tête en pixels (origine en haut à gauche) ; si la tête est cachée, donnez le point le plus visible de la vis." +
    " Suivez chaque vis sur toute sa longueur pour ne pas la compter deux fois, et ignorez les objets qui ne sont pas des vis." +
    " « count » doit être égal au nombre d'éléments de « screws ».";

  let message;
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpegBase64 } },
          { type: "text", text: prompt },
        ],
      }],
    });
    message = await stream.finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error("Clé API refusée. Vérifiez-la dans les réglages.");
    if (err instanceof Anthropic.RateLimitError) throw new Error("Trop de requêtes : réessayez dans un instant.");
    if (err instanceof Anthropic.APIConnectionError) throw new Error("Pas de connexion avec le service IA.");
    if (err instanceof Anthropic.APIError) throw new Error(`Erreur du service IA (${err.status ?? "?"}) : ${err.message}`);
    throw err;
  }

  if (message.stop_reason === "refusal") throw new Error("L'IA a refusé d'analyser cette image.");
  if (message.stop_reason === "max_tokens") throw new Error("Réponse de l'IA incomplète (trop de vis ?). Comptez en plusieurs zones.");
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Réponse de l'IA illisible.");
  }
  const screws = (data.screws || []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  return { count: data.count, screws, notes: data.notes || "" };
}
