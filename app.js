// NO sample data - we'll fetch from backend only
let posts = [];
const users = [
    { id: 1, name: 'Sarah Chen', posts: 12, followers: 45, following: true, avatar: 'SC' },
    { id: 2, name: 'Mike Rodriguez', posts: 8, followers: 23, following: false, avatar: 'MR' },
    { id: 3, name: 'Emma Wilson', posts: 15, followers: 67, following: true, avatar: 'EW' },
    { id: 4, name: 'David Kim', posts: 5, followers: 18, following: false, avatar: 'DK' },
    { id: 5, name: 'Lisa Park', posts: 20, followers: 89, following: false, avatar: 'LP' }
];

let map = null;
let markers = [];
let userLocation = null;
let userCityName = 'Your City';
let mapInitialized = false;

// NSFWJS (client-side safety)
let nsfwModel = null;
let nsfwLoading = false;
async function loadNSFWModel() {
  if (nsfwModel || nsfwLoading) return;
  try {
    nsfwLoading = true;
    if (window.nsfwjs && window.tf) {
      nsfwModel = await window.nsfwjs.load();
    }
  } catch (e) {
    console.error('NSFW model load failed:', e);
  } finally {
    nsfwLoading = false;
  }
}
async function isImageSafeFromFile(file) {
  try {
    if (!nsfwModel) await loadNSFWModel();
    if (!nsfwModel) return true; // fail-open if model not available
    const img = new Image();
    const url = URL.createObjectURL(file);
    return await new Promise((resolve) => {
      img.onload = async () => {
        try {
          const preds = await nsfwModel.classify(img);
          URL.revokeObjectURL(url);
          const score = (name) => (preds.find(p => p.className === name)?.probability) || 0;
          const porn = score('Porn');
          const hentai = score('Hentai');
          const sexy = score('Sexy');
          const safe = porn < 0.6 && hentai < 0.6 && sexy < 0.8;
          resolve(safe);
        } catch (err) {
          console.error('NSFW classify failed:', err);
          resolve(true);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(true); };
      img.src = url;
    });
  } catch (_) { return true; }
}

// State
let likedPosts = new Set(); // Tracks post IDs the user has liked
let hasNewPostNotification = false; // Tracks if a new post was created
let appNotifications = []; // In-app notifications (e.g., likes)

// i18n
let currentLang = localStorage.getItem('lang') || 'en';
const i18n = {
  en: {
    email: 'Email',
    email_ph: 'Enter your email',
    password: 'Password',
    password_ph: 'Enter your password',
    sign_in: 'Sign In',
    forgot_password: 'Forgot Password?',
    sign_up: 'Sign Up',
    create_account_title: 'Create Account',
    name: 'Name',
    name_ph: 'Enter your name',
    confirm_password: 'Confirm Password',
    confirm_password_ph: 'Confirm your password',
    language: 'Language',
    create_account_btn: 'Create Account',
    already_have_account: 'Already have an account? Sign In',
    allow_location: 'Use Current Location',
    manual_location: 'Enter Manually',
    enter_city_ph: 'Enter your city name',
    continue: 'Continue',
    exploring: 'Exploring',
    sales_in: 'Sales in',
    search_events_ph: 'Search events, places...',
    search_products_ph: 'Search products, services...',
    user_search_ph: 'Search for users...',
    for_you: 'For You',
    find_people: 'Find People',
    notifications: 'Notifications',
    account_settings: 'Account Settings',
    profile_level: 'City Explorer',
    points: 'Points',
    day_streak: 'Day Streak',
    my_posts: 'My Posts',
    friends: 'Friends',
    followers_following: 'followers •',
    feed: 'Feed',
    sales: 'Sales',
    alerts: 'Alerts',
    profile: 'Profile',
    log_out: 'Log Out',
    app_title: 'Discover City',
    discover_your_city: 'Discover Your City',
    location_prompt_desc: 'Let us know your location to show you the best events and discoveries near you!',
    // Create post modal
    create_post: 'Create a post',
    create_post_sub: "Share what's on your mind",
    create_sale: 'Make a Sales announcement',
    create_sale_sub: 'Promote your product or service',
    back_to_types: 'Back to types',
    post_title_sale_ph: 'Product/Service name',
    post_title_post_ph: "What's on your mind?",
    price_optional: 'Price (optional)',
    upload_image_optional: 'Upload Image (Optional)',
    add_description_ph: 'Add description...',
    hashtags_ph: '#hashtags',
    submit_post_post: 'Publish post',
    submit_post_sale: 'Publish sale',
    // Users and profile
    posts_word: 'posts',
    followers_word: 'followers',
    follow: 'Follow',
    following: 'Following',
    send_message: 'Send Message',
    recent_posts: 'Recent Posts',
    no_posts_yet: 'No posts yet',
    // Sales card actions
    favorite: 'Favorite',
    delete: 'Delete',
    // Dialogs and alerts
    confirm_delete_post: 'Delete this post? This cannot be undone.',
    failed_delete: 'Failed to delete. Please try again.',
    title_required: 'Title is required',
    please_log_in_first: 'Please log in first',
    session_expired: 'Session expired. Please log in again.',
    login_failed_generic: 'Login failed. Please try again.',
    signup_failed_generic: 'Sign up failed. Please try again.',
    // Map and location
    requesting_location: 'Requesting Location...',
    your_location: 'Your Location',
    map_failed: 'Map failed to load. Please refresh the page.',
    geo_permission_denied: 'Please allow location access when prompted.',
    geo_position_unavailable: 'Location information is unavailable.',
    geo_timeout: 'The request to get your location timed out.',
    geo_unknown_error: 'An unknown error occurred.',
    // Account modal labels
    preferences: 'Preferences',
    privacy: 'Privacy',
    name_label: 'Name:',
    email_label: 'Email:',
    member_since_label: 'Member since:',
    dark_mode: 'Dark Mode',
    location_sharing: 'Location sharing:',
    notifications_label: 'Notifications:',
    enabled: 'Enabled',
    // Notifications modal texts
    post_liked: 'Post Liked',
    notification_word: 'Notification',
    new_post_title: 'New Post!',
    new_post_desc: 'New post created by {{author}} — check it out!',
    no_notifications_title: 'No notifications yet',
    no_notifications_desc: "When you have notifications, they'll appear here",
    // NSFW messages
    nsfw_model_loading: 'Safety check loading, please try again in a moment.',
    nsfw_image_blocked: 'Image rejected: NSFW content detected. Please choose a different image.',
    nsfw_image_warning: 'This image may violate our content policy. Please choose another image.'
  },
  ro: {
    email: 'Email',
    email_ph: 'Introduceți emailul',
    password: 'Parolă',
    password_ph: 'Introduceți parola',
    sign_in: 'Autentificare',
    forgot_password: 'Ai uitat parola?',
    sign_up: 'Înregistrare',
    create_account_title: 'Creează cont',
    name: 'Nume',
    name_ph: 'Introduceți numele',
    confirm_password: 'Confirmă parola',
    confirm_password_ph: 'Confirmați parola',
    language: 'Limbă',
    create_account_btn: 'Creează cont',
    already_have_account: 'Ai deja un cont? Autentificare',
    allow_location: 'Folosește locația curentă',
    manual_location: 'Introdu manual',
    enter_city_ph: 'Introduceți numele orașului',
    continue: 'Continuă',
    exploring: 'Descoperiți',
    sales_in: 'Reduceri în',
    search_events_ph: 'Caută evenimente, locuri...',
    search_products_ph: 'Caută produse, servicii...',
    user_search_ph: 'Caută utilizatori...',
    for_you: 'Pentru tine',
    find_people: 'Găsește persoane',
    notifications: 'Notificări',
    account_settings: 'Setări cont',
    profile_level: 'Explorator urban',
    points: 'Puncte',
    day_streak: 'Zile la rând',
    my_posts: 'Postările mele',
    friends: 'Prieteni',
    followers_following: 'urmăritori •',
    feed: 'Flux',
    sales: 'Reduceri',
    alerts: 'Alerte',
    profile: 'Profil',
    log_out: 'Deconectare',
    app_title: 'Descoperă Orașul',
    discover_your_city: 'Descoperă orașul tău',
    location_prompt_desc: 'Spune-ne locația ta pentru a-ți arăta cele mai bune evenimente și descoperiri din apropiere!',
    // Create post modal
    create_post: 'Creează o postare',
    create_post_sub: 'Împărtășește ce ai în minte',
    create_sale: 'Fă un anunț de reducere',
    create_sale_sub: 'Promovează produsul sau serviciul tău',
    back_to_types: 'Înapoi la tipuri',
    post_title_sale_ph: 'Nume produs/serviciu',
    post_title_post_ph: 'La ce te gândești?',
    price_optional: 'Preț (opțional)',
    upload_image_optional: 'Încarcă imagine (opțional)',
    add_description_ph: 'Adaugă descriere...',
    hashtags_ph: '#hashtag-uri',
    submit_post_post: 'Publică postare',
    submit_post_sale: 'Publică anunț',
    // Users and profile
    posts_word: 'postări',
    followers_word: 'urmăritori',
    follow: 'Urmărește',
    following: 'Urmărit',
    send_message: 'Trimite mesaj',
    recent_posts: 'Postări recente',
    no_posts_yet: 'Nicio postare încă',
    // Sales card actions
    favorite: 'Favorite',
    delete: 'Șterge',
    // Dialogs and alerts
    confirm_delete_post: 'Ștergi această postare? Acțiunea nu poate fi anulată.',
    failed_delete: 'Ștergere eșuată. Încearcă din nou.',
    title_required: 'Titlul este obligatoriu',
    please_log_in_first: 'Autentifică-te mai întâi',
    session_expired: 'Sesiune expirată. Te rugăm să te autentifici din nou.',
    login_failed_generic: 'Autentificare eșuată. Încearcă din nou.',
    signup_failed_generic: 'Înregistrare eșuată. Încearcă din nou.',
    // Map and location
    requesting_location: 'Se solicită locația...',
    your_location: 'Locația ta',
    map_failed: 'Harta nu s-a încărcat. Reîncarcă pagina.',
    geo_permission_denied: 'Permite accesul la locație când ți se solicită.',
    geo_position_unavailable: 'Informațiile despre locație nu sunt disponibile.',
    geo_timeout: 'Cererea de obținere a locației a expirat.',
    geo_unknown_error: 'A apărut o eroare necunoscută.',
    // Account modal labels
    preferences: 'Preferințe',
    privacy: 'Confidențialitate',
    name_label: 'Nume:',
    email_label: 'Email:',
    member_since_label: 'Membru din:',
    dark_mode: 'Mod întunecat',
    location_sharing: 'Partajarea locației:',
    notifications_label: 'Notificări:',
    enabled: 'Activat',
    // Notifications modal texts
    post_liked: 'Postare apreciată',
    notification_word: 'Notificare',
    new_post_title: 'Postare nouă!',
    new_post_desc: 'Postare nouă creată de {{author}} — verifică!',
    no_notifications_title: 'Încă nu ai notificări',
    no_notifications_desc: 'Când vei avea notificări, vor apărea aici',
    // NSFW messages
    nsfw_model_loading: 'Modelul de siguranță se încarcă. Încearcă din nou în scurt timp.',
    nsfw_image_blocked: 'Imagine respinsă: conținut pentru adulți detectat. Alege o altă imagine.',
    nsfw_image_warning: 'Această imagine poate încălca politica noastră de conținut. Te rugăm să alegi altă imagine.'
  }
};
function t(key){ const lang = currentLang || 'en'; return (i18n[lang] && i18n[lang][key]) || (i18n.en && i18n.en[key]) || key; }
function applyLanguage(){
  currentLang = localStorage.getItem('lang') || currentLang || 'en';

  // Titles
  const loginLogoTitle = document.querySelector('.login-logo h1'); if (loginLogoTitle) loginLogoTitle.textContent = t('discover_your_city');
  const appTitle = document.querySelector('.app-title span'); if (appTitle) appTitle.textContent = t('app_title');

  // Login
  const emailLbl = document.querySelector('label[for="email"]'); if (emailLbl) emailLbl.textContent = t('email');
  const emailInp = document.getElementById('email'); if (emailInp) emailInp.placeholder = t('email_ph');
  const pwdLbl = document.querySelector('label[for="password"]'); if (pwdLbl) pwdLbl.textContent = t('password');
  const pwdInp = document.getElementById('password'); if (pwdInp) pwdInp.placeholder = t('password_ph');
  const loginBtn = document.querySelector('#loginForm .login-btn'); if (loginBtn) loginBtn.textContent = t('sign_in');
  const forgotA = document.querySelector('#loginForm .login-options a:first-child'); if (forgotA) forgotA.textContent = t('forgot_password');
  const signupA = document.getElementById('goToSignup'); if (signupA) signupA.textContent = t('sign_up');

  // Signup
  const signupTitle = document.querySelector('#signupPage .login-logo h1'); if (signupTitle) signupTitle.textContent = t('create_account_title');
  const nameLbl = document.querySelector('label[for="signupName"]'); if (nameLbl) nameLbl.textContent = t('name');
  const nameInp = document.getElementById('signupName'); if (nameInp) nameInp.placeholder = t('name_ph');
  const sEmailLbl = document.querySelector('label[for="signupEmail"]'); if (sEmailLbl) sEmailLbl.textContent = t('email');
  const sEmailInp = document.getElementById('signupEmail'); if (sEmailInp) sEmailInp.placeholder = t('email_ph');
  const sPwdLbl = document.querySelector('label[for="signupPassword"]'); if (sPwdLbl) sPwdLbl.textContent = t('password');
  const sPwdInp = document.getElementById('signupPassword'); if (sPwdInp) sPwdInp.placeholder = t('password_ph');
  const sCPLbl = document.querySelector('label[for="signupConfirm"]'); if (sCPLbl) sCPLbl.textContent = t('confirm_password');
  const sCPInp = document.getElementById('signupConfirm'); if (sCPInp) sCPInp.placeholder = t('confirm_password_ph');
  const sLangLbl = document.querySelector('label[for="signupLanguage"]'); if (sLangLbl) sLangLbl.textContent = t('language');
  const sBtn = document.querySelector('#signupForm .login-btn'); if (sBtn) sBtn.textContent = t('create_account_btn');
  const goLogin = document.getElementById('goToLogin'); if (goLogin) goLogin.textContent = t('already_have_account');

  // Location prompt
  const lp = document.getElementById('locationPrompt');
  if (lp) {
    const lpTitle = lp.querySelector('h2'); if (lpTitle) lpTitle.textContent = t('discover_your_city');
    const lpDesc = lp.querySelector('p'); if (lpDesc) lpDesc.textContent = t('location_prompt_desc');
  }
  const allowBtn = document.getElementById('allowLocation'); if (allowBtn) allowBtn.textContent = t('allow_location');
  const manualBtn = document.getElementById('manualLocation'); if (manualBtn) manualBtn.textContent = t('manual_location');
  const cityInput = document.getElementById('cityInput'); if (cityInput) cityInput.placeholder = t('enter_city_ph');
  const submitCity = document.getElementById('submitCity'); if (submitCity) submitCity.textContent = t('continue');

  // Placeholders & banners
  const search1 = document.querySelector('#feedView .search-input'); if (search1) search1.placeholder = t('search_events_ph');
  const search2 = document.querySelector('#salesView .search-input'); if (search2) search2.placeholder = t('search_products_ph');
  const userSearch = document.getElementById('userSearchInput'); if (userSearch) userSearch.placeholder = t('user_search_ph');
  const forYouBtn = document.querySelector('.category-btn.active'); if (forYouBtn) forYouBtn.textContent = t('for_you');
  const usersTitle = document.querySelector('.users-title'); if (usersTitle) usersTitle.textContent = t('find_people');

  // Banner leading text while keeping city spans
  const feedBanner = document.getElementById('locationBanner'); if (feedBanner && feedBanner.firstChild) feedBanner.firstChild.nodeValue = t('exploring') + ' ';
  const salesBanner = document.querySelector('#salesView .location-banner'); if (salesBanner && salesBanner.firstChild) salesBanner.firstChild.nodeValue = t('sales_in') + ' ';
  const mapBanner = document.getElementById('mapLocationBanner'); if (mapBanner && mapBanner.firstChild) mapBanner.firstChild.nodeValue = t('exploring') + ' ';
  const notifBanner = document.querySelector('#notificationsView .location-banner'); if (notifBanner && notifBanner.firstChild) notifBanner.firstChild.nodeValue = t('exploring') + ' ';
  const usersBanner = document.querySelector('#usersView .location-banner'); if (usersBanner && usersBanner.firstChild) usersBanner.firstChild.nodeValue = t('exploring') + ' ';

  // Modal titles & account labels
  const notifTitle = document.querySelector('#notificationsModal .modal-title'); if (notifTitle) notifTitle.textContent = t('notifications');
  const accTitle = document.querySelector('#accountModal .modal-title'); if (accTitle) accTitle.textContent = t('account_settings');

  const accSections = document.querySelectorAll('#accountModal .account-section');
  if (accSections[0]) {
    const h3 = accSections[0].querySelector('h3'); if (h3) h3.textContent = t('profile');
    const labels = accSections[0].querySelectorAll('strong');
    if (labels[0]) labels[0].textContent = t('name_label');
    if (labels[1]) labels[1].textContent = t('email_label');
    if (labels[2]) labels[2].textContent = t('member_since_label');
  }
  if (accSections[1]) {
    const h3 = accSections[1].querySelector('h3'); if (h3) h3.textContent = t('preferences');
    const dm = accSections[1].querySelector('.theme-toggle span'); if (dm) dm.textContent = t('dark_mode');
  }
  if (accSections[2]) {
    const h3 = accSections[2].querySelector('h3'); if (h3) h3.textContent = t('privacy');
    const p1 = accSections[2].querySelectorAll('p')[0]; if (p1) { const spans = p1.querySelectorAll('span'); if (spans[0]) spans[0].textContent = t('location_sharing'); if (spans[1]) spans[1].textContent = t('enabled'); }
    const p2 = accSections[2].querySelectorAll('p')[1]; if (p2) { const spans = p2.querySelectorAll('span'); if (spans[0]) spans[0].textContent = t('notifications_label'); if (spans[1]) spans[1].textContent = t('enabled'); }
  }

  // Profile sections
  const profileLevel = document.querySelector('.profile-level'); if (profileLevel) profileLevel.textContent = t('profile_level');
  const pointsLbl = document.querySelector('.stat-label'); if (pointsLbl) pointsLbl.textContent = t('points');
  const streakLbl = document.querySelectorAll('.stat-label')[1]; if (streakLbl) streakLbl.textContent = t('day_streak');
  const myPostsTitle = document.querySelectorAll('.section-title')[0]; if (myPostsTitle) myPostsTitle.textContent = t('my_posts');
  const friendsTitle = document.querySelectorAll('.section-title')[1]; if (friendsTitle) friendsTitle.textContent = t('friends');

  // Bottom nav
  const feedNav = document.querySelector('.bottom-nav [data-view="feed"] span'); if (feedNav) feedNav.textContent = t('feed');
  const salesNav = document.querySelector('.bottom-nav [data-view="sales"] span'); if (salesNav) salesNav.textContent = t('sales');
  const alertsNav = document.querySelector('.bottom-nav [data-view="notifications"] span'); if (alertsNav) alertsNav.textContent = t('alerts');
  const profileNav = document.querySelector('.bottom-nav [data-view="profile"] span'); if (profileNav) profileNav.textContent = t('profile');

  // Logout
  const logoutBtnEl = document.getElementById('logoutBtn'); if (logoutBtnEl) logoutBtnEl.textContent = t('log_out');
}

// DOM Elements
const loginPage = document.getElementById('loginPage');
const mainApp = document.getElementById('mainApp');
const loginForm = document.getElementById('loginForm');
const signupPage = document.getElementById('signupPage');
const signupForm = document.getElementById('signupForm');
const signupLanguage = document.getElementById('signupLanguage');
const goToSignup = document.getElementById('goToSignup');
const goToLogin = document.getElementById('goToLogin');
const locationPrompt = document.getElementById('locationPrompt');
const allowLocationBtn = document.getElementById('allowLocation');
const manualLocationBtn = document.getElementById('manualLocation');
const manualInput = document.getElementById('manualInput');
const cityInput = document.getElementById('cityInput');
const submitCityBtn = document.getElementById('submitCity');
const cityNameElement = document.getElementById('cityName');
const mapCityNameElement = document.getElementById('mapCityName');
const notifCityNameElement = document.getElementById('notifCityName');
const usersCityNameElement = document.getElementById('usersCityName');
const navItems = document.querySelectorAll('.nav-item');
const views = document.querySelectorAll('.view');
const addPostBtn = document.getElementById('addPostBtn');
const postModal = document.getElementById('postModal');
const closeModal = document.getElementById('closeModal');
const modalContent = document.getElementById('modalContent');
const categoryBtns = document.querySelectorAll('.category-btn');
const postsContainer = document.getElementById('postsContainer');
const mapPostsContainer = document.getElementById('mapPostsContainer');
const notificationsContainer = document.getElementById('notificationsContainer');
const userSearchInput = document.getElementById('userSearchInput');
const usersContainer = document.getElementById('usersContainer');
const userProfileModal = document.getElementById('userProfileModal');
const closeUserProfile = document.getElementById('closeUserProfile');
const userProfileName = document.getElementById('userProfileName');
const userProfileContent = document.getElementById('userProfileContent');
const profileAvatar = document.getElementById('profileAvatar');
const accountModal = document.getElementById('accountModal');
const closeAccountModal = document.getElementById('closeAccountModal');
const darkModeToggle = document.getElementById('darkModeToggle');
const logoutBtn = document.getElementById('logoutBtn');
const notificationsBtn = document.getElementById('notificationsBtn');
const notificationsModal = document.getElementById('notificationsModal');
const closeNotificationsModal = document.getElementById('closeNotificationsModal');
const notificationsModalContent = document.getElementById('notificationsModalContent');
const openStreetMapElement = document.getElementById('openStreetMap');
const salesContainer = document.getElementById('salesContainer');
const salesCityNameElement = document.getElementById('salesCityName');

// Current state
let currentView = 'feed';
let currentPostType = '';
let selectedCategory = 'all';
let following = new Set([1, 3]);

// Initialize
function init() {
    setupEventListeners();
    // Preload safety model in background
    loadNSFWModel();
    checkDarkModePreference();
    applyLanguage();
    checkAuth();
    const badge = document.querySelector('.notification-badge'); if (badge) badge.style.display = 'none';
}

// Check if user is already logged in
function checkAuth() {
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');
    
    if (token && user) {
        loginPage.style.display = 'none';
        mainApp.style.display = 'block';
        try {
            const userObj = JSON.parse(user);
            updateProfileUI(userObj);
        } catch (e) {}
        fetchNotifications();
        const city = document.getElementById('cityName').textContent;
        if (city === 'Your City') {
            showLocationPrompt();
        } else {
            fetchPosts();
        }
        applyLanguage();
    }
}

// Setup event listeners
function setupEventListeners() {
    // Auth page navigation
    if (goToSignup) {
        goToSignup.addEventListener('click', (e) => {
            e.preventDefault();
            loginPage.style.display = 'none';
            signupPage.style.display = 'flex';
        });
    }
    if (goToLogin) {
        goToLogin.addEventListener('click', (e) => {
            e.preventDefault();
            signupPage.style.display = 'none';
            loginPage.style.display = 'flex';
        });
    }

    // Signup form -> register user then auto-login
    if (signupForm) {
        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('signupName').value.trim();
            const email = document.getElementById('signupEmail').value.trim();
            const password = document.getElementById('signupPassword').value;
            const confirm = document.getElementById('signupConfirm').value;
            const lang = (document.getElementById('signupLanguage')?.value) || 'en';

            if (password !== confirm) {
                alert('Passwords do not match');
                return;
            }

            try {
                const response = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, password })
                });

                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || 'Registration failed');
                }

                // If backend returns token, log user in immediately
                if (data.token) {
                    localStorage.setItem('token', data.token);
                    localStorage.setItem('user', JSON.stringify(data.user));
                    localStorage.setItem('lang', lang);
                    currentLang = lang;
                    applyLanguage();
                    updateProfileUI(data.user);
                    signupPage.style.display = 'none';
                    mainApp.style.display = 'block';
                    showLocationPrompt();
                } else {
                    alert('Account created. Please sign in.');
                    signupPage.style.display = 'none';
                    loginPage.style.display = 'flex';
                }
            } catch (error) {
                alert('Sign up failed: ' + error.message);
            }
        });
    }

    // Login form - REAL backend integration
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        
        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });
            
            const data = await response.json();
            
            if (data.token) {
                localStorage.setItem('token', data.token);
                localStorage.setItem('user', JSON.stringify(data.user));
                
                updateProfileUI(data.user);
                loginPage.style.display = 'none';
                mainApp.style.display = 'block';
                showLocationPrompt();
                fetchNotifications();
            } else {
                alert('Login failed: ' + (data.error || 'Invalid credentials'));
            }
        } catch (error) {
            alert('Login failed. Please make sure the server is reachable.');
            console.error('Login error:', error);
        }
    });

    // Location prompt
    allowLocationBtn.addEventListener('click', getLocation);
    manualLocationBtn.addEventListener('click', () => {
        manualInput.style.display = 'block';
    });
    submitCityBtn.addEventListener('click', setCityManually);
    cityInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            setCityManually();
        }
    });

    // Navigation
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const view = item.getAttribute('data-view');
            switchView(view);
        });
    });

    // Profile avatar click
    profileAvatar.addEventListener('click', () => {
        accountModal.classList.add('active');
    });

    // Account modal
    closeAccountModal.addEventListener('click', () => {
        accountModal.classList.remove('active');
    });
    accountModal.addEventListener('click', (e) => {
        if (e.target === accountModal) {
            accountModal.classList.remove('active');
        }
    });

    // Dark mode toggle
    darkModeToggle.addEventListener('change', toggleDarkMode);

    // Logout
    logoutBtn.addEventListener('click', logout);

    // Add post button
    addPostBtn.addEventListener('click', () => {
        showPostModal();
    });

    // Close modals
    closeModal.addEventListener('click', hidePostModal);
    postModal.addEventListener('click', (e) => {
        if (e.target === postModal) {
            hidePostModal();
        }
    });
    closeUserProfile.addEventListener('click', hideUserProfileModal);
    userProfileModal.addEventListener('click', (e) => {
        if (e.target === userProfileModal) {
            hideUserProfileModal();
        }
    });
    closeNotificationsModal.addEventListener('click', () => {
        notificationsModal.classList.remove('active');
    });
    notificationsModal.addEventListener('click', (e) => {
        if (e.target === notificationsModal) {
            notificationsModal.classList.remove('active');
        }
    });

    // Notifications button
    notificationsBtn.addEventListener('click', () => {
        showNotificationsModal();
    });

    // Category filtering
    categoryBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            categoryBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedCategory = btn.getAttribute('data-category');
            renderPosts();
        });
    });

    // Like buttons - Toggle like/unlike
    document.addEventListener('click', (e) => {
      const heartBtn = e.target.closest('.action-btn.heart') || e.target.closest('.action-btn-vertical.heart');
      if (!heartBtn) return;
      
      const postCard = heartBtn.closest('.post-card');
      const postId = postCard?.dataset.postId;
      if (!postId) return;

      const countEl = heartBtn.querySelector('span');
      let count = parseInt(countEl.textContent);

      const isLiking = !likedPosts.has(postId);
      
      if (!isLiking) {
          count = Math.max(0, count - 1);
          countEl.textContent = count;
          heartBtn.style.color = 'white';
          likedPosts.delete(postId);
      } else {
          count = count + 1;
          countEl.textContent = count;
          heartBtn.style.color = '#ef4444';
          likedPosts.add(postId);
      }

      const token = localStorage.getItem('token');
      if (token) {
          fetch(`/api/posts/${postId}/like`, {
              method: 'PUT',
              headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json'
              }
          })
          .then(res => res.json())
          .then(data => {
              const post = posts.find(p => p.id === postId);
              if (post) {
                  post.likes = data.likes;
                  countEl.textContent = data.likes;
              }
          })
          .catch(err => console.error('Like sync failed:', err));
      }
    });

    // Post submission
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('submit-btn') || e.target.closest('.submit-btn')) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            submitPost(e);
            return false;
        }
    }, true);

    // User search
    userSearchInput.addEventListener('input', () => {
        const searchTerm = userSearchInput.value.toLowerCase();
        renderUsers(searchTerm);
    });

    // Follow buttons
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('follow-btn') || e.target.classList.contains('following-btn')) {
            const userId = parseInt(e.target.dataset.userId);
            toggleFollow(userId, e.target);
        }
    });

    // Contact buttons
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('contact-btn')) {
            const userId = parseInt(e.target.dataset.userId);
            const user = users.find(u => u.id === userId);
            if (user) {
                showUserProfile(user);
            }
        }
    });
}

// Login functions
function showLocationPrompt() {
    locationPrompt.style.display = 'flex';
}

function hideLocationPrompt() {
    locationPrompt.style.display = 'none';
    updateCityDisplay();
}

function getLocation() {
    if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser. Please enter your location manually.');
        manualInput.style.display = 'block';
        return;
    }
    
    allowLocationBtn.textContent = t('requesting_location');
    allowLocationBtn.disabled = true;
    
    navigator.geolocation.getCurrentPosition(
        (position) => {
            userLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            userCityName = t('your_location');
            hideLocationPrompt();
            allowLocationBtn.textContent = t('allow_location');
            allowLocationBtn.disabled = false;
            
            if (currentView === 'map' || !mapInitialized) {
                initializeMap();
            }
            updateCityDisplayWithCoordinates();
            fetchPosts();
        },
        (error) => {
            console.log('Location error:', error);
            let errorMessage = '';
            switch(error.code) {
                case error.PERMISSION_DENIED:
                    errorMessage = t('geo_permission_denied');
                    break;
                case error.POSITION_UNAVAILABLE:
                    errorMessage = t('geo_position_unavailable');
                    break;
                case error.TIMEOUT:
                    errorMessage = t('geo_timeout');
                    break;
                default:
                    errorMessage = t('geo_unknown_error');
                    break;
            }
            alert(errorMessage);
            manualInput.style.display = 'block';
            allowLocationBtn.textContent = t('allow_location');
            allowLocationBtn.disabled = false;
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}

function setCityManually() {
    const city = cityInput.value.trim();
    if (city) {
        userCityName = city;
        hideLocationPrompt();
        userLocation = { lat: 37.7749, lng: -122.4194 };
        if (currentView === 'map' || !mapInitialized) {
            initializeMap();
        }
        fetchPosts();
    }
}

function updateCityDisplay() {
    cityNameElement.textContent = userCityName;
    mapCityNameElement.textContent = userCityName;
    notifCityNameElement.textContent = userCityName;
    usersCityNameElement.textContent = userCityName;
    if (salesCityNameElement) salesCityNameElement.textContent = userCityName;
}

function updateCityDisplayWithCoordinates() {
    if (userLocation) {
        const cityDisplay = `(${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)})`;
        cityNameElement.textContent = cityDisplay;
        mapCityNameElement.textContent = cityDisplay;
        notifCityNameElement.textContent = cityDisplay;
        usersCityNameElement.textContent = cityDisplay;
        if (salesCityNameElement) salesCityNameElement.textContent = cityDisplay;
    } else {
        updateCityDisplay();
    }
}

// Initialize OpenStreetMap
function initializeMap() {
    if (!openStreetMapElement) return;
    openStreetMapElement.innerHTML = '';
    
    if (!userLocation) {
        userLocation = { lat: 37.7749, lng: -122.4194 };
    }
    
    try {
        map = L.map('openStreetMap').setView([userLocation.lat, userLocation.lng], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);
        mapInitialized = true;
        
        L.marker([userLocation.lat, userLocation.lng])
            .addTo(map)
            .bindPopup(t('your_location'))
            .openPopup();
            
        markers = [];
        posts.forEach(post => {
            if (post.lat && post.lng) {
                const marker = L.marker([post.lat, post.lng]).addTo(map);
                marker.bindPopup(`<b>${post.title}</b><br>${post.location}<br>${post.distance}`);
                markers.push(marker);
            }
        });
        renderMapPosts();
    } catch (error) {
        console.error('Error initializing map:', error);
        openStreetMapElement.innerHTML = `
            <div style="height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--gray-600);">
                <i class="fas fa-exclamation-triangle" style="font-size: 48px; margin-bottom: 16px; color: var(--danger);"></i>
                <p>${t('map_failed')}</p>
            </div>
        `;
    }
}

// Dark mode functions
function checkDarkModePreference() {
    const isDarkMode = localStorage.getItem('darkMode') === 'true';
    darkModeToggle.checked = isDarkMode;
    if (isDarkMode) {
        document.body.classList.add('dark-mode');
    }
}

function toggleDarkMode() {
    const isDarkMode = darkModeToggle.checked;
    localStorage.setItem('darkMode', isDarkMode);
    if (isDarkMode) {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }
    
    if (map && currentView === 'map') {
        mapInitialized = false;
        initializeMap();
    }
}

// Profile helpers
function getInitials(name) {
    if (!name) return '';
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] || '';
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase();
}

function updateProfileUI(user) {
    const name = user?.name || '';
    const email = user?.email || '';
    const initials = getInitials(name);

    const avatarEl = document.getElementById('profileAvatar');
    const avatarLargeEl = document.getElementById('profileAvatarLarge');
    const nameEl = document.getElementById('profileNameText');
    const accountNameEl = document.getElementById('accountName');
    const accountEmailEl = document.getElementById('accountEmail');
    const followersEl = document.getElementById('followersCount');
    const followingEl = document.getElementById('followingCount');
    const pointsEl = document.getElementById('pointsValue');
    const streakEl = document.getElementById('streakValue');
    const myPostsEl = document.getElementById('myPostsCounts');

    if (avatarEl) avatarEl.textContent = initials;
    if (avatarLargeEl) avatarLargeEl.textContent = initials;
    if (nameEl) nameEl.textContent = name;
    if (accountNameEl) accountNameEl.textContent = name;
    if (accountEmailEl) accountEmailEl.textContent = email;

    if (followersEl) followersEl.textContent = String(user?.followers ?? 0);
    if (followingEl) followingEl.textContent = String(user?.following ?? 0);

    if (pointsEl) pointsEl.textContent = '0';
    if (streakEl) streakEl.textContent = '0';
    if (myPostsEl) myPostsEl.textContent = '0 events • 0 discoveries • 0 challenges';
}

async function fetchNotifications() {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
        const res = await fetch('/api/notifications', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (Array.isArray(data)) {
            appNotifications = data;
            updateNotificationBadge();
        }
    } catch (e) {
        console.error('Failed to fetch notifications', e);
    }
}

function updateNotificationBadge() {
    const hasUnread = appNotifications.some(n => !n.read);
    const badge = document.querySelector('.notification-badge');
    if (badge) badge.style.display = hasUnread ? 'block' : 'none';
}

// Logout function
function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    accountModal.classList.remove('active');
    mainApp.style.display = 'none';
    loginPage.style.display = 'flex';
    document.getElementById('email').value = '';
    document.getElementById('password').value = '';
}

// Switch views
function switchView(view) {
    views.forEach(v => v.classList.remove('active'));
    document.getElementById(`${view}View`).classList.add('active');
    
    navItems.forEach(item => {
        if (item.getAttribute('data-view') === view) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
    
    currentView = view;
    
    if (view === 'map' && !mapInitialized && userLocation) {
        initializeMap();
    }
}

// Show post modal
function showPostModal() {
    currentPostType = '';
    renderPostModal();
    postModal.classList.add('active');
}

// Hide post modal
function hidePostModal() {
    postModal.classList.remove('active');
}

// Render post modal (i18n)
function renderPostModal() {
    if (!currentPostType) {
        modalContent.innerHTML = `
            <div class="post-type-option" onclick="selectPostType('post')">
                <div class="post-type-icon event">
                    <i class="fas fa-pen"></i>
                </div>
                <div class="post-type-info">
                    <h3>${t('create_post')}</h3>
                    <p>${t('create_post_sub')}</p>
                </div>
            </div>
            <div class="post-type-option" onclick="selectPostType('sale')">
                <div class="post-type-icon discovery">
                    <i class="fas fa-tag"></i>
                </div>
                <div class="post-type-info">
                    <h3>${t('create_sale')}</h3>
                    <p>${t('create_sale_sub')}</p>
                </div>
            </div>
        `;
    } else {
        modalContent.innerHTML = `
            <button type="button" class="back-btn" onclick="goBackToTypes()">
                <i class="fas fa-arrow-left"></i>
                ${t('back_to_types')}
            </button>
            <div class="form-group">
                <input type="text" id="postTitle" class="form-input" placeholder="${currentPostType === 'sale' ? t('post_title_sale_ph') : t('post_title_post_ph')}" required>
            </div>
            ${currentPostType === 'sale' ? `
            <div class="form-group">
                <input type="text" id="postPrice" class="form-input" placeholder="${t('price_optional')}">
            </div>
            ` : ''}
            <div class="form-group">
                <label class="image-upload" id="imageUploadLabel">
                    <i class="fas fa-cloud-upload-alt"></i>
                    <p>${t('upload_image_optional')}</p>
                </label>
                <input type="file" id="postImage" accept="image/*" style="display: none;">
                <img id="imagePreview" class="image-preview" src="" alt="Preview">
                <div id="nsfwWarning" style="display:none;color: var(--danger); font-size: 12px; margin-top: 8px;"></div>
            </div>
            <div class="form-group">
                <textarea id="postDescription" class="form-textarea" placeholder="${t('add_description_ph')}"></textarea>
            </div>
            <div class="form-group">
                <div class="hashtag-group">
                    <input type="text" id="postHashtags" class="form-input hashtag-input" placeholder="${t('hashtags_ph')}">
                    <button type="button" class="hashtag-btn">
                        <i class="fas fa-hashtag"></i>
                    </button>
                </div>
            </div>
            <button type="button" class="submit-btn" id="submitPostBtn">${currentPostType === 'sale' ? t('submit_post_sale') : t('submit_post_post')}</button>
        `;

        // Image upload
        const imageUploadLabel = document.getElementById('imageUploadLabel');
        const postImage = document.getElementById('postImage');
        const imagePreview = document.getElementById('imagePreview');

        if (imageUploadLabel && postImage && imagePreview) {
            imageUploadLabel.onclick = function(e) {
                e.preventDefault();
                postImage.click();
                return false;
            };

            const nsfwWarning = document.getElementById('nsfwWarning');
            postImage.onchange = async function(e) {
                if (e.target.files && e.target.files[0]) {
                    const file = e.target.files[0];
                    // Run safety check
                    const safe = await isImageSafeFromFile(file);
                    if (!safe) {
                        if (nsfwWarning) {
                            nsfwWarning.textContent = t('nsfw_image_warning');
                            nsfwWarning.style.display = 'block';
                        }
                        imagePreview.src = '';
                        imagePreview.style.display = 'none';
                        postImage.value = '';
                        return;
                    }
                    if (nsfwWarning) nsfwWarning.style.display = 'none';
                    const reader = new FileReader();
                    reader.onload = function(e) {
                        imagePreview.src = e.target.result;
                        imagePreview.style.display = 'block';
                    };
                    reader.readAsDataURL(file);
                }
            };
        }
        
        // Submit button
        const submitBtn = document.getElementById('submitPostBtn');
        if (submitBtn) {
            submitBtn.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                submitPost();
                return false;
            };
        }
        
        // Prevent form submit if any form exists
        const postForm = document.getElementById('postForm');
        if (postForm) {
            postForm.onsubmit = function(e) {
                e.preventDefault();
                return false;
            };
        }
    }
}

// Select post type
function selectPostType(type) {
    currentPostType = type;
    renderPostModal();
}

// Go back to post types
function goBackToTypes() {
    currentPostType = '';
    renderPostModal();
}

// Helper function for default images
function getDefaultImage(type) {
    switch(type) {
        case 'event': return 'https://placehold.co/400x250/3b82f6/white?text=Event';
        case 'discovery': return 'https://placehold.co/400x250/8b5cf6/white?text=Discovery';
        case 'challenge': return 'https://placehold.co/400x250/10b981/white?text=Challenge';
        default: return 'https://placehold.co/400x250/gray/white?text=Post';
    }
}

// Submit post with image upload
async function submitPost(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }
    
    console.log('submitPost called');
    const title = document.getElementById('postTitle')?.value;
    if (!title) {
        alert(t('title_required'));
        return false;
    }

    const postImage = document.getElementById('postImage');

    // If there's an image, ensure it's safe before uploading
    if (postImage && postImage.files && postImage.files[0]) {
        if (!nsfwModel && nsfwLoading) {
            alert(t('nsfw_model_loading'));
            return false;
        }
        const ok = await isImageSafeFromFile(postImage.files[0]);
        if (!ok) {
            alert(t('nsfw_image_blocked'));
            return false;
        }
    }

    const formData = new FormData();
    
    if (postImage && postImage.files[0]) {
        formData.append('image', postImage.files[0]);
    }
    
    const postData = {
        title: title,
        description: document.getElementById('postDescription')?.value || '',
        type: currentPostType,
        location: document.getElementById('postLocation')?.value || userCityName,
        lat: userLocation ? userLocation.lat : 37.7749,
        lng: userLocation ? userLocation.lng : -122.4194,
        hashtags: document.getElementById('postHashtags')?.value?.split(',').map(tag => tag.trim()).filter(tag => tag) || [],
        category: 'all',
        price: currentPostType === 'sale' ? document.getElementById('postPrice')?.value || '' : ''
    };
    
    formData.append('data', JSON.stringify(postData));
    
    const token = localStorage.getItem('token');
    if (!token) {
        alert(t('please_log_in_first'));
        return;
    }
    
    console.log('🚀 Starting fetch with token:', token.substring(0, 20) + '...');
    
    fetch('/api/posts', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`
        },
        body: formData
    })
    .then(async (response) => {
        console.log('📡 Response received, status:', response.status);
        console.log('📡 Response headers:', Object.fromEntries([...response.headers]));
        
        if (response.status === 401 || response.status === 403) {
            console.error('❌ Unauthorized - token might be expired');
            alert(t('session_expired'));
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            loginPage.style.display = 'flex';
            mainApp.style.display = 'none';
            throw new Error('Unauthorized');
        }
        if (!response.ok) {
            let msg = 'Failed to create post';
            try {
                const err = await response.json();
                if (err?.error) msg = err.error;
            } catch {}
            throw new Error(msg);
        }
        return response.json();
    })
    .then(post => {
        console.log('✅ Step 1: Post created successfully:', post);
        
        const newPost = {
            id: post._id,
            type: post.type,
            title: post.title,
            category: post.category || 'all',
            distance: '0.1 km',
            time: 'Just now',
            likes: post.likes ? post.likes.length : 0,
            comments: post.comments ? post.comments.length : 0,
            rsvp: post.rsvp || 0,
            image: post.image ? `${post.image}` : getDefaultImage(post.type),
            location: post.location,
            author: post.author?.name || 'You',
            authorId: (post.author && (post.author._id || post.author.id)) ? String(post.author._id || post.author.id) : '',
            lat: post.coordinates?.lat,
            lng: post.coordinates?.lng,
            description: post.description || '',
            price: post.price || '',
            hashtags: post.hashtags || []
        };
        console.log('✅ Step 2: newPost object created');

        posts.unshift(newPost);
        console.log('✅ Step 3: Added to posts array');
        
        try {
            renderPosts();
            console.log('✅ Step 4: renderPosts() completed');
        } catch (err) {
            console.error('❌ Error in renderPosts:', err);
        }
        
        try {
            renderSalesPosts();
            console.log('✅ Step 5: renderSalesPosts() completed');
        } catch (err) {
            console.error('❌ Error in renderSalesPosts:', err);
        }
        
        try {
            renderMapPosts();
            console.log('✅ Step 6: renderMapPosts() completed');
        } catch (err) {
            console.error('❌ Error in renderMapPosts:', err);
        }
        
        if (map) {
            const marker = L.marker([newPost.lat, newPost.lng]).addTo(map);
            marker.bindPopup(`<b>${newPost.title}</b><br>${newPost.location}<br>${newPost.distance}`);
            markers.push(marker);
            console.log('✅ Step 7: Map marker added');
        }
        
        hidePostModal();
        console.log('✅ Step 8: Modal hidden');
        
        currentPostType = '';

        hasNewPostNotification = true;
        document.querySelector('.notification-badge').style.display = 'block';
        console.log('✅ Step 9: ALL DONE - NO RELOAD SHOULD HAPPEN');

        // Ensure feed/map reflect server truth
        try { fetchPosts(); } catch (_) {}
    
    })
    .catch(error => {
        console.error('Error creating post:', error);
        alert(error.message || 'Failed to create post. Please try again.');
        // Even on error, refresh feed so user doesn't need manual reload
        try { fetchPosts(); } catch (_) {}
        // In case of transient network issues, retry once shortly
        setTimeout(() => { try { fetchPosts(); } catch (_) {} }, 1500);
    });
}

// Render posts to the DOM (exclude sales posts from main feed)
function renderPosts() {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const currentUserId = String(user.id || user._id || '');
    const filteredPosts = posts.filter(post => post.type !== 'sale');
    postsContainer.innerHTML = filteredPosts.map(post => `
        <div class="post-card" data-post-id="${post.id}">
            <img src="${post.image}" alt="${post.title}" class="post-image">
            <span class="post-type ${post.type}">${post.type}</span>
            
            <!-- Bottom left overlay info -->
            <div class="post-overlay-info">
                <h3 class="post-title-overlay">${post.title}</h3>
                <div class="post-meta">
                    <span><i class="fas fa-user"></i> ${post.author}</span>
                    <span><i class="fas fa-map-marker-alt"></i> ${post.location}</span>
                </div>
            </div>
            
            <!-- Right side action buttons -->
            <div class="post-actions-vertical">
                <button class="action-btn-vertical heart" style="color: ${likedPosts.has(post.id) ? '#ef4444' : 'white'};">
                    <i class="fas fa-heart"></i>
                    <span>${post.likes}</span>
                </button>
                <button class="action-btn-vertical comment">
                    <i class="fas fa-comment"></i>
                    <span>${post.comments}</span>
                </button>
                ${post.type === 'event' ? `
                <button class="action-btn-vertical rsvp">
                    <i class="fas fa-users"></i>
                    <span>${post.rsvp}</span>
                </button>
                ` : ''}
                <button class="action-btn-vertical share">
                    <i class="fas fa-share"></i>
                </button>
                ${post.authorId === currentUserId ? `
                <button class="action-btn-vertical delete" title="${t('delete')}">
                    <i class="fas fa-trash"></i>
                </button>
                ` : ''}
            </div>
        </div>
    `).join('');
}

// Delete post (author only)
document.addEventListener('click', async (e) => {
    const delBtn = e.target.closest('.action-btn-vertical.delete') || e.target.closest('.sale-action-btn.delete');
    if (!delBtn) return;
    const postCard = delBtn.closest('[data-post-id]');
    const postId = postCard?.dataset.postId;
    if (!postId) return;
    if (!confirm(t('confirm_delete_post'))) return;
    const token = localStorage.getItem('token');
    try {
        const res = await fetch(`/api/posts/${postId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert('Failed to delete: ' + (err.error || res.status));
            return;
        }
        posts = posts.filter(p => p.id !== postId);
        renderPosts();
        renderSalesPosts();
        if (map) { mapInitialized = false; initializeMap(); }
    } catch (err) {
        alert(t('failed_delete'));
        console.error('Delete error:', err);
    }
});

// Render map posts
function renderMapPosts() {
    mapPostsContainer.innerHTML = posts.slice(0, 3).map(post => `
        <div class="post-card" data-post-id="${post.id}">
            <div class="post-content">
                <h3 class="post-title">${post.title}</h3>
                <p class="post-info">${post.location} • ${post.distance}</p>
            </div>
        </div>
    `).join('');
}

// Fetch posts from backend
async function fetchPosts() {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
        const response = await fetch('/api/posts', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.status === 401) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            loginPage.style.display = 'flex';
            mainApp.style.display = 'none';
            return;
        }

        const postsData = await response.json();

        // Get current user ID (ensure it's a string)
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        const currentUserId = String(user.id); // Convert to string to ensure consistent comparison

        // Reset likedPosts
        likedPosts = new Set();

        // Process posts and check likes
        posts = postsData.map(post => {
            // Check if current user liked this post
            const isLiked = post.likes && post.likes.some(like => {
                const likeIdStr = typeof like === 'object' && like._id 
                    ? String(like._id) 
                    : String(like);
                return likeIdStr === currentUserId;
            });
            
            if (isLiked) {
                likedPosts.add(post._id);
            }

            return {
                id: post._id,
                type: post.type,
                title: post.title,
                category: post.category || 'all',
                distance: post.distance || '0.1 km',
                time: post.createdAt ? new Date(post.createdAt).toLocaleString() : 'Just now',
                likes: post.likes ? post.likes.length : 0,
                comments: post.comments ? post.comments.length : 0,
                rsvp: post.rsvp || 0,
                image: post.image ? `${post.image}` : getDefaultImage(post.type),
                location: post.location,
                author: post.author?.name || 'Unknown',
                authorId: (post.author && (post.author._id || post.author.id)) ? String(post.author._id || post.author.id) : '',
                lat: post.coordinates?.lat,
                lng: post.coordinates?.lng,
                description: post.description || '',
                price: post.price || '',
                hashtags: post.hashtags || []
            };
        });

        renderPosts();
        renderSalesPosts();
    } catch (error) {
        console.error('Error fetching posts:', error);
    }
}

// Render sales posts
function renderSalesPosts() {
    const salesPosts = posts.filter(post => post.type === 'sale');
    if (!salesContainer) return;
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const currentUserId = String(user.id || user._id || '');
    
    salesContainer.innerHTML = salesPosts.map(post => `
        <div class="sale-card" data-post-id="${post.id}">
            <div class="sale-image-container">
                <img src="${post.image}" alt="${post.title}" class="sale-image">
            </div>
            <div class="sale-info-board">
                <h3 class="sale-title" style="margin-bottom: 12px;">${post.title}</h3>
                ${post.price ? `<div class="sale-price" style="margin-bottom: 12px;">${post.price}</div>` : ''}
                ${post.description ? `<p class="sale-description" style="font-weight: 700; color: var(--gray-900); margin-bottom: 16px;">${post.description}</p>` : ''}
                <div class="sale-meta">
                    <div class="sale-meta-item">
                        <i class="fas fa-user"></i>
                        <span>${post.author}</span>
                    </div>
                    <div class="sale-meta-item">
                        <i class="fas fa-map-marker-alt"></i>
                        <span>${post.location}</span>
                    </div>
                    <div class="sale-meta-item">
                        <i class="fas fa-clock"></i>
                        <span>${post.time}</span>
                    </div>
                </div>
                ${post.hashtags && post.hashtags.length > 0 ? `
                    <div class="sale-hashtags">
                        ${post.hashtags.map(tag => `<span class="hashtag">#${tag}</span>`).join('')}
                    </div>
                ` : ''}
                <div class="sale-actions">
                    <button class="sale-action-btn favorite" style="color: ${likedPosts.has(post.id) ? '#f59e0b' : '#64748b'};">
                        <i class="fas fa-star"></i>
                        <span>${t('favorite')}</span>
                    </button>
                    ${post.authorId === currentUserId ? `
                    <button class="sale-action-btn delete">
                        <i class="fas fa-trash"></i>
                        <span>${t('delete')}</span>
                    </button>
                    ` : ''}
                </div>
            </div>
        </div>
    `).join('');
}

// Render users
function renderUsers(searchTerm = '') {
    const filteredUsers = searchTerm 
        ? users.filter(user => user.name.toLowerCase().includes(searchTerm))
        : users;
    
    usersContainer.innerHTML = filteredUsers.map(user => `
        <div class="user-card">
            <div class="user-avatar">${user.avatar}</div>
            <div class="user-info">
                <div class="user-name">${user.name}</div>
                <div class="user-stats">${user.posts} ${t('posts_word')} • ${user.followers} ${t('followers_word')}</div>
            </div>
            <div class="user-actions">
                <button class="${following.has(user.id) ? 'following-btn' : 'follow-btn'}" data-user-id="${user.id}">
                    ${following.has(user.id) ? t('following') : t('follow')}
                </button>
                <button class="contact-btn" data-user-id="${user.id}">
                    <i class="fas fa-envelope"></i>
                </button>
            </div>
        </div>
    `).join('');
}

// Toggle follow
function toggleFollow(userId, button) {
    if (following.has(userId)) {
        following.delete(userId);
        button.textContent = t('follow');
        button.classList.remove('following-btn');
        button.classList.add('follow-btn');
    } else {
        following.add(userId);
        button.textContent = t('following');
        button.classList.remove('follow-btn');
        button.classList.add('following-btn');
    }
}

// Show user profile modal
function showUserProfile(user) {
    userProfileName.textContent = user.name;
    userProfileContent.innerHTML = `
        <div style="text-align: center; margin-bottom: 24px;">
            <div class="user-avatar" style="width: 64px; height: 64px; margin: 0 auto 16px;">${user.avatar}</div>
            <div style="font-weight: 600; margin-bottom: 8px;">${user.name}</div>
            <div style="color: var(--gray-600); font-size: 14px;">${user.posts} ${t('posts_word')} • ${user.followers} ${t('followers_word')}</div>
        </div>
        <div style="margin-bottom: 16px;">
            <h3 style="font-weight: 600; margin-bottom: 8px;">${t('recent_posts')}</h3>
            <div style="max-height: 200px; overflow-y: auto;">
                ${posts.filter(post => post.author === user.name).slice(0, 3).map(post => `
                    <div class="post-card" style="margin-bottom: 12px;">
                        <img src="${post.image}" alt="${post.title}" class="post-image" style="height: 120px;">
                        <div class="post-content" style="padding: 12px;">
                            <h4 class="post-title" style="font-size: 14px; margin-bottom: 4px;">${post.title}</h4>
                            <div class="post-info" style="font-size: 11px;">
                                <i class="fas fa-clock"></i> ${post.time}
                            </div>
                        </div>
                    </div>
                `).join('') || `<p style="color: var(--gray-600); text-align: center;">${t('no_posts_yet')}</p>`}
            </div>
        </div>
        <div style="display: flex; gap: 12px;">
            <button class="follow-btn" style="flex: 1;" data-user-id="${user.id}">
                ${following.has(user.id) ? t('following') : t('follow')}
            </button>
            <button class="contact-btn" style="flex: 1;" onclick="sendMessage('${user.name}')">
                ${t('send_message')}
            </button>
        </div>
    `;
    userProfileModal.classList.add('active');
}

// Hide user profile modal
function hideUserProfileModal() {
    userProfileModal.classList.remove('active');
}

// Send message (placeholder)
function sendMessage(username) {
    alert(`${t('send_message')} ${username}!`);
    hideUserProfileModal();
}

// Show notifications modal
async function showNotificationsModal() {
    await fetchNotifications();

    if (appNotifications.length > 0) {
        notificationsModalContent.innerHTML = `
            <div style="padding: 8px 0; display: flex; flex-direction: column; gap: 12px;">
                ${appNotifications.map(n => {
                    const actor = n.actor?.name || 'Someone';
                    const postTitle = n.post?.title || 'your post';
                    const msg = n.type === 'like' ? `${t('post_liked')}: "${postTitle}" — ${actor}` : (n.message || t('notification_word'));
                    return `
                    <div style="padding: 12px; border: 1px solid var(--gray-200); border-radius: 12px; background: white;">
                        <div style="font-weight: 600; margin-bottom: 6px;">${n.type === 'like' ? t('post_liked') : t('notification_word')}</div>
                        <div style="color: var(--gray-900); margin-bottom: 4px;">${msg}</div>
                        <div style="font-size: 12px; color: var(--gray-600);">${new Date(n.createdAt).toLocaleString()}</div>
                    </div>`;
                }).join('')}
            </div>
        `;
    } else if (hasNewPostNotification && posts.length > 0) {
        const author = posts[0].author || 'Someone';
        notificationsModalContent.innerHTML = `
            <div style="padding: 16px;">
                <h3>${t('new_post_title')}</h3>
                <p>${t('new_post_desc').replace('{{author}}', author)}</p>
            </div>
        `;
        hasNewPostNotification = false;
    } else {
        notificationsModalContent.innerHTML = `
            <div class="no-notifications">
                <i class="fas fa-bell-slash"></i>
                <h3>${t('no_notifications_title')}</h3>
                <p>${t('no_notifications_desc')}</p>
            </div>
        `;
    }

    notificationsModal.classList.add('active');

    // Mark as read when opened
    const token = localStorage.getItem('token');
    if (token) {
        try {
            await fetch('/api/notifications/mark-read', {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            await fetchNotifications();
        } catch (e) {
            console.error('Failed to mark notifications read', e);
        }
    }

    updateNotificationBadge();
}

// Initialize the app
document.addEventListener('DOMContentLoaded', init);