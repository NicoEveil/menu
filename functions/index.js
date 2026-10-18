// Cloud Function : extraction IA d'une recette depuis une URL
// Architecture : le site appelle cette fonction avec une URL de recette ->
// la fonction telecharge la page, envoie le contenu a l'API Mistral avec un
// prompt d'extraction/normalisation/traduction FR, et renvoie un JSON.
// La cle API Mistral est stockee cote Firebase (secret), jamais dans le code.

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';
const MISTRAL_MODEL = 'mistral-small-latest';
const MAX_HTML_BYTES = 300000;
const FETCH_TIMEOUT_MS = 15000;

const SYSTEM_PROMPT = `Tu es un assistant culinaire. On te fournit le contenu HTML d'une page web contenant une recette de cuisine.

Ta mission : extraire la recette et la retourner STRICTEMENT en JSON valide (sans markdown, sans texte autour), avec exactement ces cles :
{
  "name": "nom de la recette en francais",
  "servings": "nombre de personnes (chiffre seul) ou chaine vide",
  "ingredients": ["ligne par ligne, quantite d'abord, en francais, ex: '200 g de farine'"],
  "steps": "etapes de preparation, un paragraphe par etape, separees par des sauts de ligne, en francais",
  "imageUrl": "URL de la photo principale de la recette si presente dans la page, sinon chaine vide",
  "language": "langue detectee de la recette source (ex: 'en', 'fr')"
}

Regles :
- Traduis tout en francais (nom, ingredients, etapes).
- Normalise les ingredients : quantite + unite + nom, une ligne par ingredient. Les sous-titres de groupe (ex: 'Pour la sauce :') restent sur leur propre ligne, finissant par ' :'.
- Garde les quantites d'origine, converties mentalement en unites francaises courantes si besoin (ex: 'cup' -> 'tasse' avec la quantite equivalente approximative en ml/g entre parentheses).
- Si un champ est absent de la page, mets une chaine vide (ou liste vide pour ingredients).
- Reponds UNIQUEMENT avec l'objet JSON.`;

// Telecharger une page avec un timeout et une limite de taille
async function fetchPage(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            redirect: 'follow',
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; MaCuisineRecipeExtractor/1.0)',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'fr,en;q=0.8'
            }
        });
        if (!response.ok) {
            throw new HttpsError('failed-precondition', `Le site a repondu avec le statut ${response.status}.`);
        }
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/html') && !contentType.includes('xhtml')) {
            throw new HttpsError('failed-precondition', 'Cette URL ne pointe pas vers une page HTML.');
        }
        const buffer = await response.arrayBuffer();
        const sliced = buffer.byteLength > MAX_HTML_BYTES
            ? buffer.slice(0, MAX_HTML_BYTES)
            : buffer;
        return new TextDecoder('utf-8', { fatal: false }).decode(sliced);
    } finally {
        clearTimeout(timeout);
    }
}

// Reduire le HTML bruit au texte utile pour limiter les tokens envoyes au modele
function htmlToText(html) {
    // Retirer script/style/noscript/svg et les commentaires
    let text = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        // Metas utiles (og:image, schema.org image)
        .replace(/<meta[^>]*og:image[^>]*content="([^"]*)"[^>]*>/gi, ' [OG_IMAGE: $1] ')
        .replace(/<meta[^>]*content="([^"]*)"[^>]*og:image[^>]*>/gi, ' [OG_IMAGE: $1] ');
    // Balises structurelles -> sauts de ligne, reste -> espaces
    text = text
        .replace(/<\/(p|div|li|tr|h[1-6]|section|article|ul|ol|table|br)/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ');
    // Decoder les entites HTML courantes
    text = text
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&eacute;/g, 'e').replace(/&egrave;/g, 'e').replace(/&agrave;/g, 'a')
        .replace(/&ccedil;/g, 'c');
    // Coller les espaces, limiter les lignes vides
    text = text
        .split('\n').map(l => l.replace(/\s+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return text;
}

// Appeler l'API Mistral avec le contenu de la page
async function extractWithMistral(apiKey, pageText) {
    const response = await fetch(MISTRAL_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: MISTRAL_MODEL,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: pageText }
            ],
            temperature: 0.2,
            max_tokens: 2000
        })
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        logger.error('Erreur API Mistral', response.status, detail);
        if (response.status === 401) {
            throw new HttpsError('internal', 'Cle API Mistral invalide.');
        }
        throw new HttpsError('internal', `Erreur API Mistral (statut ${response.status}).`);
    }
    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || '';
    // Le modele peut renvoyer le JSON dans un bloc markdown malgre la consigne
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
        return JSON.parse(content);
    } catch (e) {
        logger.error('Reponse Mistral non parsable', content.slice(0, 500));
        throw new HttpsError('internal', "La reponse de l'IA n'a pas pu etre interpretee.");
    }
}

// Normaliser la sortie du modele vers le format attendu par l'app
function normalizeRecipe(extracted) {
    const servingsRaw = String(extracted.servings || '').trim();
    const servings = servingsRaw.match(/\d+/) ? servingsRaw.match(/\d+/)[0] : '';
    let ingredients = Array.isArray(extracted.ingredients)
        ? extracted.ingredients.map(i => String(i).trim()).filter(Boolean)
        : [];
    if (ingredients.length === 0 && typeof extracted.ingredients === 'string' && extracted.ingredients.trim()) {
        ingredients = extracted.ingredients.split(/\r?\n/).map(i => i.trim()).filter(Boolean);
    }
    const imageUrl = typeof extracted.imageUrl === 'string' ? extracted.imageUrl.trim() : '';
    return {
        name: String(extracted.name || '').trim(),
        servings,
        ingredients,
        steps: String(extracted.steps || '').trim(),
        imageUrl: /^https?:\/\//.test(imageUrl) ? imageUrl : ''
    };
}

exports.extractRecipe = onCall(
    {
        region: 'europe-west1',
        timeoutSeconds: 60,
        memory: '256MiB',
        minInstances: 0,
        maxInstances: 3,
        secrets: ['MISTRAL_API_KEY']
    },
    async (request) => {
        // Appels non authentifies rejetes : seul le site (connecte en anonyme) peut extraire
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'Connexion requise.');
        }
        const url = String(request.data?.url || '').trim();
        if (!/^https?:\/\/.+\..+/.test(url)) {
            throw new HttpsError('invalid-argument', 'URL invalide.');
        }
        // Protection basique contre les usages internes du reseau
        if (/localhost|127\.0\.|0\.0\.0\.0|192\.168\.|10\.|metadata\.google/.test(url)) {
            throw new HttpsError('invalid-argument', 'URL non autorisee.');
        }

        const apiKey = process.env.MISTRAL_API_KEY;
        if (!apiKey) {
            logger.error('MISTRAL_API_KEY absente de la configuration');
            throw new HttpsError('failed-precondition', 'Extraction non configuree : cle API absente.');
        }

        logger.info('Extraction demandee', { host: new URL(url).hostname });
        const html = await fetchPage(url);
        const pageText = htmlToText(html);
        if (pageText.length < 100) {
            throw new HttpsError('failed-precondition', 'La page ne contient pas de contenu exploitable.');
        }
        const extracted = await extractWithMistral(apiKey, pageText);
        const recipe = normalizeRecipe(extracted);
        if (!recipe.name) {
            throw new HttpsError('failed-precondition', 'Aucune recette detectee sur cette page.');
        }
        return { recipe };
    }
);
