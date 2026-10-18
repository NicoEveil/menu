# Cloud Functions — Extraction IA des recettes

## Rôle

`extractRecipe` : Cloud Function appelée par le site avec une URL de recette.
Elle télécharge la page, la nettoie (HTML → texte), l'envoie à l'API Mistral
(modèle `mistral-small-latest`) avec un prompt d'extraction/normalisation/
traduction FR, et renvoie un JSON : `name`, `servings`, `ingredients`,
`steps`, `imageUrl`.

La clé API Mistral est stockée côté Firebase (secret), **jamais dans le code**.

## Déploiement (une fois, côté utilisateur)

Prérequis : forfait Blaze activé (fait), Node.js 22 installé localement,
`firebase-tools` :

```bash
npm install -g firebase-tools
firebase login
```

Dans ce dossier `functions/` :

```bash
npm install
```

À la racine du repo, un `firebase.json` minimal (voir ci-dessous) est requis.

### 1. Ranger la clé API Mistral dans les secrets

```bash
# Créer le secret (une seule fois) — la valeur est saisie en invite
firebase functions:secrets:set MISTRAL_API_KEY
```

### 2. Déployer la fonction

```bash
firebase deploy --only functions
```

La fonction est déployée en `europe-west1`. Le secret `MISTRAL_API_KEY` est
injecté dans l'environnement de la fonction automatiquement.

## Appel depuis le site

Le site appelle la fonction via le SDK Firebase (fonction callable) :

```js
const { getFunctions, httpsCallable } = await import('.../firebase-functions.js');
const functions = getFunctions(app, 'europe-west1');
const extractRecipe = httpsCallable(functions, 'extractRecipe');
const result = await extractRecipe({ url });
// result.data.recipe = { name, servings, ingredients, steps, imageUrl }
```

## Coûts

Quotas gratuits Blaze largement suffisants (~10 extractions/mois) :
facture réelle 0 €. Alertes budget recommandées côté console GCP.
