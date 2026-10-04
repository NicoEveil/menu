# Règles du projet

## Versions stables

Quand l'utilisateur demande d'enregistrer une version stable :

1. Modifier UNIQUEMENT le numéro de version : passer au numéro rond suivant (ex. `v23.000` → `v24.000`), c'est-à-dire :
   - le badge dans le `<h1>` de `index.html` (`<span class="version">vN.000</span>`) ;
   - les paramètres de cache-busting `?v=N.000` sur `style.css` et `script.js`.
2. Committer avec le message `vN.000: stable version (<résumé>)`.
3. Tagger ce commit `stable-vN` (séquence `stable-v1`, `stable-v2`, …) et pousser le tag.
4. Ne rien changer d'autre au code lors de ce commit.

Les correctifs entre versions stables incrémentent le patch (`v24.001`, `v24.002`, …) et mettent à jour le cache-busting en conséquence.

## Règles permanentes

- Quand l'utilisateur donne une règle (de codage, de nommage, de façon de travailler), lui rappeler de demander son enregistrement dans ce fichier (`AGENTS.md`) si ce n'est pas déjà fait. Une règle non écrite ici est perdue entre les sessions.

## Règles métier

- Drag-and-drop désactivé sur mobile (fenêtre ≤ 768px), actif sur ordinateur et tablette.
- Les jours révolus de plus de 4 semaines (28 jours) sont purgés automatiquement au chargement (clés de date dans `menu` et `manualEntries`). L'utilisateur n'a pas besoin de conserver l'historique des jours passés.
