// Données des recettes et du menu
let recipes = [];
let menu = {};
let manualEntries = {};
let currentWeekStart = new Date();

// Initialisation
function init() {
    loadData();
    setupEventListeners();
    renderRecipes();
    renderMenu();
    updateWeekDisplay();
}

// Chargement des données depuis localStorage
function loadData() {
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
    
    // Initialiser le menu si vide
    if (Object.keys(menu).length === 0) {
        const days = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
        days.forEach(day => {
            menu[day] = {
                déjeuner: null,
                diner: null
            };
        });
    }
    
    // Initialiser les entrées manuelles si vide
    if (Object.keys(manualEntries).length === 0) {
        const days = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
        days.forEach(day => {
            manualEntries[day] = {
                déjeuner: '',
                diner: '',
                autre: ''
            };
        });
    }
}

// Sauvegarde des données dans localStorage
function saveData() {
    localStorage.setItem('menuRecipes', JSON.stringify(recipes));
    localStorage.setItem('menuPlanning', JSON.stringify(menu));
    localStorage.setItem('menuManualEntries', JSON.stringify(manualEntries));
}

// Configuration des écouteurs d'événements
function setupEventListeners() {
    // Navigation par onglets
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Bouton ajouter une recette
    document.getElementById('add-recipe-btn').addEventListener('click', () => {
        showRecipeModal(null);
    });

    // Recherche et filtre des recettes
    document.getElementById('recipe-search').addEventListener('input', renderRecipes);
    document.getElementById('recipe-filter').addEventListener('change', renderRecipes);

    // Navigation semaine
    document.getElementById('prev-week').addEventListener('click', () => {
        currentWeekStart.setDate(currentWeekStart.getDate() - 7);
        updateWeekDisplay();
        renderMenu();
    });

    document.getElementById('next-week').addEventListener('click', () => {
        currentWeekStart.setDate(currentWeekStart.getDate() + 7);
        updateWeekDisplay();
        renderMenu();
    });

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
    document.getElementById('recipe-form').addEventListener('submit', handleRecipeForm);
    document.getElementById('recipe-type').addEventListener('change', toggleRecipeForm);
    document.getElementById('cancel-btn').addEventListener('click', () => {
        closeModal(document.getElementById('recipe-modal'));
    });

    // Bouton fermer la vue recette
    document.querySelector('.btn-close-view').addEventListener('click', () => {
        closeModal(document.getElementById('view-recipe-modal'));
    });

    // Gestion des clics sur les boutons + pour ajouter une recette
    document.querySelectorAll('.recipe-select-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const day = btn.dataset.day;
            const meal = btn.dataset.meal;
            showRecipeSelectionForMeal(day, meal);
        });
    });
    
    // Gestion des entrées manuelles
    document.querySelectorAll('.meal-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const day = input.dataset.day;
            const meal = input.dataset.meal;
            manualEntries[day][meal] = input.value;
            input.classList.toggle('has-value', !!input.value);
            saveData();
        });
        
        input.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    });
}

// Changer d'onglet
function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === tabId);
    });
}

// Afficher la modal de sélection de recette pour un jour/repas
function showRecipeSelectionForMeal(day, meal) {
    // Stocker les infos du jour/repas pour la sélection
    const selectingForDay = day;
    const selectingForMeal = meal;
    
    // Afficher toutes les recettes avec la possibilité de sélection
    renderRecipes(true, day, meal);
    
    // Passer à l'onglet recettes
    switchTab('recettes');
    
    // Scroll vers le haut
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Sélectionner une recette pour un jour/repas
function selectRecipeForMenu(recipeId, day, meal) {
    const recipe = recipes.find(r => r.id === recipeId);
    if (recipe) {
        // Remplir le champ manuel avec le nom de la recette
        manualEntries[day][meal] = recipe.name;
        menu[day][meal] = recipeId;
    }
    saveData();
    renderMenu();
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
        document.getElementById('recipe-type').value = recipe.type;
        document.getElementById('recipe-url').value = recipe.url || '';
        document.getElementById('recipe-text').value = recipe.text || '';
        document.getElementById('recipe-category').value = recipe.category || '';
        document.getElementById('recipe-tags').value = recipe.tags ? recipe.tags.join(', ') : '';
        
        form.dataset.editingId = recipeId;
    } else {
        document.getElementById('modal-title').textContent = 'Ajouter une recette';
        form.reset();
        form.dataset.editingId = '';
    }
    
    toggleRecipeForm();
    modal.classList.add('active');
}

// Fermer une modal
function closeModal(modal) {
    modal.classList.remove('active');
    
    // Réinitialiser le formulaire
    const form = document.getElementById('recipe-form');
    form.reset();
    form.dataset.editingId = '';
    
    // Réinitialiser la sélection pour le menu
    document.querySelectorAll('.recipe-select').forEach(select => {
        delete select.dataset.selectingForDay;
        delete select.dataset.selectingForMeal;
    });
    
    // Réinitialiser la sélection des recettes
    document.querySelectorAll('.recipe-card').forEach(card => {
        card.classList.remove('selected');
    });
}

// Basculer entre lien et texte dans le formulaire
function toggleRecipeForm() {
    const type = document.getElementById('recipe-type').value;
    const urlGroup = document.getElementById('url-group');
    const textGroup = document.getElementById('text-group');
    
    urlGroup.classList.toggle('hidden', type === 'texte');
    textGroup.classList.toggle('hidden', type === 'lien');
}

// Gérer la soumission du formulaire de recette
function handleRecipeForm(e) {
    e.preventDefault();
    
    const form = e.target;
    const recipeId = form.dataset.editingId;
    const name = document.getElementById('recipe-name').value.trim();
    const type = document.getElementById('recipe-type').value;
    const url = document.getElementById('recipe-url').value.trim();
    const text = document.getElementById('recipe-text').value.trim();
    const category = document.getElementById('recipe-category').value.trim();
    const tagsInput = document.getElementById('recipe-tags').value.trim();
    
    // Validation
    if (!name) {
        alert('Le nom de la recette est obligatoire');
        return;
    }
    
    if (type === 'lien' && !url) {
        alert('L\'URL est obligatoire pour une recette de type lien');
        return;
    }
    
    if (type === 'texte' && !text) {
        alert('Le texte de la recette est obligatoire');
        return;
    }
    
    const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(t => t) : [];
    
    const recipeData = {
        id: recipeId || Date.now().toString(),
        name,
        type,
        url: type === 'lien' ? url : null,
        text: type === 'texte' ? text : null,
        category: category || null,
        tags,
        createdAt: recipeId ? recipes.find(r => r.id === recipeId).createdAt : new Date().toISOString()
    };
    
    if (recipeId) {
        // Modifier la recette existante
        const index = recipes.findIndex(r => r.id === recipeId);
        recipes[index] = recipeData;
    } else {
        // Ajouter une nouvelle recette
        recipes.push(recipeData);
    }
    
    saveData();
    closeModal(document.getElementById('recipe-modal'));
    renderRecipes();
}

// Afficher une recette dans la modal de visualisation
function showRecipeDetails(recipeId) {
    const recipe = recipes.find(r => r.id === recipeId);
    const modal = document.getElementById('view-recipe-modal');
    
    document.getElementById('view-recipe-title').textContent = recipe.name;
    
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
    
    const typeEl = document.getElementById('view-recipe-type');
    typeEl.innerHTML = `<strong>Type:</strong> <span class="${recipe.type}">${recipe.type === 'lien' ? 'Lien' : 'Recette écrite'}</span>`;
    
    const urlEl = document.getElementById('view-recipe-url');
    const textEl = document.getElementById('view-recipe-text');
    
    if (recipe.type === 'lien') {
        urlEl.innerHTML = `<strong>URL:</strong> <a href="${recipe.url}" target="_blank">${recipe.url}</a>`;
        urlEl.style.display = 'block';
        textEl.style.display = 'none';
    } else {
        urlEl.style.display = 'none';
        textEl.innerHTML = `<strong>Recette:</strong><pre>${recipe.text}</pre>`;
        textEl.style.display = 'block';
    }
    
    modal.classList.add('active');
}

// Supprimer une recette
function deleteRecipe(recipeId) {
    if (confirm('Êtes-vous sûr de vouloir supprimer cette recette ?')) {
        // Retirer la recette du menu si elle y est
        for (const day in menu) {
            for (const meal in menu[day]) {
                if (menu[day][meal] === recipeId) {
                    menu[day][meal] = null;
                }
            }
        }
        
        recipes = recipes.filter(r => r.id !== recipeId);
        saveData();
        renderRecipes();
        renderMenu();
    }
}

// Rendre la liste des recettes
function renderRecipes(forSelection = false, dayParam = null, mealParam = null) {
    const listEl = document.getElementById('recipes-list');
    const searchTerm = document.getElementById('recipe-search').value.toLowerCase();
    const filterType = document.getElementById('recipe-filter').value;
    
    let filteredRecipes = recipes.filter(recipe => {
        const matchesSearch = recipe.name.toLowerCase().includes(searchTerm) ||
                           (recipe.tags && recipe.tags.some(tag => tag.toLowerCase().includes(searchTerm))) ||
                           (recipe.category && recipe.category.toLowerCase().includes(searchTerm)) ||
                           (recipe.text && recipe.text.toLowerCase().includes(searchTerm));
        
        const matchesFilter = filterType === 'all' || recipe.type === filterType;
        
        return matchesSearch && matchesFilter;
    });
    
    // Trier par nom
    filteredRecipes.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    
    listEl.innerHTML = '';
    
    if (filteredRecipes.length === 0) {
        listEl.innerHTML = '<div class="no-recipes">Aucune recette trouvée. Ajoutez-en une !</div>';
        return;
    }
    
    // Vérifier si on est en mode sélection pour le menu
    let isSelecting = false;
    let currentSelectingDay = null;
    let currentSelectingMeal = null;
    
    // Vérifier si on a des paramètres de sélection
    if (forSelection && dayParam && mealParam) {
        isSelecting = true;
        currentSelectingDay = dayParam;
        currentSelectingMeal = mealParam;
    }
    
    filteredRecipes.forEach(recipe => {
        const card = document.createElement('div');
        card.className = 'recipe-card';
        card.dataset.recipeId = recipe.id;
        
        // Vérifier si cette recette est sélectionnée pour le menu
        if (isSelecting && currentSelectingDay && currentSelectingMeal) {
            if (menu[currentSelectingDay][currentSelectingMeal] === recipe.id) {
                card.classList.add('selected');
            }
        }
        
        card.innerHTML = `
            <h3>${recipe.name}</h3>
            <div class="recipe-meta">
                ${recipe.category ? `<span>${recipe.category}</span>` : ''}
                ${recipe.tags && recipe.tags.length > 0 ? 
                    `<div class="recipe-tags">${recipe.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}</div>` : ''}
            </div>
            <div class="recipe-type ${recipe.type}">${recipe.type === 'lien' ? 'Lien' : 'Recette écrite'}</div>
            <div class="recipe-actions">
                <button class="btn-icon view-recipe" title="Voir">👁️</button>
                <button class="btn-icon edit-recipe" title="Modifier">✏️</button>
                <button class="btn-icon delete-recipe" title="Supprimer">🗑️</button>
            </div>
        `;
        
        // Événements pour les actions
        card.querySelector('.view-recipe').addEventListener('click', (e) => {
            e.stopPropagation();
            showRecipeDetails(recipe.id);
        });
        
        card.querySelector('.edit-recipe').addEventListener('click', (e) => {
            e.stopPropagation();
            showRecipeModal(recipe.id);
        });
        
        card.querySelector('.delete-recipe').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteRecipe(recipe.id);
        });
        
        // Événement pour la sélection
        card.addEventListener('click', () => {
            if (isSelecting) {
                // Retirer la sélection précédente
                document.querySelectorAll('.recipe-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                
                // Sélectionner cette recette
                selectRecipeForMenu(recipe.id, currentSelectingDay, currentSelectingMeal);
                
                // Fermer le mode sélection
                closeModal(document.getElementById('recipe-modal'));
                
                // Retourner à l'onglet menu
                switchTab('menu');
            } else {
                showRecipeDetails(recipe.id);
            }
        });
        
        listEl.appendChild(card);
    });
}

// Mettre à jour l'affichage de la semaine
function updateWeekDisplay() {
    // Trouver le lundi de la semaine
    const weekStart = new Date(currentWeekStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + (weekStart.getDay() === 0 ? -6 : 1));
    
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const formattedDate = weekStart.toLocaleDateString('fr-FR', options);
    
    document.getElementById('week-start').textContent = formattedDate;
    
    // Mettre à jour les dates dans les cartes des jours
    const days = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
    days.forEach((day, index) => {
        const dateEl = document.querySelector(`.day-card[data-day="${day}"] .day-date`);
        const dayDate = new Date(weekStart);
        dayDate.setDate(weekStart.getDate() + index);
        
        const dayOptions = { weekday: 'short', day: 'numeric', month: 'short' };
        dateEl.textContent = dayDate.toLocaleDateString('fr-FR', dayOptions);
        dateEl.dataset.date = dayDate.toISOString().split('T')[0];
    });
}

// Rendre le menu
function renderMenu() {
    const days = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
    
    days.forEach(day => {
        const meals = ['dejeuner', 'diner'];
        
        meals.forEach(meal => {
            const selectEl = document.querySelector(`.recipe-select[data-day="${day}"][data-meal="${meal}"]`);
            const recipeId = menu[day][meal];
            
            if (recipeId && recipes.find(r => r.id === recipeId)) {
                const recipe = recipes.find(r => r.id === recipeId);
                selectEl.classList.add('has-recipe');
                selectEl.innerHTML = `
                    <span class="recipe-name">${recipe.name}</span>
                    <span class="recipe-type ${recipe.type}">${recipe.type === 'lien' ? '🔗' : '📄'}</span>
                `;
            } else {
                selectEl.classList.remove('has-recipe');
                selectEl.innerHTML = '+ Ajouter une recette';
            }
        });
        
        // Remplir les champs manuels
        const manualInputDejeuner = document.querySelector(`.meal-input[data-day="${day}"][data-meal="dejeuner"]`);
        const manualInputDiner = document.querySelector(`.meal-input[data-day="${day}"][data-meal="diner"]`);
        const manualInputAutre = document.querySelector(`.meal-input[data-day="${day}"][data-meal="autre"]`);
        
        if (manualInputDejeuner) {
            manualInputDejeuner.value = manualEntries[day]?.dejeuner || '';
            manualInputDejeuner.classList.toggle('has-value', !!manualEntries[day]?.dejeuner);
        }
        if (manualInputDiner) {
            manualInputDiner.value = manualEntries[day]?.diner || '';
            manualInputDiner.classList.toggle('has-value', !!manualEntries[day]?.diner);
        }
        if (manualInputAutre) {
            manualInputAutre.value = manualEntries[day]?.autre || '';
            manualInputAutre.classList.toggle('has-value', !!manualEntries[day]?.autre);
        }
    });
    
    // Réattacher les événements aux champs manuels
    document.querySelectorAll('.meal-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const day = input.dataset.day;
            const meal = input.dataset.meal;
            manualEntries[day][meal] = input.value;
            input.classList.toggle('has-value', !!input.value);
            saveData();
        });
    });
}

// Initialisation au chargement de la page
document.addEventListener('DOMContentLoaded', init);
