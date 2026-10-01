// Données des recettes et du menu
let recipes = [];
let menu = {};
let manualEntries = {};
let draggedRecipe = null;
let draggedMeal = null;

// Jours de la semaine
const DAYS_OF_WEEK = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

// Initialisation
function init() {
    loadData();
    setupEventListeners();
    renderRecipes();
    renderDays();
}

// Chargement des données depuis localStorage
function loadData() {
    const savedRecipes = localStorage.getItem('menuRecipes');
    const savedMenu = localStorage.getItem('menuPlanning');
    const savedManualEntries = localStorage.getItem('menuManualEntries');
    
    if (savedRecipes) recipes = JSON.parse(savedRecipes);
    if (savedMenu) menu = JSON.parse(savedMenu);
    if (savedManualEntries) manualEntries = JSON.parse(savedManualEntries);
    
    // Initialiser les structures
    const today = new Date();
    const daysToShow = getDaysToShow(today);
    
    daysToShow.forEach(dayInfo => {
        if (!menu[dayInfo.dateKey]) menu[dayInfo.dateKey] = { dejeuner: null, diner: null };
        if (!manualEntries[dayInfo.dateKey]) manualEntries[dayInfo.dateKey] = { dejeuner: '', diner: '', autre: '' };
    });
}

function getDaysToShow(today) {
    const days = [];
    for (let i = 0; i < 8; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        const dateKey = date.toISOString().split('T')[0];
        days.push({ dateKey, dayName: DAYS_OF_WEEK[date.getDay()], dateObj: date });
    }
    return days;
}

function getDayLabel(date) {
    return DAYS_OF_WEEK[date.getDay()];
}

function saveData() {
    localStorage.setItem('menuRecipes', JSON.stringify(recipes));
    localStorage.setItem('menuPlanning', JSON.stringify(menu));
    localStorage.setItem('menuManualEntries', JSON.stringify(manualEntries));
}

function setupEventListeners() {
    // Boutons et formulaires
    const addRecipeBtn = document.getElementById('add-recipe-btn');
    if (addRecipeBtn) addRecipeBtn.addEventListener('click', () => showRecipeModal(null));
    
    const recipeSearch = document.getElementById('recipe-search');
    const recipeFilter = document.getElementById('recipe-filter');
    if (recipeSearch && recipeFilter) {
        recipeSearch.addEventListener('input', renderRecipes);
        recipeFilter.addEventListener('change', renderRecipes);
    }
    
    // Modals
    document.querySelectorAll('.btn-close').forEach(btn => {
        btn.addEventListener('click', () => closeModal(btn.closest('.modal')));
    });
    
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(modal); });
    });
    
    const recipeForm = document.getElementById('recipe-form');
    if (recipeForm) recipeForm.addEventListener('submit', handleRecipeForm);
    
    const recipeType = document.getElementById('recipe-type');
    if (recipeType) recipeType.addEventListener('change', toggleRecipeForm);
    
    const cancelBtn = document.getElementById('cancel-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => closeModal(document.getElementById('recipe-modal')));
    
    const closeViewBtn = document.querySelector('.btn-close-view');
    if (closeViewBtn) closeViewBtn.addEventListener('click', () => closeModal(document.getElementById('view-recipe-modal')));
}

// Drag & Drop functions
function allowDrop(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    const target = ev.target.closest('.meal-box, .day-card');
    if (target) target.classList.add('drag-over');
    ev.dataTransfer.dropEffect = 'copy';
}

function dragLeave(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    document.querySelectorAll('.meal-box, .day-card').forEach(el => el.classList.remove('drag-over'));
}

function dropRecipe(ev) {
    let recipeId = ev.dataTransfer.getData('text/plain');
    if (!recipeId && draggedRecipe) {
        recipeId = draggedRecipe;
    }
    if (!recipeId) return;
    
    // Si c'est un drag de repas (format day|meal), on ignore
    if (recipeId.includes('|')) return;
    
    ev.preventDefault();
    ev.stopPropagation();
    document.querySelectorAll('.meal-box, .day-card, .recipes-grid').forEach(el => el.classList.remove('drag-over'));
    
    const recipe = recipes.find(r => r.id === recipeId);
    if (!recipe) return;
    
    let target = ev.target.closest('.meal-box');
    if (target) {
        const day = target.dataset.day;
        const meal = target.dataset.meal;
        manualEntries[day][meal] = recipe.name;
        menu[day][meal] = recipeId;
        saveData();
        renderDays();
        renderRecipes();
    }
    
    draggedRecipe = null;
    hideDragIndicator();
}

function dropMeal(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    document.querySelectorAll('.meal-box, .day-card').forEach(el => el.classList.remove('drag-over'));
    
    let data = ev.dataTransfer.getData('text/plain');
    let sourceDay, sourceMeal;
    
    console.log('dropMeal data:', data, 'draggedMeal:', draggedMeal);
    
    if (data && data.includes('|')) {
        [sourceDay, sourceMeal] = data.split('|');
    } else if (draggedMeal) {
        sourceDay = draggedMeal.day;
        sourceMeal = draggedMeal.meal;
    }
    
    if (!sourceDay || !sourceMeal) {
        console.log('dropMeal: no source found, returning');
        return;
    }
    console.log('dropMeal: sourceDay:', sourceDay, 'sourceMeal:', sourceMeal);
    
    const target = ev.target.closest('.meal-box');
    if (target) {
        const targetDay = target.dataset.day;
        const targetMeal = target.dataset.meal;
        
        // Écraser la cible avec la source
        manualEntries[targetDay][targetMeal] = manualEntries[sourceDay][sourceMeal];
        menu[targetDay][targetMeal] = menu[sourceDay][sourceMeal];
        
        // Vider la source
        manualEntries[sourceDay][sourceMeal] = '';
        menu[sourceDay][sourceMeal] = null;
        
        saveData();
        renderDays();
    }
    
    draggedMeal = null;
    hideDragIndicator();
}

function startRecipeDrag(ev, recipeId) {
    ev.dataTransfer.setData('text/plain', recipeId);
    ev.dataTransfer.effectAllowed = 'copy';
    ev.target.classList.add('dragging');
    draggedRecipe = recipeId;
    setTimeout(showDragIndicator, 200);
}

function endRecipeDrag(ev) {
    ev.target.classList.remove('dragging');
    draggedRecipe = null;
    hideDragIndicator();
}

function startMealDrag(ev, day, meal) {
    ev.dataTransfer.setData('text/plain', `${day}|${meal}`);
    ev.dataTransfer.effectAllowed = 'move';
    ev.target.classList.add('dragging');
    draggedMeal = { day, meal };
    setTimeout(showDragIndicator, 200);
    console.log('startMealDrag:', day, meal, ev.dataTransfer.getData('text/plain'));
}

function endMealDrag(ev) {
    ev.target.classList.remove('dragging');
    draggedMeal = null;
    hideDragIndicator();
}

function showDragIndicator() {
    const indicator = document.getElementById('drag-indicator');
    if (indicator) indicator.classList.add('active');
}

function hideDragIndicator() {
    const indicator = document.getElementById('drag-indicator');
    if (indicator) indicator.classList.remove('active');
}

// Menu functions
function showRecipeSelectionForMeal(day, meal) {
    window.currentSelectingDay = day;
    window.currentSelectingMeal = meal;
    renderRecipes(true, day, meal);
    document.querySelector('.recipes-section').scrollIntoView({ behavior: 'smooth' });
}

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

// Modal functions
function showRecipeModal(recipeId) {
    const modal = document.getElementById('recipe-modal');
    const form = document.getElementById('recipe-form');
    
    if (recipeId) {
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

function closeModal(modal) {
    modal.classList.remove('active');
    const form = document.getElementById('recipe-form');
    if (form) {
        form.reset();
        form.dataset.editingId = '';
    }
    delete window.currentSelectingDay;
    delete window.currentSelectingMeal;
    document.querySelectorAll('.recipe-card').forEach(card => card.classList.remove('selected'));
}

function toggleRecipeForm() {
    const type = document.getElementById('recipe-type').value;
    const urlGroup = document.getElementById('url-group');
    const textGroup = document.getElementById('text-group');
    if (urlGroup && textGroup) {
        urlGroup.classList.toggle('hidden', type === 'texte');
        textGroup.classList.toggle('hidden', type === 'lien');
    }
}

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
    
    if (!name) { alert('Le nom est obligatoire'); return; }
    if (type === 'lien' && !url) { alert('URL obligatoire'); return; }
    if (type === 'texte' && !text) { alert('Texte obligatoire'); return; }
    
    const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(t => t) : [];
    const recipeData = {
        id: recipeId || Date.now().toString(),
        name, type,
        url: type === 'lien' ? url : null,
        text: type === 'texte' ? text : null,
        category: category || null,
        tags,
        createdAt: recipeId ? recipes.find(r => r.id === recipeId).createdAt : new Date().toISOString()
    };
    
    if (recipeId) {
        recipes[recipes.findIndex(r => r.id === recipeId)] = recipeData;
    } else {
        recipes.push(recipeData);
    }
    
    saveData();
    closeModal(document.getElementById('recipe-modal'));
    renderRecipes();
}

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

function deleteRecipe(recipeId) {
    if (!confirm('Supprimer cette recette ?')) return;
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

// Render functions
function renderRecipes(forSelection = false, dayParam = null, mealParam = null) {
    const listEl = document.getElementById('recipes-list');
    const searchTerm = document.getElementById('recipe-search')?.value.toLowerCase() || '';
    const filterType = document.getElementById('recipe-filter')?.value || 'all';
    
    let filteredRecipes = recipes.filter(recipe => {
        const matchesSearch = recipe.name.toLowerCase().includes(searchTerm) ||
                           (recipe.tags && recipe.tags.some(tag => tag.toLowerCase().includes(searchTerm))) ||
                           (recipe.category && recipe.category.toLowerCase().includes(searchTerm)) ||
                           (recipe.text && recipe.text.toLowerCase().includes(searchTerm));
        const matchesFilter = filterType === 'all' || recipe.type === filterType;
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
        
        if (isSelecting && menu[currentSelectingDay][currentSelectingMeal] === recipe.id) {
            card.classList.add('selected');
        }
        
        card.innerHTML = `
            <h3>${recipe.name}</h3>
            <div class="recipe-meta">
                ${recipe.category ? `<span>${recipe.category}</span>` : ''}
                ${recipe.tags?.length > 0 ? `<div class="recipe-tags">${recipe.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}</div>` : ''}
            </div>
            <div class="recipe-type ${recipe.type}">${recipe.type === 'lien' ? 'Lien' : 'Recette écrite'}</div>
            <div class="recipe-actions">
                <button class="btn-icon view-recipe" title="Voir">👁️</button>
                <button class="btn-icon edit-recipe" title="Modifier">✏️</button>
                <button class="btn-icon delete-recipe" title="Supprimer">🗑️</button>
            </div>
        `;
        
        card.querySelector('.view-recipe').addEventListener('click', (e) => { e.stopPropagation(); showRecipeDetails(recipe.id); });
        card.querySelector('.edit-recipe').addEventListener('click', (e) => { e.stopPropagation(); showRecipeModal(recipe.id); });
        card.querySelector('.delete-recipe').addEventListener('click', (e) => { e.stopPropagation(); deleteRecipe(recipe.id); });
        
        card.addEventListener('dragstart', (ev) => startRecipeDrag(ev, recipe.id));
        card.addEventListener('dragend', (ev) => endRecipeDrag(ev));
        
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
    
    listEl.addEventListener('dragover', allowDrop);
    listEl.addEventListener('dragleave', dragLeave);
    listEl.addEventListener('drop', dropRecipe);
}

function renderDays() {
    const daysList = document.querySelector('.days-grid');
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
        if (isToday) dayCard.classList.add('today');
        
        dayCard.innerHTML = `
            <h3>${dayLabel}</h3>
            <div class="day-meals">
                <div class="meal-slot" data-meal="dejeuner">
                    <span class="meal-label">Déjeuner</span>
                    <div class="meal-box ${isToday ? 'today' : ''} ${manualEntries[dayInfo.dateKey]?.dejeuner ? 'has-value' : ''}" 
                         data-day="${dayInfo.dateKey}" data-meal="dejeuner">
                        <span class="meal-box-text ${manualEntries[dayInfo.dateKey]?.dejeuner ? '' : 'empty'}">
                            ${manualEntries[dayInfo.dateKey]?.dejeuner || 'Vide'}
                        </span>
                        <div class="meal-box-select-btn" data-day="${dayInfo.dateKey}" data-meal="dejeuner">+</div>
                    </div>
                </div>
                <div class="meal-slot" data-meal="diner">
                    <span class="meal-label">Dîner</span>
                    <div class="meal-box ${isToday ? 'today' : ''} ${manualEntries[dayInfo.dateKey]?.diner ? 'has-value' : ''}" 
                         data-day="${dayInfo.dateKey}" data-meal="diner">
                        <span class="meal-box-text ${manualEntries[dayInfo.dateKey]?.diner ? '' : 'empty'}">
                            ${manualEntries[dayInfo.dateKey]?.diner || 'Vide'}
                        </span>
                        <div class="meal-box-select-btn" data-day="${dayInfo.dateKey}" data-meal="diner">+</div>
                    </div>
                </div>
            </div>
        `;
        daysList.appendChild(dayCard);
    });
    
    attachDayEvents();
}

function attachDayEvents() {
    document.querySelectorAll('.meal-box-select-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            showRecipeSelectionForMeal(btn.dataset.day, btn.dataset.meal);
        });
    });
    
    document.querySelectorAll('.meal-box').forEach(box => {
        box.addEventListener('click', (e) => {
            if (e.target.classList.contains('meal-box-select-btn')) return;
            const day = box.dataset.day;
            const meal = box.dataset.meal;
            const currentText = manualEntries[day][meal] || '';
            const input = document.createElement('input');
            input.type = 'text';
            input.value = currentText;
            input.className = 'meal-edit-input';
            input.style.width = '100%';
            input.style.padding = '6px';
            input.style.border = '2px solid var(--primary-dark)';
            input.style.borderRadius = '4px';
            input.style.fontSize = '0.85rem';
            
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
                if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
            });
        });
        
        // Drag & Drop pour les repas
        box.draggable = true;
        box.addEventListener('dragstart', (ev) => startMealDrag(ev, box.dataset.day, box.dataset.meal));
        box.addEventListener('dragend', (ev) => endMealDrag(ev));
        box.addEventListener('dragover', allowDrop);
        box.addEventListener('dragleave', dragLeave);
        box.addEventListener('drop', (ev) => {
            const data = ev.dataTransfer.getData('text/plain');
            console.log('drop handler: data=', data, 'draggedMeal=', draggedMeal);
            if (data && data.includes('|')) {
                console.log('calling dropMeal from data format');
                dropMeal(ev);
            } else if (draggedMeal) {
                console.log('calling dropMeal from draggedMeal');
                dropMeal(ev);
            } else {
                console.log('calling dropRecipe');
                dropRecipe(ev);
            }
        });
    });
}

// Initialisation
document.addEventListener('DOMContentLoaded', init);
