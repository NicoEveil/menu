# Règles du projet

## Versions stables

- **Rollover automatique du jour introduit entre `stable-v28` et `stable-v29`** (v28.001) : la liste des jours se rafraîchit sans rechargement au changement de date (minuit, sortie de veille, focus de l'onglet). Premier test réel du comportement en sortie de veille profonde encore à confirmer par l'utilisateur.
- **`stable-v33` (v33.000) est la dernière version stable avant PWA** : à partir de v33.xxx on implémente la PWA (service worker, cache, manifeste). En cas de souci avec la PWA, revenir au tag `stable-v33`.

- **`stable-v34` (v34.000)** : PWA complète (service worker, manifeste, hors ligne), import/export recettes complet (Lien, Image, Notes multi-lignes avec sauts de paragraphe, Tags, Categorie), tag invisible `lastModified` par recette inclus dans l'export/import et utilisé pour la déduplication, mécanisme de mise à jour du service worker fiable (cache-busting synchronisé + rechargement auto).

Quand l'utilisateur demande d'enregistrer une version stable :

1. Modifier UNIQUEMENT le numéro de version : passer au numéro rond suivant (ex. `v23.000` → `v24.000`), c'est-à-dire :
   - le badge dans le `<h1>` de `index.html` (`<span class="version">vN.000</span>`) ;
   - les paramètres de cache-busting `?v=N.000` sur `style.css` et `script.js`.
2. Committer avec le message `vN.000: stable version (<résumé>)`.
3. Tagger ce commit `stable-vN` (séquence `stable-v1`, `stable-v2`, …) et pousser le tag.
4. Ne rien changer d'autre au code lors de ce commit.

Les correctifs entre versions stables incrémentent le patch (`v24.001`, `v24.002`, …) et mettent à jour le cache-busting en conséquence.

**Règle de version affichée** : à chaque changement de version, mettre à jour AUSSI le badge de version affiché sur le site juste après le titre (`<span class="version">vN.NNN</span>` dans le `<h1>` de `index.html`). Ce badge doit toujours correspondre à la version des paramètres de cache-busting.

**Règle cache-busting obligatoire (leçon v33.014)** : à CHAQUE changement de version, mettre à jour les paramètres `?v=N.NNN` sur `style.css` et `script.js` dans `index.html`. En v33.013 ils étaient restés bloqués à `?v=33.006` : le navigateur rechargeait donc l'ancien script.js, et les correctifs semblaient « ne pas marcher » alors qu'ils n'étaient tout simplement pas livrés. Vérifier systématiquement `grep '?v=' index.html` avant chaque commit de version.

**Règle CACHE_VERSION du service worker (leçon v44.001)** : à CHAQUE changement de version, mettre à jour AUSSI `CACHE_VERSION` dans `service-worker.js`. En v44.001, le service worker était resté bloqué à `v44.000` et resservait l'ancien `script.js` depuis son cache : le nouveau bouton « Liste de courses » semblait inactif alors que le code était bien livré. Vérifier systématiquement `grep 'CACHE_VERSION' service-worker.js` en même temps que `grep '?v=' index.html`.

## Façon de travailler (workflow de livraison)

- **Pas de Pull Request** : l'utilisateur ne relit pas le code. Workflow direct :
  1. L'agent fait les modifications sur une branche de travail ;
  2. pousse le commit directement sur `main` (push de la branche vers `main`) ;
  3. l'utilisateur vérifie le résultat sur la page en ligne et valide.
- Ne pas ouvrir de PR ni demander à l'utilisateur de relire/fusionner un PR.
- Le cache-busting (`?v=N.NNN`) force le rechargement des fichiers modifiés : pas besoin de demander de vider le cache.

## Règles permanentes

- Quand l'utilisateur donne une règle (de codage, de nommage, de façon de travailler), lui rappeler de demander son enregistrement dans ce fichier (`AGENTS.md`) si ce n'est pas déjà fait. Une règle non écrite ici est perdue entre les sessions.

## Règles métier

- Drag-and-drop désactivé sur mobile (fenêtre ≤ 768px), actif sur ordinateur et tablette.
- Les jours révolus de plus de 4 semaines (28 jours) sont purgés automatiquement au chargement (clés de date dans `menu` et `manualEntries`). L'utilisateur n'a pas besoin de conserver l'historique des jours passés.

## Tâches à faire

- **Gestion des tags** : filtrer/trier les recettes par tags (les tags existent déjà sur les recettes — formulaire, cartes, recherche — mais ne sont pas actionnables).
- ~~**PWA / hors connexion** : rendre le site accessible hors connexion (service worker, cache, manifeste).~~ **FAIT (v34.000)**
- ~~**Intégration complète des recettes dans l'app** : réduire la dépendance aux liens externes — stocker dans l'app tout ce qui constitue la recette : ingrédients structurés, étapes/préparation, image hébergée, notes. Objectif : consulter et cuisiner depuis Ma Cuisine sans retourner sur le site source.~~ **FAIT (validé par l'utilisateur après l'extraction IA v47.000)** : l'extraction IA capture nom, ingrédients structurés (quantité+unité+nom), étapes, image et portions, consultables et cuisinables depuis Ma Cuisine.
- ~~**Gestion des ingrédients et quantités dans les recettes** : ajouter une liste d'ingrédients structurée (quantité, unité, nom) au modèle de recette, avec saisie manuelle dans le formulaire, extraction automatique depuis le lien (schema.org/Recipe) quand possible, et éventuellement extraction par IA pour le texte libre.~~ **FAIT (v48.000, stable)** : les ingrédients restent stockés en lignes texte (format inchangé, compatible export/import et sync cloud), mais un parseur (`parseIngredientLine` dans `script.js`) décompose chaque ligne en quantité | unité | nom.
  - **Aperçu éditable dans le formulaire** : sous le textarea, chaque ligne reconnue s'affiche décomposée en 3 champs (quantité, unité, nom) modifiables individuellement — la modification resynchronise la ligne texte. L'espace entre quantité et unité est optionnel (`200g` = `200 g`). Unités reconnues : FR (g, kg, ml, cl, l, c. à s., c. à c., tasse, pincée, gousse, …) + US (tbsp → c. à s., tsp → c. à c., cup → tasse, oz, lb, pint). Sous-titres « … : » et lignes sans quantité reconnue restent en texte brut éditable, rien n'est perdu.
  - **Ajusteur de portions dans la vue de lecture** : si la recette a un nombre de personnes, boutons − / + qui recalculent les quantités à la volée (la recette enregistrée n'est JAMAIS modifiée). Fractions (1/2, ½) et plages (2-3) gérées. Lignes sans unité (œufs…) arrondies au quart avec fractions ½ / ¼, plancher à ¼. Quantités recalculées en **gras seul** (pas de changement de couleur : l'utilisateur a validé que c'est plus lisible ainsi).
  - **Prérequis restant pour la liste de courses** : les ingrédients sont désormais parseables en quantité/unité/nom — base prête pour le cumul d'ingrédients entre recettes.
  - **FAIT (v49.000, stable) — quantités dans la liste de courses** : sélecteur de portions (boutons − / +) sous chaque recette planifiée dans la modal Liste de courses, recalcul des quantités en direct (même moteur que la vue de lecture). Le choix par recette **persiste en localStorage** (clé `menuShoppingServings`) : il survit aux rechargements et fermetures, volontairement hors sync cloud et hors export (préférence d'achat, pas une donnée de recette). Le bouton « Copier la liste » utilise les quantités ajustées affichées.
- **Extraction IA des recettes (via Cloud Function + API Mistral)** : fonctionnalité validée par l'utilisateur, à implémenter pour tester. Architecture : bouton "Extraire depuis l'URL" dans le formulaire d'ajout → Cloud Function Firebase (télécharge la page, envoie à l'API Mistral avec un prompt d'extraction/normalisation/traduction FR, clé API stockée côté Firebase) → pré-remplissage du formulaire (jamais d'écriture directe : l'utilisateur relit et modifie avant d'enregistrer). Coût estimé : ~0,01 €/mois à 10 recettes/mois (pay-as-you-go, zéro abonnement, rien si aucune extraction). Prérequis côté utilisateur : compte API Mistral (platform.mistral.ai) + passage Firebase au forfait Blaze (carte en garantie, quota gratuit suffisant). **IMPORTANT : chaque étape de mise en place demande la validation explicite de l'utilisateur avant d'être faite — il veut mesurer concrètement le gain avant de généraliser.**
  - **Mise en place faite (v46.001)** : Cloud Function `extractRecipe` déployée en `europe-west1` sur le projet `ma-cuisine-37ba4` (forfait Blaze activé), clé API Mistral stockée dans le secret Firebase `MISTRAL_API_KEY` (ne JAMAIS la mettre dans le code ni la communiquer en clair), bouton « Extraire depuis l'URL » opérationnel dans le formulaire d'ajout. Pour redéployer la fonction : télécharger le ZIP du repo, `firebase use ma-cuisine-37ba4`, `firebase deploy --only functions` (le secret est ré-injecté automatiquement). Reste à faire : validation par l'utilisateur sur des recettes réelles avant généralisation.
  - **FAIT (v47.000, stable)** : validé par l'utilisateur sur des recettes réelles. Limite connue : les sites avec protection anti-bot JavaScript stricte (ex. papillesetpupilles.fr) renvoient 403 et restent non extractibles — copier-coller manuel pour ceux-là.
  - **Comment fonctionne l'extraction (pour mémoire)** : le comportement de l'IA est défini par la constante `SYSTEM_PROMPT` dans `functions/index.js` (rôle, format JSON attendu : name/servings/ingredients/steps/imageUrl, traduction FR, normalisation quantité+unité+nom, sous-titres de groupe « … : », conversions d'unités). Trajet : navigateur → Cloud Function (télécharge la page via `fetchPage`, nettoie le HTML via `htmlToText`) → API Mistral (SYSTEM_PROMPT + texte) → Cloud Function (vérifie la réponse) → pré-remplissage du formulaire. **Le prompt vit dans le code versionné, PAS dans un réglage en ligne** : toute modification du prompt exige un commit + redéploiement de la Cloud Function (ZIP du repo → `firebase deploy --only functions`), contrairement au reste du site qui se redéploie seul via GitHub Pages.
- **Mode "En cuisine"** : vue dédiée pour suivre une recette pendant la préparation, les mains dans la farine. Trois fonctions :
  - **Écran toujours allumé** : utiliser l'API Wake Lock (`navigator.wakeLock`) pour empêcher la mise en veille de l'appareil pendant la préparation — à activer au lancement du mode et libérer en sortant (avec repli si le navigateur ne supporte pas l'API).
  - **Cocher les étapes** de la section Recette une par une au fur et à mesure de l'avancement (affichage visuel clair de ce qui est fait / à faire).
  - **Rayer les ingrédients** utilisés au fur et à mesure (style barré, cliquer pour basculer rayé/normal — sur les vrais ingrédients uniquement, pas les sous-titres).
  - Les coches/rayures sont temporaires (propres à la session de cuisson, pas sauvegardées dans la recette). Entrée : depuis la vue de lecture d'une recette. À réfléchir : gros caractères, écran reste scrollable d'une main, bouton de sortie toujours visible.
- **Liste de courses** : pouvoir ajouter et gérer une liste de courses dans l'app. **La liste doit être éditable librement au-delà des ingrédients de recettes** (articles non-culinaires : papier toilette, piles, etc.) — les ingrédients de recettes seraient un bouton d'ajout rapide, pas la seule source. À discuter au moment du chantier : liste intégrée comme outil unique vs bouton "copier la liste" (presse-papiers, collage manuel dans Google Keep — Keep n'a pas d'API publique, l'utilisateur veut garder la possibilité d'éditer ses courses dans Keep).
- **Gestion des stocks** : piste à explorer — gestion des stocks d'ingrédients (peut-être liée à la liste de courses).
- **Comptes multi-utilisateurs** : upgrade pour que plusieurs personnes puissent se connecter, chacune avec son propre compte, son propre menu et ses propres recettes (actuellement : connexion anonyme unique Firestore).
- ~~**Bouton de lien orphelin** : faire disparaître le bouton 🔗 d'une case de repas quand le texte est effacé à la main.~~ **FAIT (v36.000)** : le lien est supprimé si le texte est vide ou ne contient plus le nom de la recette.
- ~~**Bug sélection + mobile avec recherche** : sur téléphone, en mode « Ajouter pour le » (bouton +), utiliser la barre de recherche rend l'ajout impossible.~~ **FAIT (v38.001)**
- **Règle export/import complet** : l'export/import concerne UNIQUEMENT les recettes (pas le menu/planning). Toute donnée d'une recette doit être incluse dans l'export texte et restaurée à l'import : nom, lien, image, notes, tags, catégorie. Quand on travaillera la fonctionnalité autour des tags (filtrage/tri), vérifier que les tags restent bien inclus dans l'export ET l'import, et tester la boucle export → import → ré-import.
- ~~**PWA étape 2** : persistance hors ligne des données (recettes, menu) + stratégie de synchronisation au retour du réseau.~~ **FAIT (v34.001 / v34.002)**
- **Règle de conflit de synchronisation** : quand des modifications locales sont en attente (`menuPendingSync`), elles écrasent le cloud au retour du réseau (« le local modifié gagne »). À reconsidérer lors des comptes multi-utilisateurs.
