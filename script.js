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
    ensureDayStructures();
    setupEventListeners();
    renderRecipes();
    renderDays();
    await loadData();
    setupDayRollover();
    setupAutoSync();
    
    // Enregistrer le service worker pour le mode hors ligne (PWA)
    if ('serviceWorker' in navigator) {
        let refreshing = false;
        // Quand un nouveau service worker prend le controle, recharger la page
        // pour que index.html/script.js de la nouvelle version soient charges
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            refreshing = true;
            location.reload();
        });
        navigator.serviceWorker.register('./service-worker.js').then(reg => {
            // Appliquer immediatement une nouvelle version du service worker des qu'elle est detectee
            reg.addEventListener('updatefound', () => {
                const newWorker = reg.installing;
                if (newWorker) {
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            newWorker.postMessage('SKIP_WAITING');
                        }
                    });
                }
            });
        }).catch(err => {
            console.warn('Service worker non enregistre :', err);
        });
    }
}

// Pousser automatiquement les modifications en attente vers le cloud au retour du reseau.
// Appelé par l'evenement 'online', le retour sur l'onglet (visibilitychange) et un check periodique.
let syncRetryInProgress = false;
async function syncPendingToCloud() {
    if (!navigator.onLine || syncRetryInProgress) return;
    const pending = localStorage.getItem('menuPendingSync') === 'true' || pendingOfflineChange;
    if (!pending && cloudReady) return;
    syncRetryInProgress = true;
    setSyncStatus('⏳ connexion...');
    try {
        if (cloudReady && db) {
            await saveData();
        } else {
            // Firebase pas encore initialise (chargement hors ligne) : repasser par loadData
            await loadData();
        }
    } catch (error) {
        console.warn('Sync auto échouée, nouvel essai plus tard :', error);
    } finally {
        syncRetryInProgress = false;
    }
}

function setupAutoSync() {
    window.addEventListener('online', syncPendingToCloud);
    window.addEventListener('offline', () => {
        setSyncStatus('⚠️ hors ligne', 'Hors ligne : données locales, synchronisation au retour du réseau');
    });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) syncPendingToCloud();
    });
    setInterval(syncPendingToCloud, 30000);
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
    if (!navigator.onLine) {
        setSyncStatus('⚠️ hors ligne', 'Hors ligne : données locales, synchronisation au retour du réseau');
        ensureDayStructures();
        if (purgeOldDays()) {
            await saveData();
        }
        renderRecipes();
        renderDays();
        return;
    }
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
        
        const localRecipes = JSON.parse(savedRecipes || '[]');
        const cloudRecipeCount = (docSnap.data().recipes || []).length;
        const localMenuEntries = Object.values(JSON.parse(savedMenu || '{}')).filter(d => d && (d.dejeuner || d.diner)).length;
        const cloudHasData = cloudRecipeCount > 0;
        const localHasData = localRecipes.length > 0 || localMenuEntries > 0;
        
        if (docSnap.exists() && pendingFlag && !localHasData && cloudHasData) {
            // GARDE-FOU : le local est vide mais le cloud a des donnees - NE PAS ecraser le cloud
            console.warn('Sync en attente ignoree : local vide, cloud non vide');
            localStorage.setItem('menuPendingSync', 'false');
            const data = docSnap.data();
            if (data.recipes) recipes = data.recipes;
            if (data.menu) menu = data.menu;
            if (data.manualEntries) manualEntries = data.manualEntries;
            if (data.lastExportMonth) lastExportMonth = data.lastExportMonth;
        } else if (docSnap.exists() && !pendingFlag) {
            // Le cloud a des données : elles font foi
            const data = docSnap.data();
            if (data.recipes) recipes = data.recipes;
            if (data.menu) menu = data.menu;
            if (data.manualEntries) manualEntries = data.manualEntries;
            if (data.lastExportMonth) lastExportMonth = data.lastExportMonth;
        } else if (docSnap.exists() && pendingFlag) {
            // Des modifications hors ligne sont en attente : elles écrasent le cloud
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
                    // Persister aussi en local : sans cela, un repas recupere en temps reel
                    // etait perdu des qu'on actualisait la page hors ligne
                    localStorage.setItem('menuRecipes', JSON.stringify(recipes));
                    localStorage.setItem('menuPlanning', JSON.stringify(menu));
                    localStorage.setItem('menuManualEntries', JSON.stringify(manualEntries));
                    ensureDayStructures();
                    renderRecipes();
                    renderDays();
                }
            }
        });
        
        // Garder une copie locale des donnees cloud (indispensable pour le mode hors ligne)
        localStorage.setItem('menuRecipes', JSON.stringify(recipes));
        localStorage.setItem('menuPlanning', JSON.stringify(menu));
        localStorage.setItem('menuManualEntries', JSON.stringify(manualEntries));
        
        renderRecipes();
        renderDays();
        checkMonthlyExport();
    } catch (error) {
        console.warn('Cloud indisponible, utilisation du mode local :', error);
        setSyncStatus('⚠️ hors ligne', 'Hors ligne : données locales, synchronisation au retour du réseau');
    }
    
    // Initialiser les structures si vide
    ensureDayStructures();
    
    // Purger les jours révolus de plus de 4 semaines
    if (purgeOldDays()) {
        await saveData();
    }
}

// Clé de date en heure locale (évite le décalage UTC autour de minuit)
function toLocalDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function ensureDayStructures() {
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

function setupDayRollover() {
    let lastRolloverDate = new Date().toDateString();

    const checkDayRollover = () => {
        const today = new Date().toDateString();
        if (today !== lastRolloverDate) {
            lastRolloverDate = today;
            ensureDayStructures();
            if (purgeOldDays()) {
                saveData();
            }
            renderDays();
        }
    };

    setInterval(checkDayRollover, 60000);
    document.addEventListener('visibilitychange', checkDayRollover);
    window.addEventListener('focus', checkDayRollover);
}

function purgeOldDays(maxAgeDays = 28) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxAgeDays);
    const cutoffKey = toLocalDateKey(cutoff);
    let removed = false;
    [menu, manualEntries].forEach(store => {
        Object.keys(store).forEach(key => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(key) && key < cutoffKey) {
                delete store[key];
                removed = true;
            }
        });
    });
    return removed;
}

// Obtenir les 8 jours à afficher (aujourd'hui + 7 suivants)
function getDaysToShow(today) {
    const days = [];
    
    for (let i = 0; i < 8; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        const dateKey = toLocalDateKey(date);
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
        if (recipe.imageUrl) {
            lines.push('Image: ' + recipe.imageUrl);
        }
        if (recipe.text) {
            lines.push('Notes: ' + recipe.text);
        }
        if (recipe.tags && recipe.tags.length > 0) {
            lines.push('Tags: ' + recipe.tags.join(', '));
        }
        if (recipe.category) {
            lines.push('Categorie: ' + recipe.category);
        }
        if (recipe.lastModified) {
            lines.push('Modifie: ' + recipe.lastModified);
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

// Importer des recettes depuis un fichier texte d'export (format : === Nom === / Lien: ... / Notes: ...)
function importRecipesFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
        const text = reader.result;
        const imported = [];
        let current = null;
        
        // Nettoyer les notes a la fermeture d'une recette :
        // retirer les sauts de ligne de fin (separateurs entre recettes)
        // et réduire les suites de lignes vides à une seule ligne vide
        const finalizeRecipe = r => {
            if (r.text) {
                r.text = r.text.replace(/\n{3,}/g, '\n\n').replace(/[\n\s]+$/, '');
                if (!r.text) r.text = null;
            }
            return r;
        };
        
        text.split(/\r?\n/).forEach(line => {
            const nameMatch = line.match(/^=== (.+) ===$/);
            if (nameMatch) {
                if (current && current.name) imported.push(finalizeRecipe(current));
                current = { name: nameMatch[1].trim(), url: null, text: null, imageUrl: null, tags: [], category: null, lastModified: null };
                return;
            }
            if (current) {
                const linkMatch = line.match(/^Lien: (.*)$/);
                const notesMatch = line.match(/^Notes: (.*)$/);
                const imageMatch = line.match(/^Image: (.*)$/);
                const tagsMatch = line.match(/^Tags: (.*)$/);
                const catMatch = line.match(/^Categorie: (.*)$/);
                const modMatch = line.match(/^Modifie: (.*)$/);
                if (linkMatch) {
                    current.url = linkMatch[1].trim() || null;
                } else if (imageMatch) {
                    current.imageUrl = imageMatch[1].trim() || null;
                } else if (tagsMatch) {
                    current.tags = tagsMatch[1].split(',').map(t => t.trim()).filter(t => t);
                } else if (catMatch) {
                    current.category = catMatch[1].trim() || null;
                } else if (modMatch) {
                    current.lastModified = modMatch[1].trim() || null;
                } else if (notesMatch) {
                    // Decoder aussi les sauts de ligne litteraux \n (fichiers exportes par la v33.011)
                    current.text = notesMatch[1].trim().replace(/\\n/g, '\n') || null;
                } else {
                    // Suite des notes : ligne sans prefixe reconnu apres une ligne Notes:
                    // les lignes vides sont des sauts de paragraphe : les conserver
                    if (current.text) {
                        current.text += line.trim() === '' ? '\n' : '\n' + line;
                    }
                }
            }
        });
        if (current && current.name) imported.push(finalizeRecipe(current));
        
        if (imported.length === 0) {
            alert('Aucune recette trouv\u00e9e dans ce fichier. V\u00e9rifiez qu\u2019il s\u2019agit d\u2019un export "mes-recettes-....txt".');
            return;
        }
        
        let added = 0;
        let updated = 0;
        let skipped = 0;
        imported.forEach(r => {
            const existing = recipes.find(e => e.name.toLowerCase() === r.name.toLowerCase());
            if (existing) {
                // Tag invisible de derniere modification : si la version importee est plus recente,
                // elle remplace integralement la recette existante (supprime le risque de doublon)
                const importedNewer = r.lastModified && (!existing.lastModified || r.lastModified > existing.lastModified);
                if (importedNewer) {
                    existing.url = r.url;
                    existing.text = r.text;
                    existing.imageUrl = r.imageUrl || existing.imageUrl;
                    existing.category = r.category;
                    if (r.tags && r.tags.length > 0) existing.tags = r.tags;
                    existing.lastModified = r.lastModified;
                    updated++;
                    return;
                }
                // Sinon : mettre a jour les champs manquants de la recette existante (ex. image apres re-import)
                if (!existing.lastModified && r.lastModified) {
                    existing.lastModified = r.lastModified;
                    updated++;
                }
                if (!existing.imageUrl && r.imageUrl) {
                    existing.imageUrl = r.imageUrl;
                    updated++;
                }
                if (!existing.url && r.url) {
                    existing.url = r.url;
                    updated++;
                }
                if (r.text) {
                    if (!existing.text) {
                        existing.text = r.text;
                        updated++;
                    } else if (r.text.length > existing.text.length) {
                        // Notes importees plus completes (ex. restauration de notes tronquees) : remplacer
                        existing.text = r.text;
                        updated++;
                    }
                }
                if (r.tags && r.tags.length > 0 && (!existing.tags || existing.tags.length === 0)) {
                    existing.tags = r.tags;
                    updated++;
                }
                if (!existing.category && r.category) {
                    existing.category = r.category;
                    updated++;
                }
            } else {
                recipes.push({
                    id: Date.now().toString() + '-' + Math.random().toString(36).slice(2, 8),
                    name: r.name,
                    url: r.url,
                    text: r.text,
                    imageUrl: r.imageUrl,
                    category: r.category,
                    tags: r.tags || [],
                    createdAt: new Date().toISOString(),
                    lastModified: r.lastModified || new Date().toISOString()
                });
                added++;
            }
        });
        
        saveData();
        renderRecipes();
        alert(added + ' recette(s) import\u00e9e(s), ' + updated + ' champ(s) compl\u00e9t\u00e9(s) sur des recettes existantes.');
    };
    reader.readAsText(file);
}

// Proposer l'export automatique une fois par mois
function checkMonthlyExport() {
    const currentMonth = new Date().toISOString().slice(0, 7);
    if (window.innerWidth > 1024 && lastExportMonth !== currentMonth && recipes.length > 0) {
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
    // Navigation par onglets sur mobile : par défaut, seule la vue active est visible
    if (window.innerWidth <= 1024) {
        const activeTab = document.querySelector('.mobile-tab.active');
        const activeName = activeTab ? activeTab.dataset.tab : 'menu';
        document.querySelectorAll('[data-section]').forEach(section => {
            section.classList.toggle('hidden-tab', section.dataset.section !== activeName);
        });
    }

    setupMobileTabs();
}

function getMobileTabs() {
    return Array.from(document.querySelectorAll('.mobile-tab'));
}

function getSwipeSections() {
    return Array.from(document.querySelectorAll('[data-section]'));
}

let menuScrollPosition = 0;

function switchToTab(tabName) {
    const tabs = getMobileTabs();
    const target = tabs.find(t => t.dataset.tab === tabName);
    if (!target) return;
    const activeTab = tabs.find(t => t.classList.contains('active'));
    const leavingMenu = activeTab && activeTab.dataset.tab === 'menu' && tabName !== 'menu';
    // Sur telephone, mémoriser la position du scroll du Menu avant de le quitter
    if (leavingMenu && window.innerWidth <= 1024) {
        menuScrollPosition = window.scrollY;
    }
    tabs.forEach(t => t.classList.remove('active'));
    target.classList.add('active');
    getSwipeSections().forEach(section => {
        section.classList.toggle('hidden-tab', section.dataset.section !== tabName);
    });
    // Restaurer la position du scroll du Menu (le retour depuis Recettes laissait la page tout en bas)
    if (tabName === 'menu' && window.innerWidth <= 1024) {
        requestAnimationFrame(() => {
            window.scrollTo({ top: menuScrollPosition });
        });
    }
}

function isSwipeTargetValid(target) {
    return !(target.closest('.modal') || target.closest('input') || target.closest('textarea') || target.closest('select'));
}

function setupMobileTabs() {
    document.querySelectorAll('.mobile-tab').forEach(tab => {
        tab.addEventListener('click', () => switchToTab(tab.dataset.tab));
    });

    if (window.innerWidth > 1024) return;

    let touchStartX = null;
    let touchStartY = null;
    let swipeCandidate = false;
    let swipeSections = [];
    let swipeDir = 0;
    let swipeEngaged = false;

    const MAX_DRAG_RATIO = 1.5;
    const MIN_COMMIT_DX = 60;
    const MAX_RESET_DX = 9999;

    document.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        if (!isSwipeTargetValid(e.target)) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        swipeCandidate = false;
        swipeEngaged = false;
        const tabs = getMobileTabs();
        const activeIndex = tabs.findIndex(t => t.classList.contains('active'));
        if (activeIndex === -1) return;
        const leftIndex = activeIndex - 1;
        const rightIndex = activeIndex + 1;
        const leftSection = leftIndex >= 0 ? getSwipeSections().find(s => s.dataset.section === tabs[leftIndex].dataset.tab) : null;
        const rightSection = rightIndex < tabs.length ? getSwipeSections().find(s => s.dataset.section === tabs[rightIndex].dataset.tab) : null;
        swipeSections = [getSwipeSections().find(s => s.dataset.section === tabs[activeIndex].dataset.tab), leftSection, rightSection];
        swipeDir = 0;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (touchStartX === null) return;
        const touch = e.touches[0];
        const dx = touch.clientX - touchStartX;
        const dy = touch.clientY - touchStartY;

        if (!swipeEngaged) {
            if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * MAX_DRAG_RATIO) return;
            swipeEngaged = true;
            const tabs = getMobileTabs();
            const activeIndex = tabs.findIndex(t => t.classList.contains('active'));
            if (dx < 0 && activeIndex < tabs.length - 1) swipeDir = 1;
            else if (dx > 0 && activeIndex > 0) swipeDir = -1;
            else swipeDir = 0;
            if (swipeDir !== 0) {
                const current = swipeSections[0];
                const incoming = swipeDir > 0 ? swipeSections[2] : swipeSections[1];
                if (current && incoming) {
                    incoming.classList.remove('hidden-tab');
                    incoming.style.transition = 'none';
                    current.style.transition = 'none';
                    incoming.classList.add('swipe-incoming');
                }
            }
        }

        if (swipeDir === 0) return;

        const w = window.innerWidth;
        const clampedDx = Math.max(-w, Math.min(w, dx));
        const progress = Math.min(1, Math.abs(clampedDx) / w);
        const current = swipeSections[0];
        const incoming = swipeDir > 0 ? swipeSections[2] : swipeSections[1];
        if (!current || !incoming) return;

        current.style.transform = `translateX(${clampedDx * 0.85}px)`;
        current.style.opacity = String(1 - progress * 0.4);
        const incomingOffset = swipeDir > 0 ? w - clampedDx * 0.85 : -w - clampedDx * 0.85;
        incoming.style.transform = `translateX(${incomingOffset}px)`;
        incoming.style.opacity = String(0.3 + progress * 0.7);
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
        if (touchStartX === null) return;
        const touch = e.changedTouches[0];
        const dx = touch.clientX - touchStartX;
        const dy = touchStartY === null ? 0 : touch.clientY - touchStartY;
        touchStartX = null;
        touchStartY = null;

        const current = swipeSections[0] || null;
        const incoming = (swipeDir > 0 ? swipeSections[2] : swipeSections[1]) || null;

        const cleanup = (commit) => {
            if (current) {
                current.style.transition = '';
                current.style.transform = '';
                current.style.opacity = '';
            }
            if (incoming) {
                incoming.style.transition = '';
                incoming.style.transform = '';
                incoming.style.opacity = '';
                incoming.classList.remove('swipe-incoming');
                if (!commit) incoming.classList.add('hidden-tab');
            }
            swipeSections = [];
            swipeDir = 0;
            swipeEngaged = false;
        };

        if (!swipeEngaged) {
            const horizontalDominant = Math.abs(dy) === 0 || Math.abs(dx) >= Math.abs(dy) * MAX_DRAG_RATIO;
            if (Math.abs(dx) >= MIN_COMMIT_DX && horizontalDominant) {
                const tabs = getMobileTabs();
                const activeIndex = tabs.findIndex(t => t.classList.contains('active'));
                const nextIndex = dx < 0 ? activeIndex + 1 : activeIndex - 1;
                if (nextIndex >= 0 && nextIndex < tabs.length && isSwipeTargetValid(e.target)) {
                    switchToTab(tabs[nextIndex].dataset.tab);
                }
            }
            return;
        }

        if (swipeDir === 0 || !current || !incoming) {
            cleanup(false);
            return;
        }

        const commitSameDir = swipeDir > 0 ? dx < 0 : dx > 0;
        const commit = commitSameDir && Math.abs(dx) >= Math.min(MIN_COMMIT_DX, window.innerWidth * 0.25);
        if (commit) {
            switchToTab(incoming.dataset.section);
            cleanup(true);
        } else {
            incoming.style.transition = '';
            current.style.transition = '';
            requestAnimationFrame(() => {
                incoming.style.transform = 'translateX(0)';
                incoming.style.opacity = '1';
                current.style.transform = 'translateX(0)';
                current.style.opacity = '1';
            });
            setTimeout(() => cleanup(false), 250);
        }
    }, { passive: true });
}

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
    
    const importRecipesBtn = document.getElementById('import-recipes-btn');
    const importRecipesInput = document.getElementById('import-recipes-input');
    if (importRecipesBtn && importRecipesInput) {
        importRecipesBtn.addEventListener('click', () => importRecipesInput.click());
        importRecipesInput.addEventListener('change', () => {
            if (importRecipesInput.files && importRecipesInput.files[0]) {
                importRecipesFromFile(importRecipesInput.files[0]);
                importRecipesInput.value = '';
            }
        });
    }

    // Recherche et filtre des recettes
    // En mode selection ("Ajouter pour le"), conserver le contexte jour/repas,
    // sinon renderRecipes() sans arguments sortait du mode selection et l'ajout echouait
    const recipeSearch = document.getElementById('recipe-search');
    if (recipeSearch) {
        recipeSearch.addEventListener('input', () => {
            renderRecipes(!!window.currentSelectingDay, window.currentSelectingDay, window.currentSelectingMeal);
        });
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
function isDragEnabled() {
    return window.innerWidth > 768;
}

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
    enterSelectionModeUI(day, meal);
    switchToTab('recipes');
    
    document.querySelector('.recipes-section').scrollIntoView({ behavior: 'smooth' });
}

// Mettre l'en-tête de l'onglet Recettes en mode sélection d'une recette pour un repas
function enterSelectionModeUI(day, meal) {
    const header = document.querySelector('.recipes-header');
    if (!header.dataset.normalHtml) {
        header.dataset.normalHtml = header.innerHTML;
    }
    
    const options = getDaysToShow(new Date()).map(dayInfo => {
        const date = new Date(`${dayInfo.dateKey}T12:00:00`);
        const dayNum = date.getDate();
        return `
            <option value="${dayInfo.dateKey}|dejeuner" ${day === dayInfo.dateKey && meal === 'dejeuner' ? 'selected' : ''}>${dayInfo.dayName} ${dayNum} midi</option>
            <option value="${dayInfo.dateKey}|diner" ${day === dayInfo.dateKey && meal === 'diner' ? 'selected' : ''}>${dayInfo.dayName} ${dayNum} soir</option>
        `;
    }).join('');
    
    header.innerHTML = `
        <h2>Ajouter pour le</h2>
        <select id="meal-select" class="btn btn-secondary" title="Jour et repas pour lesquels ajouter la recette">${options}</select>
        <div class="header-spacer"></div>
        <button type="button" id="cancel-selection-btn" class="btn btn-secondary">Annuler</button>
    `;
    
    header.classList.add('selection-mode');
    
    document.getElementById('meal-select').addEventListener('change', (e) => {
        const [selectedDay, selectedMeal] = e.target.value.split('|');
        window.currentSelectingDay = selectedDay;
        window.currentSelectingMeal = selectedMeal;
        renderRecipes(true, selectedDay, selectedMeal);
    });
    
    document.getElementById('cancel-selection-btn').addEventListener('click', exitSelectionMode);
}

// Restaurer l'en-tête normal de l'onglet Recettes
function exitSelectionMode() {
    const header = document.querySelector('.recipes-header');
    header.classList.remove('selection-mode');
    if (header.dataset.normalHtml) {
        header.innerHTML = header.dataset.normalHtml;
        delete header.dataset.normalHtml;
    }
    
    delete window.currentSelectingDay;
    delete window.currentSelectingMeal;
    
    attachHeaderButtons();
    
    renderRecipes();
}

// Brancher les boutons de l'en-tête Recettes (appelé à l'init et après restauration du mode sélection)
function attachHeaderButtons() {
    const addBtn = document.getElementById('add-recipe-btn');
    if (addBtn) addBtn.addEventListener('click', () => showRecipeModal(null));
    
    const exportBtn = document.getElementById('export-recipes-btn');
    if (exportBtn) exportBtn.addEventListener('click', exportRecipesToFile);
    
    const importBtn = document.getElementById('import-recipes-btn');
    const importInput = document.getElementById('import-recipes-input');
    if (importBtn && importInput) {
        importBtn.addEventListener('click', () => importInput.click());
        importInput.addEventListener('change', () => {
            if (importInput.files && importInput.files[0]) {
                importRecipesFromFile(importInput.files[0]);
                importInput.value = '';
            }
        });
    }
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
    
    if (window.currentSelectingDay) {
        exitSelectionMode();
        switchToTab('menu');
    } else {
        renderRecipes();
    }
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
        createdAt: recipeId ? recipes.find(r => r.id === recipeId).createdAt : new Date().toISOString(),
        lastModified: new Date().toISOString()
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
        card.draggable = isDragEnabled();
        
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
        
        // Sur telephone, le lien preview d'une carte doit ouvrir la recette en lecture,
        // pas naviguer vers le site externe (comme le reste de la carte)
        const linkPreview = card.querySelector('.recipe-link-preview');
        if (linkPreview && window.innerWidth <= 768) {
            linkPreview.addEventListener('click', (e) => {
                e.preventDefault();
            });
        }
        
        // Événements drag & drop pour les recettes
        if (isDragEnabled()) {
            card.addEventListener('dragstart', (ev) => {
                startRecipeDrag(ev, recipe.id);
            });
            card.addEventListener('dragend', (ev) => {
                endRecipeDrag(ev);
            });
        }
        
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
    const isMobile = window.innerWidth <= 768;
    const mealBtnLabel = isMobile ? '+' : '-';
    
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
                        <button type="button" class="meal-box-delete-btn" data-day="${dayInfo.dateKey}" data-meal="dejeuner">${mealBtnLabel}</button>
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
                        <button type="button" class="meal-box-delete-btn" data-day="${dayInfo.dateKey}" data-meal="diner">${mealBtnLabel}</button>
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
    // Boutons -/+ : vider la case (bureau) ou ajouter une recette (mobile)
    document.querySelectorAll('.meal-box-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const day = btn.dataset.day;
            const meal = btn.dataset.meal;
            if (btn.textContent.trim() === '+') {
                if (!manualEntries[day]) {
                    manualEntries[day] = { dejeuner: '', diner: '', autre: '' };
                }
                if (!menu[day]) {
                    menu[day] = { dejeuner: null, diner: null };
                }
                showRecipeSelectionForMeal(day, meal);
            } else {
                manualEntries[day][meal] = '';
                menu[day][meal] = null;
                saveData();
                renderDays();
            }
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
            if (box.querySelector('.meal-edit-input')) return;
            
            const day = box.dataset.day;
            const meal = box.dataset.meal;
            
            if (!manualEntries[day]) {
                manualEntries[day] = { dejeuner: '', diner: '', autre: '' };
            }
            if (!menu[day]) {
                menu[day] = { dejeuner: null, diner: null };
            }
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
            box.draggable = false;
            input.focus();
            
            const saveEdit = () => {
                box.draggable = isDragEnabled();
                manualEntries[day][meal] = input.value;
                box.classList.toggle('has-value', !!input.value);
                // Texte vide ou nom de la recette liee absent : supprimer le lien
                const linkedId = menu[day] ? menu[day][meal] : null;
                if (linkedId) {
                    const linkedRecipe = recipes.find(r => r.id === linkedId);
                    const linkedName = linkedRecipe ? linkedRecipe.name : null;
                    const textOk = linkedName && input.value.trim() &&
                        input.value.toLowerCase().includes(linkedName.toLowerCase());
                    if (!textOk) {
                        menu[day][meal] = null;
                    }
                }
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
        box.draggable = isDragEnabled();
        if (isDragEnabled()) {
            box.addEventListener('dragstart', (ev) => {
                if (box.querySelector('.meal-edit-input') || !window.getSelection().isCollapsed) {
                    ev.preventDefault();
                    return;
                }
                startMealDrag(ev, box.dataset.day, box.dataset.meal);
            });
            box.addEventListener('dragend', (ev) => endMealDrag(ev));
        }
        box.addEventListener('dragover', allowDrop);
        box.addEventListener('dragleave', dragLeave);
        box.addEventListener('drop', dropMeal);
        
        // Drag & Drop pour les recettes
        box.addEventListener('drop', dropRecipe);
    });
}

// Initialisation au chargement de la page
document.addEventListener('DOMContentLoaded', init);
