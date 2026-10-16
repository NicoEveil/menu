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
- **Intégration complète des recettes dans l'app** (prochaine fonctionnalité prévue, à faire avec la gestion des ingrédients) : réduire la dépendance aux liens externes — stocker dans l'app tout ce qui constitue la recette : ingrédients structurés, étapes/préparation, image hébergée, notes. Objectif : consulter et cuisiner depuis Ma Cuisine sans retourner sur le site source. Comprend la capture du contenu au moment de l'ajout (extraction schema.org/Recipe, Microlink pour l'image), un éditeur de recette enrichi, l'inclusion de tous les nouveaux champs dans l'export/import et la sync cloud.
- **Gestion des ingrédients et quantités dans les recettes** : ajouter une liste d'ingrédients structurée (quantité, unité, nom) au modèle de recette, avec saisie manuelle dans le formulaire, extraction automatique depuis le lien (schema.org/Recipe) quand possible, et éventuellement extraction par IA pour le texte libre. Prérequis naturel de la liste de courses. Penser à inclure les ingrédients dans l'export/import (cf. règle export/import complet) et dans la sync cloud.
- **Extraction IA des recettes (via Cloud Function + API Mistral)** : fonctionnalité validée par l'utilisateur, à implémenter pour tester. Architecture : bouton "Extraire depuis l'URL" dans le formulaire d'ajout → Cloud Function Firebase (télécharge la page, envoie à l'API Mistral avec un prompt d'extraction/normalisation/traduction FR, clé API stockée côté Firebase) → pré-remplissage du formulaire (jamais d'écriture directe : l'utilisateur relit et modifie avant d'enregistrer). Coût estimé : ~0,01 €/mois à 10 recettes/mois (pay-as-you-go, zéro abonnement, rien si aucune extraction). Prérequis côté utilisateur : compte API Mistral (platform.mistral.ai) + passage Firebase au forfait Blaze (carte en garantie, quota gratuit suffisant). **IMPORTANT : chaque étape de mise en place demande la validation explicite de l'utilisateur avant d'être faite — il veut mesurer concrètement le gain avant de généraliser.**
- **Liste de courses** : pouvoir ajouter et gérer une liste de courses dans l'app.
- **Gestion des stocks** : piste à explorer — gestion des stocks d'ingrédients (peut-être liée à la liste de courses).
- **Comptes multi-utilisateurs** : upgrade pour que plusieurs personnes puissent se connecter, chacune avec son propre compte, son propre menu et ses propres recettes (actuellement : connexion anonyme unique Firestore).
- ~~**Bouton de lien orphelin** : faire disparaître le bouton 🔗 d'une case de repas quand le texte est effacé à la main.~~ **FAIT (v36.000)** : le lien est supprimé si le texte est vide ou ne contient plus le nom de la recette.
- ~~**Bug sélection + mobile avec recherche** : sur téléphone, en mode « Ajouter pour le » (bouton +), utiliser la barre de recherche rend l'ajout impossible.~~ **FAIT (v38.001)**
- **Règle export/import complet** : l'export/import concerne UNIQUEMENT les recettes (pas le menu/planning). Toute donnée d'une recette doit être incluse dans l'export texte et restaurée à l'import : nom, lien, image, notes, tags, catégorie. Quand on travaillera la fonctionnalité autour des tags (filtrage/tri), vérifier que les tags restent bien inclus dans l'export ET l'import, et tester la boucle export → import → ré-import.
- ~~**PWA étape 2** : persistance hors ligne des données (recettes, menu) + stratégie de synchronisation au retour du réseau.~~ **FAIT (v34.001 / v34.002)**
- **Règle de conflit de synchronisation** : quand des modifications locales sont en attente (`menuPendingSync`), elles écrasent le cloud au retour du réseau (« le local modifié gagne »). À reconsidérer lors des comptes multi-utilisateurs.
