// Données des recettes et du menu
let recipes = [];
let menu = {};
let manualEntries = {};
let draggedRecipe = null;
let draggedMeal = null;

// Firebase
let db = null;
let cloudReady = false;
let lastExportMonth = null;
let pendingOfflineChange = false;
let isSaving = false;

function setSyncStatus(text, title) {
    const el = document.getElementById('sync-status');
    if (el) {
        el.textContent = text;
        if (title) el.title = title;
    }
}

// Jours de la semaine
const DAYS_OF_WEEK = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

// Initialisation
async function init() {
    await loadData();
    setupEventListeners();
    renderRecipes();
    renderDays();
}

// Chargement des données : cloud (Firestore) + migration localStorage
async function loadData() {
    // 1. Charger d'abord le localStorage (affichage instantané)
    const savedRecipes = localStorage.getItem('menuRecipes');
    const savedMenu = localStorage.getItem('menuPlanning');
    const savedManualEntries = localStorage.getItem('menuManualEntries');
    
    if (savedRecipes) {
        recipes = JSON.parse(savedRecipes);
    }
    
    if (savedMenu) {
        menu = JSON.parse(savedMenu);
    }
    
    if (savedManualEntries) {
        manualEntries = JSON.parse(savedManualEntries);
    }
    
    // 2. Initialiser Firebase et charger les données du cloud
    try {
        const { initializeApp } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js');
        const { getFirestore, doc, getDoc, setDoc, onSnapshot } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js');
        const { getAuth, signInAnonymously, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js');
        
        const firebaseConfig = {
            apiKey: "AIzaSyAjPFcp1Zi1kXLmpxgTjjb5VxfANblpE5U",
            authDomain: "ma-cuisine-37ba4.firebaseapp.com",
            projectId: "ma-cuisine-37ba4",
            storageBucket: "ma-cuisine-37ba4.firebasestorage.app",
            messagingSenderId: "1018432867713",
            appId: "1:1018432867713:web:5e841368e50994fa72ac80"
        };
        
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        
        const auth = getAuth(app);
        await signInAnonymously(auth);
        await new Promise((resolve) => {
            if (auth.currentUser) { resolve(); return; }
            onAuthStateChanged(auth, (user) => { if (user) resolve(); });
        });
        
        const docRef = doc(db, 'spaces', 'default');
        setSyncStatus('⏳ connexion...');
        const docSnap = await getDoc(docRef);
        
        const pendingFlag = localStorage.getItem('menuPendingSync') === 'true';
        
        if (docSnap.exists() && !pendingFlag) {
            // Le cloud a des données : elles font foi
            const data = docSnap.data();
            if (data.recipes) recipes = data.recipes;
            if (data.menu) menu = data.menu;
            if (data.manualEntries) manualEntries = data.manualEntries;
            if (data.lastExportMonth) lastExportMonth = data.lastExportMonth;
        } else if (docSnap.exists() && pendingFlag) {
            // Des modifications hors ligne sont en attente : elles écrasent le cloud
            localStorage.setItem('menuRecipes', JSON.stringify(recipes));
            localStorage.setItem('menuPlanning', JSON.stringify(menu));
            localStorage.setItem('menuManualEntries', JSON.stringify(manualEntries));
            await setDoc(docRef, {
                recipes: recipes,
                menu: menu,
                manualEntries: manualEntries,
                lastExportMonth: lastExportMonth
            });
            localStorage.setItem('menuPendingSync', 'false');
        } else if (savedRecipes || savedMenu || savedManualEntries) {
            // Première fois : migrer les données locales vers le cloud
            await setDoc(docRef, {
                recipes: recipes,
                menu: menu,
                manualEntries: manualEntries
            });
        }
        
        cloudReady = true;
        
        if (navigator.onLine) {
            retryMissingImages();
        }
        
        if (localStorage.getItem('menuPendingSync') === 'true') {
            // Des modifications hors ligne étaient en attente : les renvoyer maintenant
            await saveData();
        } else {
            setSyncStatus('☁️ synchronisé', 'Données synchronisées via Firebase');
        }
        
        // Synchronisation temps réel : mettre à jour si le cloud change
        onSnapshot(docRef, (snap) => {
            if (snap.exists() && !isSaving) {
                const data = snap.data();
                const currentData = JSON.stringify({ recipes, menu, manualEntries });
                const cloudData = JSON.stringify({ recipes: data.recipes || [], menu: data.menu || {}, manualEntries: data.manualEntries || {} });
                if (currentData !== cloudData) {
                        if (data.recipes) recipes = data.recipes;
                    if (data.menu) menu = data.menu;
                    if (data.manualEntries) manualEntries = data.manualEntries;
                    if (data.lastExportMonth) lastExportMonth = data.lastExportMonth;
                    renderRecipes();
                    renderDays();
                }
            }
        });
        
        // Nettoyer le localStorage après migration réussie
        if (savedRecipes || savedMenu || savedManualEntries) {
            localStorage.removeItem('menuRecipes');
            localStorage.removeItem('menuPlanning');
            localStorage.removeItem('menuManualEntries');
        }
        
        renderRecipes();
        renderDays();
        checkMonthlyExport();
    } catch (error) {
        console.warn('Cloud indisponible, utilisation du mode local :', error);
        setSyncStatus('⚠️ hors ligne', 'Erreur cloud : ' + (error && error.message ? error.message : error));
        alert('Synchronisation cloud impossible.\n\nErreur : ' + (error && error.message ? error.message : error) + '\n\nL\u2019application fonctionne en mode local (données non synchronisées entre appareils).');
    }
    
    // Initialiser les structures si vide
    const today = new Date();
    const daysToShow = getDaysToShow(today);
    
    daysToShow.forEach(dayInfo => {
        if (!menu[dayInfo.dateKey]) {
            menu[dayInfo.dateKey] = { dejeuner: null, diner: null };
        }
        if (!manualEntries[dayInfo.dateKey]) {
            manualEntries[dayInfo.dateKey] = { dejeuner: '', diner: '', autre: '' };
        }
    });
}

// Obtenir les 8 jours à afficher (aujourd'hui + 7 suivants)
function getDaysToShow(today) {
    const days = [];
    
    for (let i = 0; i < 8; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        const dateKey = date.toISOString().split('T')[0];
        days.push({
            dateKey: dateKey,
            dayName: DAYS_OF_WEEK[date.getDay()]
        });
    }
    
    return days;
}

// Obtenir le nom du jour avec date
function getDayLabel(date) {
    const options = { weekday: 'long', day: 'numeric', month: 'short' };
    return date.toLocaleDateString('fr-FR', options);
}

// Exporter les recettes en fichier texte
function exportRecipesToFile() {
    const lines = [];
    lines.push('Mes recettes - Ma Cuisine');
    lines.push('Export du ' + new Date().toLocaleDateString('fr-FR'));
    lines.push('');
    
    const sorted = [...recipes].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    sorted.forEach(recipe => {
        lines.push('=== ' + recipe.name + ' ===');
        if (recipe.url) {
            lines.push('Lien: ' + recipe.url);
        }
        if (recipe.text) {
            lines.push('Notes: ' + recipe.text);
        }
        lines.push('');
    });
    
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mes-recettes-' + new Date().toISOString().split('T')[0] + '.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    lastExportMonth = new Date().toISOString().slice(0, 7);
    saveData();
}

// Proposer l'export automatique une fois par mois
function checkMonthlyExport() {
    const currentMonth = new Date().toISOString().slice(0, 7);
    if (lastExportMonth !== currentMonth && recipes.length > 0) {
        if (confirm("C'est le moment de faire votre sauvegarde mensuelle !\n\nVoulez-vous télécharger vos recettes en fichier texte ?")) {
            exportRecipesToFile();
        } else {
            lastExportMonth = currentMonth;
            saveData();
        }
    }
}

// Sauvegarde des données dans localStorage
async function saveData() {
    // Toujours garder une copie locale (cache + file d'attente hors ligne)
    localStorage.setItem('menuRecipes', JSON.stringify(recipes));
    localStorage.setItem('menuPlanning', JSON.stringify(menu));
    localStorage.setItem('menuManualEntries', JSON.stringify(manualEntries));
    
    if (cloudReady && db) {
        try {
            const { doc, setDoc } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js');
            isSaving = true;
            await setDoc(doc(db, 'spaces', 'default'), {
                recipes: recipes,
                menu: menu,
                manualEntries: manualEntries,
                lastExportMonth: lastExportMonth
            });
            isSaving = false;
            localStorage.setItem('menuPendingSync', 'false');
            pendingOfflineChange = false;
            setSyncStatus('☁️ synchronisé', 'Données synchronisées via Firebase');
        } catch (error) {
            // Cloud inaccessible : garder la modification en attente
            pendingOfflineChange = true;
            localStorage.setItem('menuPendingSync', 'true');
            setSyncStatus('📴 en attente', 'Hors connexion : modification enregistrée localement, envoi au retour du réseau');
        }
    } else {
        pendingOfflineChange = true;
        localStorage.setItem('menuPendingSync', 'true');
        setSyncStatus('📴 en attente', 'Hors connexion : modification enregistrée localement, envoi au retour du réseau');
    }
}

// Configuration des écouteurs d'événements
function setupEventListeners() {
    // Navigation par onglets sur mobile
    document.querySelectorAll('.mobile-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.mobile-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            const menuSection = document.getElementById('menu-section');
            const recipesSection = document.getElementById('recipes-section');
            
            if (tab.dataset.tab === 'menu') {
                menuSection.classList.remove('hidden-tab');
                recipesSection.classList.add('hidden-tab');
            } else {
                recipesSection.classList.remove('hidden-tab');
                menuSection.classList.add('hidden-tab');
            }
        });
    });
    
    // Retour du réseau : renvoyer les modifications en attente
    window.addEventListener('online', () => {
        if (cloudReady && db) {
            if (pendingOfflineChange) {
                saveData();
            }
            retryMissingImages();
        }
    });
    
    // Bouton ajouter une recette
    const addRecipeBtn = document.getElementById('add-recipe-btn');
    if (addRecipeBtn) {
        addRecipeBtn.addEventListener('click', () => {
            showRecipeModal(null);
        });
    }
    
    const exportRecipesBtn = document.getElementById('export-recipes-btn');
    if (exportRecipesBtn) {
        exportRecipesBtn.addEventListener('click', exportRecipesToFile);
    }

    // Recherche et filtre des recettes
    const recipeSearch = document.getElementById('recipe-search');
    if (recipeSearch) {
        recipeSearch.addEventListener('input', renderRecipes);
    }

    // Modal
    document.querySelectorAll('.btn-close').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.modal');
            closeModal(modal);
        });
    });

    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal(modal);
            }
        });
    });

    // Formulaire recette
    const recipeForm = document.getElementById('recipe-form');
    if (recipeForm) {
        recipeForm.addEventListener('submit', handleRecipeForm);
    }
    
    
    const cancelBtn = document.getElementById('cancel-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            closeModal(document.getElementById('recipe-modal'));
        });
    }

    // Bouton fermer la vue recette
    const closeViewBtn = document.querySelector('.btn-close-view');
    if (closeViewBtn) {
        closeViewBtn.addEventListener('click', () => {
            closeModal(document.getElementById('view-recipe-modal'));
        });
    }
    
    // Bouton Modifier : passer du popup de lecture au popup de modification
    const editFromViewBtn = document.getElementById('edit-from-view-btn');
    if (editFromViewBtn) {
        editFromViewBtn.addEventListener('click', () => {
            const recipeId = window.currentViewedRecipeId;
            closeModal(document.getElementById('view-recipe-modal'));
            if (recipeId) {
                showRecipeModal(recipeId);
            }
        });
    }
}

// Permettre le drop
function allowDrop(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    
    // Ajouter la classe drag-over à l'élément cible
    const target = ev.target.closest('.meal-box, .day-card, .recipes-grid');
    if (target) {
        target.classList.add('drag-over');
    }
}

// Quitter la zone de drop
function dragLeave(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    
    // Retirer la classe drag-over
    document.querySelectorAll('.meal-box, .day-card, .recipes-grid').forEach(el => {
        el.classList.remove('drag-over');
    });
}

// Gérer le drop d'une recette sur un repas
function dropRecipe(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    
    // Retirer toutes les classes drag-over
    document.querySelectorAll('.meal-box, .day-card, .recipes-grid').forEach(el => {
        el.classList.remove('drag-over');
    });
    
    // Récupérer les données du drag
    const recipeId = ev.dataTransfer.getData('text/plain');
    
    if (!recipeId) return;
    
    const recipe = recipes.find(r => r.id === recipeId);
    if (!recipe) return;
    
    // Trouver la cible (meal-box ou day-card)
    let target = ev.target.closest('.meal-box');
    
    if (target) {
        const day = target.dataset.day;
        const meal = target.dataset.meal;
        
        // Assigner la recette à ce repas
        manualEntries[day][meal] = recipe.name;
        menu[day][meal] = recipeId;
        
        saveData();
        renderDays();
        renderRecipes();
    }
    
    // Réinitialiser
    draggedRecipe = null;
    hideDragIndicator();
}

// Gérer le drop d'un repas sur un autre repas (réorganisation)
function dropMeal(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    
    // Retirer toutes les classes drag-over
    document.querySelectorAll('.meal-box, .day-card').forEach(el => {
        el.classList.remove('drag-over');
    });
    
    // Récupérer les données du drag
    const data = ev.dataTransfer.getData('text/plain');
    const [sourceDay, sourceMeal] = data.split('|');
    
    if (!sourceDay || !sourceMeal) return;
    
    // Trouver la cible
    const target = ev.target.closest('.meal-box');
    
    if (target) {
        const targetDay = target.dataset.day;
        const targetMeal = target.dataset.meal;
        
        // Écraser la cible avec le repas source (pas d'échange)
        manualEntries[targetDay][targetMeal] = manualEntries[sourceDay][sourceMeal];
        menu[targetDay][targetMeal] = menu[sourceDay][sourceMeal];
        
        // Vider la source
        manualEntries[sourceDay][sourceMeal] = '';
        menu[sourceDay][sourceMeal] = null;
        
        saveData();
        renderDays();
    }
    
    // Réinitialiser
    draggedMeal = null;
    hideDragIndicator();
}

// Afficher l'indicateur de drag
function showDragIndicator() {
    const indicator = document.getElementById('drag-indicator');
    if (indicator) {
        indicator.classList.add('active');
    }
}

// Cacher l'indicateur de drag
function hideDragIndicator() {
    const indicator = document.getElementById('drag-indicator');
    if (indicator) {
        indicator.classList.remove('active');
    }
}

// Commencer le drag d'une recette
function startRecipeDrag(ev, recipeId) {
    draggedRecipe = recipeId;
    ev.dataTransfer.setData('text/plain', recipeId);
    ev.dataTransfer.effectAllowed = 'copy';
    
    // Ajouter la classe dragging
    ev.target.classList.add('dragging');
    
    // Afficher l'indicateur après un délai
    setTimeout(showDragIndicator, 300);
}

// Fin du drag d'une recette
function endRecipeDrag(ev) {
    ev.target.classList.remove('dragging');
    draggedRecipe = null;
    hideDragIndicator();
}

// Commencer le drag d'un repas
function startMealDrag(ev, day, meal) {
    draggedMeal = { day, meal };
    ev.dataTransfer.setData('text/plain', `${day}|${meal}`);
    ev.dataTransfer.effectAllowed = 'move';
    
    // Ajouter la classe dragging
    ev.target.classList.add('dragging');
    
    // Afficher l'indicateur
    setTimeout(showDragIndicator, 300);
}

// Fin du drag d'un repas
function endMealDrag(ev) {
    ev.target.classList.remove('dragging');
    draggedMeal = null;
    hideDragIndicator();
}

// Afficher la modal de sélection de recette pour un jour/repas
function showRecipeSelectionForMeal(day, meal) {
    window.currentSelectingDay = day;
    window.currentSelectingMeal = meal;
    
    renderRecipes(true, day, meal);
    
    document.querySelector('.recipes-section').scrollIntoView({ behavior: 'smooth' });
}

// Sélectionner une recette pour un jour/repas
function selectRecipeForMenu(recipeId, day, meal) {
    const recipe = recipes.find(r => r.id === recipeId);
    if (recipe) {
        manualEntries[day][meal] = recipe.name;
        menu[day][meal] = recipeId;
    }
    saveData();
    renderDays();
    renderRecipes();
}

// Afficher la modal d'ajout/modification de recette
function showRecipeModal(recipeId) {
    const modal = document.getElementById('recipe-modal');
    const form = document.getElementById('recipe-form');
    
    if (recipeId !== null) {
        const recipe = recipes.find(r => r.id === recipeId);
        document.getElementById('modal-title').textContent = 'Modifier la recette';
        document.getElementById('recipe-name').value = recipe.name;
        document.getElementById('recipe-url').value = recipe.url || '';
        document.getElementById('recipe-text').value = recipe.text || '';
        document.getElementById('recipe-image-url').value = recipe.imageUrl || '';
        document.getElementById('recipe-category').value = recipe.category || '';
        document.getElementById('recipe-tags').value = recipe.tags ? recipe.tags.join(', ') : '';
        
        form.dataset.editingId = recipeId;
    } else {
        document.getElementById('modal-title').textContent = 'Ajouter une recette';
        form.reset();
        form.dataset.editingId = '';
    }
    
    modal.classList.add('active');
    modal.querySelector('.modal-content').scrollTop = 0;
}

// Fermer une modal
function closeModal(modal) {
    modal.classList.remove('active');
    
    const form = document.getElementById('recipe-form');
    if (form) {
        form.reset();
        form.dataset.editingId = '';
    }
    
    delete window.currentSelectingDay;
    delete window.currentSelectingMeal;
    
    document.querySelectorAll('.recipe-card').forEach(card => {
        card.classList.remove('selected');
    });
}


// Gérer la soumission du formulaire de recette
function handleRecipeForm(e) {
    e.preventDefault();
    
    const form = e.target;
    const recipeId = form.dataset.editingId;
    const name = document.getElementById('recipe-name').value.trim();
    const url = document.getElementById('recipe-url').value.trim();
    const text = document.getElementById('recipe-text').value.trim();
    const manualImage = document.getElementById('recipe-image-url').value.trim();
    const category = document.getElementById('recipe-category').value.trim();
    const tagsInput = document.getElementById('recipe-tags').value.trim();
    
    if (!name) {
        alert('Le nom de la recette est obligatoire');
        return;
    }
    

    const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(t => t) : [];
    
    const finalId = recipeId || Date.now().toString();
    
    const existingRecipe = recipes.find(r => r.id === finalId);
    
    const recipeData = {
        id: finalId,
        name,
        url: url || null,
        text: text || null,
        imageUrl: manualImage || (existingRecipe ? existingRecipe.imageUrl : null),
        category: category || null,
        tags,
        createdAt: recipeId ? recipes.find(r => r.id === recipeId).createdAt : new Date().toISOString()
    };
    
    if (recipeId) {
        const index = recipes.findIndex(r => r.id === recipeId);
        recipes[index] = recipeData;
    } else {
        recipes.push(recipeData);
    }
    
    saveData();
    closeModal(document.getElementById('recipe-modal'));
    renderRecipes();
    
    // Récupérer l'image APRÈS enregistrement (évite que le formulaire écrase l'image)
    if (url && !manualImage) {
        fetchRecipeImage(url, finalId);
    }
}

// Récupérer l'image d'une recette de type lien via l'API Microlink
async function fetchRecipeImage(url, recipeId) {
    // Liens YouTube : utiliser la miniature officielle de la vidéo (fiable, sans quota)
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
    if (ytMatch) {
        const imageUrl = 'https://img.youtube.com/vi/' + ytMatch[1] + '/hqdefault.jpg';
        const index = recipes.findIndex(r => r.id === recipeId || (r.url === url));
        if (index !== -1 && !recipes[index].imageUrl) {
            recipes[index] = { ...recipes[index], imageUrl: imageUrl };
            await saveData();
            renderRecipes();
            return true;
        }
    }
    
    try {
        const response = await fetch('https://api.microlink.io/?url=' + encodeURIComponent(url));
        const json = await response.json();
        if (json.status === 'success' && json.data && json.data.image && json.data.image.url) {
            const imageUrl = json.data.image.url;
            const index = recipes.findIndex(r => r.id === recipeId || (r.url === url));
            if (index !== -1 && !recipes[index].imageUrl) {
                recipes[index] = { ...recipes[index], imageUrl: imageUrl };
                await saveData();
                renderRecipes();
                return true;
            }
        }
    } catch (error) {
        console.warn('Impossible de récupérer l\u2019image de la recette :', error);
    }
    return false;
}

// Rattraper les images manquantes (créées hors ligne par exemple) une fois en ligne
async function retryMissingImages() {
    // Limiter le rattrapage à une fois par jour, max 10 tentatives (quota gratuit Microlink)
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem('menuLastImageRetry2') === today) {
        return;
    }
    localStorage.setItem('menuLastImageRetry2', today);
    
    const missing = recipes.filter(r => r.url && !r.imageUrl);
    let attempts = 0;
    for (const recipe of missing) {
        if (attempts >= 10) break;
        attempts++;
        // En cas d'échec (site bloquant), continuer avec les autres recettes
        await fetchRecipeImage(recipe.url, recipe.id);
    }
}

// Afficher une recette dans la modal de visualisation
function showRecipeDetails(recipeId) {
    window.currentViewedRecipeId = recipeId;
    const recipe = recipes.find(r => r.id === recipeId);
    const modal = document.getElementById('view-recipe-modal');
    
    document.getElementById('view-recipe-title').textContent = recipe.name;
    
    const imageEl = document.getElementById('view-recipe-image');
    if (recipe.imageUrl) {
        imageEl.onerror = function() {
            this.onerror = null;
            this.src = 'https://images.weserv.nl/?url=' + encodeURIComponent(recipe.imageUrl);
        };
        imageEl.src = recipe.imageUrl;
        imageEl.style.display = 'block';
    } else {
        imageEl.src = '';
        imageEl.style.display = 'none';
    }
    
    const categoryEl = document.getElementById('view-recipe-category');
    categoryEl.textContent = recipe.category ? `Catégorie: ${recipe.category}` : '';
    categoryEl.style.display = recipe.category ? 'block' : 'none';
    
    const tagsEl = document.getElementById('view-recipe-tags');
    if (recipe.tags && recipe.tags.length > 0) {
        tagsEl.innerHTML = `<strong>Tags:</strong> ${recipe.tags.map(tag => `<span class="tag">${tag}</span>`).join(' ')}`;
        tagsEl.style.display = 'block';
    } else {
        tagsEl.style.display = 'none';
    }
    
    const urlEl = document.getElementById('view-recipe-url');
    const textEl = document.getElementById('view-recipe-text');
    
    if (recipe.url) {
        urlEl.innerHTML = `<strong>Lien:</strong> <a href="${recipe.url}" target="_blank">${recipe.url}</a>`;
        urlEl.style.display = 'block';
    } else {
        urlEl.style.display = 'none';
    }
    
    if (recipe.text) {
        textEl.innerHTML = `<strong>Notes:</strong><pre>${recipe.text}</pre>`;
        textEl.style.display = 'block';
    } else {
        textEl.style.display = 'none';
    }
    
    modal.classList.add('active');
}

// Supprimer une recette
function deleteRecipe(recipeId) {
    if (confirm('Êtes-vous sûr de vouloir supprimer cette recette ?')) {
        for (const day in menu) {
            for (const meal in menu[day]) {
                if (menu[day][meal] === recipeId) {
                    menu[day][meal] = null;
                    manualEntries[day][meal] = '';
                }
            }
        }
        
        recipes = recipes.filter(r => r.id !== recipeId);
        saveData();
        renderRecipes();
        renderDays();
    }
}

// Rendre la liste des recettes
function renderRecipes(forSelection = false, dayParam = null, mealParam = null) {
    const listEl = document.getElementById('recipes-list');
    const searchTerm = document.getElementById('recipe-search')?.value.toLowerCase() || '';
    const filterType = 'all';
    
    let filteredRecipes = recipes.filter(recipe => {
        const matchesSearch = recipe.name.toLowerCase().includes(searchTerm) ||
                           (recipe.tags && recipe.tags.some(tag => tag.toLowerCase().includes(searchTerm))) ||
                           (recipe.category && recipe.category.toLowerCase().includes(searchTerm)) ||
                           (recipe.text && recipe.text.toLowerCase().includes(searchTerm));
        
        const matchesFilter = filterType === 'all'
            || (filterType === 'lien' && !!recipe.url)
            || (filterType === 'texte' && !!recipe.text);
        
        return matchesSearch && matchesFilter;
    });
    
    filteredRecipes.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    
    listEl.innerHTML = '';
    
    if (filteredRecipes.length === 0) {
        listEl.innerHTML = '<div class="no-recipes">Aucune recette trouvée. Ajoutez-en une !</div>';
        return;
    }
    
    let isSelecting = forSelection && dayParam && mealParam;
    let currentSelectingDay = dayParam;
    let currentSelectingMeal = mealParam;
    
    filteredRecipes.forEach(recipe => {
        const card = document.createElement('div');
        card.className = 'recipe-card draggable';
        card.dataset.recipeId = recipe.id;
        card.draggable = true;
        
        if (isSelecting && currentSelectingDay && currentSelectingMeal) {
            if (menu[currentSelectingDay][currentSelectingMeal] === recipe.id) {
                card.classList.add('selected');
            }
        }
        
        card.innerHTML = `
                        ${recipe.imageUrl ? `<div class="recipe-image"><img src="${recipe.imageUrl}" alt="${recipe.name}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://images.weserv.nl/?url=' + encodeURIComponent('${recipe.imageUrl.replace(/'/g, "\\'")}')"></div>` : ''}
<div class="recipe-title-row">
                <h3>${recipe.name}</h3>
                <button class="btn-icon delete-recipe" title="Supprimer">🗑️</button>
            </div>
            ${!recipe.imageUrl && recipe.text ? `<div class="recipe-notes-preview">${recipe.text}</div>` : ''}
            ${!recipe.imageUrl && !recipe.text && recipe.url ? `<a href="${recipe.url}" target="_blank" rel="noopener noreferrer" class="recipe-link-preview" title="${recipe.url}">${recipe.url}</a>` : ''}
            <div class="recipe-meta">
                ${recipe.category ? `<span>${recipe.category}</span>` : ''}
                ${recipe.tags && recipe.tags.length > 0 ? 
                    `<div class="recipe-tags">${recipe.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}</div>` : ''}
            </div>
        `;
        
        card.querySelector('.delete-recipe').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteRecipe(recipe.id);
        });
        
        // Événements drag & drop pour les recettes
        card.addEventListener('dragstart', (ev) => {
            startRecipeDrag(ev, recipe.id);
        });
        
        card.addEventListener('dragend', (ev) => {
            endRecipeDrag(ev);
        });
        
        // Événement pour la sélection
        card.addEventListener('click', () => {
            if (isSelecting) {
                document.querySelectorAll('.recipe-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                
                selectRecipeForMenu(recipe.id, currentSelectingDay, currentSelectingMeal);
                
                closeModal(document.getElementById('recipe-modal'));
            } else {
                showRecipeDetails(recipe.id);
            }
        });
        
        listEl.appendChild(card);
    });
    
    // Événements pour la zone de drop des recettes
    listEl.addEventListener('dragover', allowDrop);
    listEl.addEventListener('dragleave', dragLeave);
    listEl.addEventListener('drop', dropRecipe);
}

// Rendre les jours avec leurs repas
function renderDays() {
    const daysList = document.querySelector('.days-list');
    if (!daysList) return;
    
    const today = new Date();
    const daysToShow = getDaysToShow(today);
    
    daysList.innerHTML = '';
    
    daysToShow.forEach((dayInfo, index) => {
        const dayCard = document.createElement('div');
        dayCard.className = 'day-card';
        dayCard.dataset.day = dayInfo.dateKey;
        
        const dayLabel = dayInfo.dayName;
        const isToday = index === 0;
        
        if (isToday) {
            dayCard.classList.add('today');
        }
        
        dayCard.innerHTML = `
            <h3>${dayLabel}</h3>
            <div class="day-meals">
                <div class="meal-slot" data-meal="dejeuner">
                    <span class="meal-label">Déjeuner :</span>
                    <div class="meal-box ${isToday ? 'today' : ''} ${manualEntries[dayInfo.dateKey]?.dejeuner ? 'has-value' : ''}" 
                         data-day="${dayInfo.dateKey}" data-meal="dejeuner">
                        <span class="meal-box-text ${manualEntries[dayInfo.dateKey]?.dejeuner ? '' : 'empty'}">
                            ${manualEntries[dayInfo.dateKey]?.dejeuner || 'Vide'}
                        </span>
                        ${menu[dayInfo.dateKey]?.dejeuner ? `<button type="button" class="meal-box-link-btn" data-recipe-id="${menu[dayInfo.dateKey].dejeuner}" title="Voir la recette">&#128279;</button>` : ''}
                        <button type="button" class="meal-box-delete-btn" data-day="${dayInfo.dateKey}" data-meal="dejeuner">-</button>
                    </div>
                </div>
                <div class="meal-slot" data-meal="diner">
                    <span class="meal-label">Dîner :</span>
                    <div class="meal-box ${isToday ? 'today' : ''} ${manualEntries[dayInfo.dateKey]?.diner ? 'has-value' : ''}" 
                         data-day="${dayInfo.dateKey}" data-meal="diner">
                        <span class="meal-box-text ${manualEntries[dayInfo.dateKey]?.diner ? '' : 'empty'}">
                            ${manualEntries[dayInfo.dateKey]?.diner || 'Vide'}
                        </span>
                        ${menu[dayInfo.dateKey]?.diner ? `<button type="button" class="meal-box-link-btn" data-recipe-id="${menu[dayInfo.dateKey].diner}" title="Voir la recette">&#128279;</button>` : ''}
                        <button type="button" class="meal-box-delete-btn" data-day="${dayInfo.dateKey}" data-meal="diner">-</button>
                    </div>
                </div>
            </div>
        `;
        
        daysList.appendChild(dayCard);
    });
    
    attachDayEvents();
}

// Attacher les événements aux éléments des jours
function attachDayEvents() {
    // Boutons - pour vider une case de repas
    document.querySelectorAll('.meal-box-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const day = btn.dataset.day;
            const meal = btn.dataset.meal;
            manualEntries[day][meal] = '';
            menu[day][meal] = null;
            saveData();
            renderDays();
        });
    });
    
    // Boutons lien pour ouvrir la recette
    document.querySelectorAll('.meal-box-link-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            showRecipeDetails(btn.dataset.recipeId);
        });
    });
    
    // Cases de repas (clic pour éditer)
    document.querySelectorAll('.meal-box').forEach(box => {
        box.addEventListener('click', (e) => {
            if (e.target.classList.contains('meal-box-delete-btn')) return;
            if (e.target.classList.contains('meal-box-link-btn')) return;
            
            const day = box.dataset.day;
            const meal = box.dataset.meal;
            
            const currentText = manualEntries[day][meal] || '';
            const input = document.createElement('input');
            input.type = 'text';
            input.value = currentText;
            input.className = 'meal-edit-input';
            input.id = `edit-${day}-${meal}`;
            input.style.width = '100%';
            input.style.padding = '8px';
            input.style.border = '2px solid var(--primary-color)';
            input.style.borderRadius = '4px';
            
            const textSpan = box.querySelector('.meal-box-text');
            textSpan.textContent = '';
            textSpan.appendChild(input);
            input.focus();
            
            const saveEdit = () => {
                manualEntries[day][meal] = input.value;
                box.classList.toggle('has-value', !!input.value);
                saveData();
                renderDays();
            };
            
            input.addEventListener('blur', saveEdit);
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    saveEdit();
                }
            });
        });
        
        // Drag & Drop pour les repas
        box.draggable = true;
        box.addEventListener('dragstart', (ev) => startMealDrag(ev, box.dataset.day, box.dataset.meal));
        box.addEventListener('dragend', (ev) => endMealDrag(ev));
        box.addEventListener('dragover', allowDrop);
        box.addEventListener('dragleave', dragLeave);
        box.addEventListener('drop', dropMeal);
        
        // Drag & Drop pour les recettes
        box.addEventListener('drop', dropRecipe);
    });
}

// Initialisation au chargement de la page
document.addEventListener('DOMContentLoaded', init);
