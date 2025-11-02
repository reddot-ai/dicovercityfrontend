// NO sample data - we'll fetch from backend only
let posts = [];
let users = [];

// Debounce helper for input events
function debounce(fn, delay = 250) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

// Try to fetch users from backend (search by name)
async function fetchUsersFromServer(query = '') {
  try {
    const token = localStorage.getItem('token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const endpoints = [
      `/api/users/search?q=${encodeURIComponent(query)}`,
      `/api/users?search=${encodeURIComponent(query)}`,
      query ? '' : '/api/users',
    ].filter(Boolean);

    for (const ep of endpoints) {
      const res = await fetch(ep, { headers });
      if (!res.ok) continue;
      const data = await res.json();
      if (!Array.isArray(data)) continue;

      // Normalize into the UI shape
      return data.map((u) => ({
        id: String(u._id || u.id || u.userId || ''),
        name: u.name || u.username || '',
        avatarUrl:
          u.avatarUrl ||
          u.avatar ||
          (u.profile && (u.profile.avatarUrl || u.profile.avatar)) ||
          '',
        posts:
          typeof u.postsCount === 'number'
            ? u.postsCount
            : Array.isArray(u.posts)
            ? u.posts.length
            : 0,
        followers:
          typeof u.followersCount === 'number'
            ? u.followersCount
            : Array.isArray(u.followers)
            ? u.followers.length
            : 0,
      }));
    }
  } catch (e) {
    console.warn('User search failed, falling back to local list', e);
  }
  return null; // signal fallback
}

// Users tab search: fetch + always filter client-side
async function searchAndRenderUsers(query = '') {
  const q = String(query || '').trim().toLowerCase();
  const serverUsers = await fetchUsersFromServer(q);
  if (serverUsers) users = serverUsers;
  renderUsers(q);
}

let map = null;
let markers = [];
let userLocation = null;
let userCityName = 'Your City';
let mapInitialized = false;

// API base: use your current Tunnel URL in prod; localhost in dev
const API_BASE =
  window.API_BASE ||
  (location.hostname.endsWith('pages.dev')
    ? 'https://shop-market-variable-blades.trycloudflare.com'
    : 'http://127.0.0.1:5000');
// Ensure global for non-index embedders
if (!window.API_BASE) window.API_BASE = API_BASE;
function apiFetch(path, opts = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  return fetch(url, opts);
}

function resolveMediaUrl(u) {
  if (!u) return u;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('/')) return (window.API_BASE || API_BASE) + u;
  return u;
}

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
          const score = (name) =>
            preds.find((p) => p.className === name)?.probability || 0;
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
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(true);
      };
      img.src = url;
    });
  } catch (_) {
    return true;
  }
}

// State
let likedPosts = new Set(); // Tracks post IDs the user has liked
let hasNewPostNotification = false; // Tracks if a new post was created
let appNotifications = []; // In-app notifications (e.g., likes)
let glimpses = []; // Glimpse videos
let selectedVideoDuration = 0; // seconds

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
    sales_in: 'Sales in',
    search_events_ph: 'Search events, places...',
    search_products_ph: 'Search products, services...',
    user_search_ph: 'Search for people',
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
    alerts: 'Glimpse',
    profile: 'Profile',
    log_out: 'Log Out',
    app_title: 'Discover City',
    discover_your_city: 'Discover Your City',
    location_prompt_desc:
      'Let us know your location to show you the best events and discoveries near you!',
    // Create post modal
    create_post: 'Create a post',
    create_post_sub: "Share what's on your mind",
    create_sale: 'Make a Sales announcement',
    create_sale_sub: 'Promote your product or service',
    create_glimpse: 'Post a video',
    create_glimpse_sub: 'Share up to 30s',
    back_to_types: 'Back to types',
    post_title_sale_ph: 'Product/Service name',
    post_title_post_ph: "What's on your mind?",
    price_optional: 'Price (optional)',
    upload_image_optional: 'Upload Image (Optional)',
    upload_video_limit: 'Upload Video (<= 30s)',
    add_description_ph: 'Add description...',
    hashtags_ph: '#hashtags',
    submit_post_post: 'Publish post',
    submit_post_sale: 'Publish sale',
    submit_glimpse: 'Publish video',
    video_too_long: 'Video must be 30 seconds or less',
    video_required: 'Video is required',
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
    nsfw_image_blocked:
      'Image rejected: NSFW content detected. Please choose a different image.',
    nsfw_image_warning:
      'This image may violate our content policy. Please choose another image.',
    // Loading state
    loading_post: 'Loading post...',
    char_limit_reached: "You can't type more than 20 characters",
    // Follow notifications (unused here; server sends direct RO message)
    new_follower_title: 'New follower',
    new_follower_msg: 'You have a new follower!: {{user}}',
    // Reels/glimpse
    reels_coming_soon: 'Short videos coming soon',
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
    sales_in: 'Vânzări în',
    search_events_ph: 'Caută evenimente, locuri...',
    search_products_ph: 'Caută produse, servicii...',
    user_search_ph: 'Cauta utilizatori....',
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
    sales: 'Vânzări',
    alerts: 'Glimpse',
    profile: 'Profil',
    log_out: 'Deconectare',
    app_title: 'Descoperă Orașul',
    discover_your_city: 'Descoperă orașul tău',
    location_prompt_desc:
      'Spune-ne locația ta pentru a vedea postări din apropiere',
    // Create post modal
    create_post: 'Creează o postare',
    create_post_sub: 'Împărtășește ce ai în minte',
    create_sale: 'Fă un anunț de vânzare ',
    create_sale_sub: 'Promovează produsul sau serviciul tău',
    create_glimpse: 'Publică un videoclip',
    create_glimpse_sub: 'Până la 30s',
    back_to_types: 'Înapoi la tipuri',
    post_title_sale_ph: 'Nume produs/serviciu',
    post_title_post_ph: 'La ce te gândești?',
    price_optional: 'Preț (opțional)',
    upload_image_optional: 'Încarcă imagine (opțional)',
    upload_video_limit: 'Încarcă videoclip (<= 30s)',
    add_description_ph: 'Adaugă descriere...',
    hashtags_ph: '#hashtag-uri',
    submit_post_post: 'Publică postare',
    submit_post_sale: 'Publică anunț',
    submit_glimpse: 'Publică videoclip',
    video_too_long: 'Videoclipul trebuie să aibă cel mult 30 de secunde',
    video_required: 'Videoclipul este obligatoriu',
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
    confirm_delete_post:
      'Ștergi această postare? Acțiunea nu poate fi anulată.',
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
    nsfw_model_loading:
      'Modelul de siguranță se încarcă. Încearcă din nou în scurt timp.',
    nsfw_image_blocked:
      'Imagine respinsă: conținut pentru adulți detectat. Alege o altă imagine.',
    nsfw_image_warning:
      'Această imagine poate încălca politica noastră de conținut. Te rugăm să alegi altă imagine.',
    // Loading state
    loading_post: 'Se încarcă postarea...',
    char_limit_reached: 'Nu poți scrie mai mult de 20 de caractere',
    // Follow notifications (server will send RO message)
    new_follower_title: 'Urmăritor nou',
    new_follower_msg: 'Ai un urmăritor nou!: {{user}}',
    // Reels/glimpse
    reels_coming_soon: 'Clipuri scurte în curând',
  },
};
function t(key) {
  const lang = currentLang || 'en';
  return (
    (i18n[lang] && i18n[lang][key]) ||
    (i18n.en && i18n.en[key]) ||
    key
  );
}
function applyLanguage() {
  currentLang = localStorage.getItem('lang') || currentLang || 'en';

  // Titles
  const loginLogoTitle = document.querySelector('.login-logo h1');
  if (loginLogoTitle) loginLogoTitle.textContent = t('discover_your_city');
  const appTitle = document.querySelector('.app-title span');
  if (appTitle) appTitle.textContent = t('app_title');

  // Login
  const emailLbl = document.querySelector('label[for="email"]');
  if (emailLbl) emailLbl.textContent = t('email');
  const emailInp = document.getElementById('email');
  if (emailInp) emailInp.placeholder = t('email_ph');
  const pwdLbl = document.querySelector('label[for="password"]');
  if (pwdLbl) pwdLbl.textContent = t('password');
  const pwdInp = document.getElementById('password');
  if (pwdInp) pwdInp.placeholder = t('password_ph');
  const loginBtn = document.querySelector('#loginForm .login-btn');
  if (loginBtn) loginBtn.textContent = t('sign_in');
  const forgotA = document.querySelector(
    '#loginForm .login-options a:first-child'
  );
  if (forgotA) forgotA.textContent = t('forgot_password');
  const signupA = document.getElementById('goToSignup');
  if (signupA) signupA.textContent = t('sign_up');

  // Signup
  const signupTitle = document.querySelector('#signupPage .login-logo h1');
  if (signupTitle) signupTitle.textContent = t('create_account_title');
  const nameLbl = document.querySelector('label[for="signupName"]');
  if (nameLbl) nameLbl.textContent = t('name');
  const nameInp2 = document.getElementById('signupName');
  if (nameInp2) nameInp2.placeholder = t('name_ph');
  const sEmailLbl = document.querySelector('label[for="signupEmail"]');
  if (sEmailLbl) sEmailLbl.textContent = t('email');
  const sEmailInp = document.getElementById('signupEmail');
  if (sEmailInp) sEmailInp.placeholder = t('email_ph');
  const sPwdLbl = document.querySelector('label[for="signupPassword"]');
  if (sPwdLbl) sPwdLbl.textContent = t('password');
  const sPwdInp = document.getElementById('signupPassword');
  if (sPwdInp) sPwdInp.placeholder = t('password_ph');
  const sCPLbl = document.querySelector('label[for="signupConfirm"]');
  if (sCPLbl) sCPLbl.textContent = t('confirm_password');
  const sCPInp = document.getElementById('signupConfirm');
  if (sCPInp) sCPInp.placeholder = t('confirm_password_ph');
  const sLangLbl = document.querySelector('label[for="signupLanguage"]');
  if (sLangLbl) sLangLbl.textContent = t('language');
  const sBtn = document.querySelector('#signupForm .login-btn');
  if (sBtn) sBtn.textContent = t('create_account_btn');
  const goLogin = document.getElementById('goToLogin');
  if (goLogin) goLogin.textContent = t('already_have_account');

  // Location prompt
  const lp = document.getElementById('locationPrompt');
  if (lp) {
    const lpTitle = lp.querySelector('h2');
    if (lpTitle) lpTitle.textContent = t('discover_your_city');
    const lpDesc = lp.querySelector('p');
    if (lpDesc) lpDesc.textContent = t('location_prompt_desc');
  }

  // Placeholders & banners
  const search1 = document.querySelector('#feedView .search-input');
  if (search1) search1.placeholder = t('user_search_ph');
  const search2 = document.querySelector('#salesView .search-input');
  if (search2) search2.placeholder = t('search_products_ph');
  const userSearch = document.getElementById('userSearchInput');
  if (userSearch) userSearch.placeholder = t('user_search_ph');
  const forYouBtn = document.querySelector('.category-btn.active');
  if (forYouBtn) forYouBtn.textContent = t('for_you');
  const usersTitle = document.querySelector('.users-title');
  if (usersTitle) usersTitle.textContent = t('find_people');

  // Remove "Exploring" prefix on banners, keep "Sales in"
  const feedBanner = document.getElementById('locationBanner');
  if (feedBanner && feedBanner.firstChild) feedBanner.firstChild.nodeValue = '';
  const salesBanner = document.querySelector('#salesView .location-banner');
  if (salesBanner && salesBanner.firstChild)
    salesBanner.firstChild.nodeValue = t('sales_in') + ' ';
  const mapBanner = document.getElementById('mapLocationBanner');
  if (mapBanner && mapBanner.firstChild) mapBanner.firstChild.nodeValue = '';
  const notifBanner = document.querySelector(
    '#notificationsView .location-banner'
  );
  if (notifBanner && notifBanner.firstChild)
    notifBanner.firstChild.nodeValue = '';
  const usersBanner = document.querySelector(
    '#usersView .location-banner'
  );
  if (usersBanner && usersBanner.firstChild)
    usersBanner.firstChild.nodeValue = '';

  const accSections = document.querySelectorAll('#accountModal .account-section');
  if (accSections[0]) {
    const h3 = accSections[0].querySelector('h3');
    if (h3) h3.textContent = t('profile');
    const labels = accSections[0].querySelectorAll('strong');
    if (labels[0]) labels[0].textContent = t('name_label');
    if (labels[1]) labels[1].textContent = t('email_label');
    if (labels[2]) labels[2].textContent = t('member_since_label');
  }
  if (accSections[1]) {
    const h3 = accSections[1].querySelector('h3');
    if (h3) h3.textContent = t('preferences');
    const dm = accSections[1].querySelector('.theme-toggle span');
    if (dm) dm.textContent = t('dark_mode');
  }
  if (accSections[2]) {
    const h3 = accSections[2].querySelector('h3');
    if (h3) h3.textContent = t('privacy');
    const p1 = accSections[2].querySelectorAll('p')[0];
    if (p1) {
      const spans = p1.querySelectorAll('span');
      if (spans[0]) spans[0].textContent = t('location_sharing');
      if (spans[1]) spans[1].textContent = t('enabled');
    }
    const p2 = accSections[2].querySelectorAll('p')[1];
    if (p2) {
      const spans = p2.querySelectorAll('span');
      if (spans[0]) spans[0].textContent = t('notifications_label');
      if (spans[1]) spans[1].textContent = t('enabled');
    }
  }

  // Bottom nav labels
  const feedNav = document.querySelector(
    '.bottom-nav [data-view="feed"] span'
  );
  if (feedNav) feedNav.textContent = t('feed');
  const salesNav = document.querySelector(
    '.bottom-nav [data-view="sales"] span'
  );
  if (salesNav) salesNav.textContent = t('sales');
  const alertsNav = document.querySelector(
    '.bottom-nav [data-view="notifications"] span'
  );
  if (alertsNav) alertsNav.textContent = t('alerts'); // label, click overridden
  const profileNav = document.querySelector(
    '.bottom-nav [data-view="profile"] span'
  );
  if (profileNav) profileNav.textContent = t('profile');

  // Logout button text
  const logoutBtnEl = document.getElementById('logoutBtn');
  if (logoutBtnEl) logoutBtnEl.textContent = t('log_out');
}

// Helpers for auth and current user
function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}');
  } catch {
    return {};
  }
}
function getAuthHeaders(extra = {}) {
  const token = localStorage.getItem('token');
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

// FOLLOW persistence: load following from server
async function fetchFollowing() {
  try {
    const res = await fetch('/api/me/following', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    following = new Set((data.following || []).map(String));
    // Re-render to reflect persistent follow state
    const qUsers = (document.getElementById('userSearchInput')?.value || '')
      .toLowerCase();
    if (usersContainer) renderUsers(qUsers);
    const feedQ =
      (document.querySelector('#feedView .search-input')?.value || '').toLowerCase();
    if (peopleResultsEl && peopleResultsEl.style.display === 'block') {
      const list = (users || []).filter((u) =>
        (u.name || '').toLowerCase().includes(feedQ)
      );
      renderUsersInto(peopleResultsEl, list);
    }
  } catch {}
}

// FOLLOW/UNFOLLOW (server persistence) + (optional) notification creation fallback
async function followUser(targetUserId) {
  const token = localStorage.getItem('token');
  if (!token) {
    alert(t('please_log_in_first'));
    return null;
  }
  const endpoints = [
    { url: `/api/users/${targetUserId}/follow`, method: 'POST' },
    // fallbacks if you keep older routes
    { url: `/api/follow/${targetUserId}`, method: 'POST' },
    { url: `/api/users/${targetUserId}/followers`, method: 'POST' },
  ];
  let followersCount = null;

  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, {
        method: ep.method,
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      });
      if (!res.ok) continue;
      const data = await res.json().catch(() => ({}));
      followersCount =
        data.followersCount ??
        (Array.isArray(data.followers) ? data.followers.length : data.followers) ??
        null;
      break;
    } catch (_) {}
  }

  // Optional: client-side create notification (server already does it in RO)
  try {
    const me = getCurrentUser();
    const msg = t('new_follower_msg').replace('{{user}}', me?.name || 'Someone');
    await fetch('/api/notifications', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        type: 'follow',
        to: String(targetUserId),
        title: t('new_follower_title'),
        message: msg,
      }),
    }).catch(() => {});
  } catch (_) {}

  return followersCount;
}
async function unfollowUser(targetUserId) {
  const token = localStorage.getItem('token');
  if (!token) {
    alert(t('please_log_in_first'));
    return null;
  }
  const endpoints = [
    { url: `/api/users/${targetUserId}/follow`, method: 'DELETE' },
    { url: `/api/follow/${targetUserId}`, method: 'DELETE' },
    { url: `/api/users/${targetUserId}/followers`, method: 'DELETE' },
  ];
  let followersCount = null;
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, {
        method: ep.method,
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      });
      if (!res.ok) continue;
      const data = await res.json().catch(() => ({}));
      followersCount =
        data.followersCount ??
        (Array.isArray(data.followers) ? data.followers.length : data.followers) ??
        null;
      break;
    } catch (_) {}
  }
  return followersCount;
}
function updateFollowButtons(userId, isFollowing) {
  document.querySelectorAll(`[data-user-id="${userId}"]`).forEach((btn) => {
    if (
      !(
        btn.classList.contains('follow-btn') ||
        btn.classList.contains('following-btn')
      )
    )
      return;
    btn.textContent = isFollowing ? t('following') : t('follow');
    btn.classList.toggle('follow-btn', !isFollowing);
    btn.classList.toggle('following-btn', isFollowing);
  });
}
function updateUserCardsFollowers(userId, followersCount) {
  if (followersCount == null) return;
  // Users tab cards
  if (usersContainer) {
    usersContainer.querySelectorAll('.user-card').forEach((card) => {
      const btn = card.querySelector(`[data-user-id="${userId}"]`);
      if (btn) {
        const stats = card.querySelector('.user-stats');
        if (stats) {
          const nameEl = card.querySelector('.user-name');
          const uName = nameEl?.textContent?.trim() || '';
          const u =
            users.find(
              (x) => String(x.id) === String(userId) || x.name === uName
            ) || {};
          const postsCount = u?.posts || 0;
          stats.textContent = `${postsCount} ${t('posts_word')} • ${followersCount} ${t(
            'followers_word'
          )}`;
        }
      }
    });
  }
  // Feed results list
  if (peopleResultsEl) {
    peopleResultsEl.querySelectorAll('.user-card').forEach((card) => {
      const btn = card.querySelector(`[data-user-id="${userId}"]`);
      if (btn) {
        const stats = card.querySelector('.user-stats');
        if (stats) {
          const nameEl = card.querySelector('.user-name');
          const uName = nameEl?.textContent?.trim() || '';
          const u =
            users.find(
              (x) => String(x.id) === String(userId) || x.name === uName
            ) || {};
          const postsCount = u?.posts || 0;
          stats.textContent = `${postsCount} ${t('posts_word')} • ${followersCount} ${t(
            'followers_word'
          )}`;
        }
      }
    });
  }
  // Profile modal (if open for same user)
  if (userProfileModal && userProfileModal.classList.contains('active')) {
    const nameInModal =
      document.getElementById('userProfileName')?.textContent?.trim();
    const u =
      users.find(
        (x) => x.name === nameInModal || String(x.id) === String(userId)
      ) || null;
    if (u && nameInModal === u.name) {
      const statsP =
        userProfileContent?.querySelector('div[style*="font-size: 14px;"]');
      if (statsP) {
        const postsCount = u?.posts || 0;
        statsP.textContent = `${postsCount} ${t('posts_word')} • ${followersCount} ${t(
          'followers_word'
        )}`;
      }
    }
  }
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

// Feed People Search DOM
const feedSearchInput = document.querySelector('#feedView .search-input');
let peopleResultsEl = document.getElementById('peopleResults');
let lastFeedResults = [];

// Current state
let currentView = 'feed';
let currentPostType = '';
let selectedCategory = 'all';
let following = new Set();

// Initialize
function init() {
  setupEventListeners();
  // Preload safety model in background
  loadNSFWModel();
  checkDarkModePreference();
  applyLanguage();
  checkAuth();
  const badge = document.querySelector('.notification-badge');
  if (badge) badge.style.display = 'none';
}

// Check if user is already logged in
async function checkAuth() {
  const token = localStorage.getItem('token');
  const userStr = localStorage.getItem('user');
  if (token && userStr) {
    if (loginPage) loginPage.style.display = 'none';
    if (mainApp) mainApp.style.display = 'block';
    let userObj = {};
    try {
      userObj = JSON.parse(userStr);
      updateProfileUI(userObj);
    } catch {}
    await fetchNotifications();
    await fetchFollowing();
    try {
      const res = await fetch('/api/me', { headers: getAuthHeaders() });
      if (res.ok) {
        const me = await res.json();
        userCityName = me.city || userObj.city || 'Your City';
        if (!me.city) {
          showLocationPrompt();
        } else {
          updateCityDisplay();
          fetchPosts();
        }
      } else {
        showLocationPrompt();
      }
    } catch {
      showLocationPrompt();
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
      if (loginPage) loginPage.style.display = 'none';
      if (signupPage) signupPage.style.display = 'flex';
    });
  }
  if (goToLogin) {
    goToLogin.addEventListener('click', (e) => {
      e.preventDefault();
      if (signupPage) signupPage.style.display = 'none';
      if (loginPage) loginPage.style.display = 'flex';
    });
  }

  // Signup form -> register user then auto-login
  if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('signupName')?.value.trim() || '';
      const email = document.getElementById('signupEmail')?.value.trim() || '';
      const password = document.getElementById('signupPassword')?.value || '';
      const confirm = document.getElementById('signupConfirm')?.value || '';
      const lang = document.getElementById('signupLanguage')?.value || 'en';

      if (password !== confirm) {
        alert('Passwords do not match');
        return;
      }

      try {
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password }),
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
          await fetchFollowing();
          applyLanguage();
          updateProfileUI(data.user);
          if (signupPage) signupPage.style.display = 'none';
          if (mainApp) mainApp.style.display = 'block';
          showLocationPrompt();
        } else {
          alert('Account created. Please sign in.');
          if (signupPage) signupPage.style.display = 'none';
          if (loginPage) loginPage.style.display = 'flex';
        }
      } catch (error) {
        alert('Sign up failed: ' + error.message);
      }
    });
  }

  // Login form - REAL backend integration
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email')?.value || '';
      const password = document.getElementById('password')?.value || '';
      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await response.json();
        if (data.token) {
          localStorage.setItem('token', data.token);
          localStorage.setItem('user', JSON.stringify(data.user));

          // Re-apply preferred language on login (persisted from signup or settings)
          currentLang = localStorage.getItem('lang') || currentLang || 'en';
          applyLanguage();

          await fetchFollowing();
          updateProfileUI(data.user);
          if (loginPage) loginPage.style.display = 'none';
          if (mainApp) mainApp.style.display = 'block';
          fetchNotifications();
          if (!data.user.city) {
            showLocationPrompt();
          } else {
            userCityName = data.user.city;
            updateCityDisplay();
            fetchPosts();
          }
        } else {
          alert('Login failed: ' + (data.error || 'Invalid credentials'));
        }
      } catch (error) {
        alert('Login failed. Please make sure the server is reachable.');
        console.error('Login error:', error);
      }
    });
  }

  // City picker: make all banners clickable to re-open picker
  [
    '#locationBanner',
    '#mapLocationBanner',
    '#usersView .location-banner',
    '#salesView .location-banner',
  ].forEach((sel) => {
    const el = document.querySelector(sel);
    if (el) {
      el.style.cursor = 'pointer';
      el.title = 'Click to change city';
      el.addEventListener('click', showLocationPrompt);
    }
  });

  // Navigation
  navItems.forEach((item) => {
    item.addEventListener('click', () => {
      const view = item.getAttribute('data-view');
      switchView(view);
    });
  });

  // Profile avatar click
  if (profileAvatar)
    profileAvatar.addEventListener('click', () => {
      if (accountModal) accountModal.classList.add('active');
    });

  // Account modal
  if (closeAccountModal)
    closeAccountModal.addEventListener('click', () => {
      if (accountModal) accountModal.classList.remove('active');
    });
  if (accountModal) {
    accountModal.addEventListener('click', (e) => {
      if (e.target === accountModal) accountModal.classList.remove('active');
    });
  }

  // Dark mode toggle
  if (darkModeToggle) darkModeToggle.addEventListener('change', toggleDarkMode);

  // Logout
  if (logoutBtn) logoutBtn.addEventListener('click', logout);

  // Add post button
  if (addPostBtn)
    addPostBtn.addEventListener('click', () => {
      showPostModal();
    });

  // Close modals
  if (closeModal) closeModal.addEventListener('click', hidePostModal);
  if (postModal) {
    postModal.addEventListener('click', (e) => {
      if (e.target === postModal) hidePostModal();
    });
  }
  if (closeUserProfile)
    closeUserProfile.addEventListener('click', hideUserProfileModal);
  if (userProfileModal) {
    userProfileModal.addEventListener('click', (e) => {
      if (e.target === userProfileModal) hideUserProfileModal();
    });
  }
  if (closeNotificationsModal) {
    closeNotificationsModal.addEventListener('click', () => {
      if (notificationsModal) notificationsModal.classList.remove('active');
    });
  }
  if (notificationsModal) {
    notificationsModal.addEventListener('click', (e) => {
      if (e.target === notificationsModal) notificationsModal.classList.remove('active');
    });
  }

  // Notifications button
  if (notificationsBtn)
    notificationsBtn.addEventListener('click', () => {
      showNotificationsModal();
    });

  // Category filtering
  categoryBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      categoryBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      selectedCategory = btn.getAttribute('data-category') || 'all';
      renderPosts();
    });
  });

  // Like buttons - Toggle like/unlike
  document.addEventListener('click', (e) => {
    const heartBtn =
      e.target.closest('.action-btn.heart') ||
      e.target.closest('.action-btn-vertical.heart');
    if (!heartBtn) return;

    const postCard = heartBtn.closest('.post-card');
    const postId = postCard?.dataset.postId;
    if (!postId) return;

    const countEl = heartBtn.querySelector('span');
    let count = parseInt(countEl?.textContent || '0', 10);

    const isLiking = !likedPosts.has(postId);

    if (!isLiking) {
      count = Math.max(0, count - 1);
      if (countEl) countEl.textContent = String(count);
      heartBtn.style.color = 'white';
      likedPosts.delete(postId);
    } else {
      count = count + 1;
      if (countEl) countEl.textContent = String(count);
      heartBtn.style.color = '#ef4444';
      likedPosts.add(postId);
    }

    const token = localStorage.getItem('token');
    if (token) {
      fetch(`/api/posts/${postId}/like`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      })
        .then((res) => res.json())
        .then((data) => {
          const post = posts.find((p) => p.id === postId);
          if (post) {
            post.likes = data.likes;
            if (countEl) countEl.textContent = String(data.likes);
          }
        })
        .catch((err) => console.error('Like sync failed:', err));
    }
  });

  // Post submission
  document.addEventListener(
    'click',
    (e) => {
      if (
        e.target.classList.contains('submit-btn') ||
        e.target.closest('.submit-btn')
      ) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        submitPost(e);
        return false;
      }
    },
    true
  );

  // Users tab search (debounced + server-backed + client filter)
  if (userSearchInput) {
    const doUserSearch = debounce((val) => {
      searchAndRenderUsers(val);
    }, 200);
    userSearchInput.addEventListener('input', () => {
      const searchTerm = userSearchInput.value;
      doUserSearch(searchTerm);
    });
  }

  // Feed people search (replaces feed search): ensure results container exists, render user cards, hide posts while typing
  if (feedSearchInput) {
    const ensurePeopleEl = () => {
      if (peopleResultsEl && document.body.contains(peopleResultsEl))
        return peopleResultsEl;
      let c = document.getElementById('peopleResults');
      if (!c) {
        c = document.createElement('div');
        c.id = 'peopleResults';
        c.style.display = 'none';
        const feedSearchBox = document.querySelector(
          '#feedView .search-container'
        );
        const parent = feedSearchBox?.parentNode;
        if (parent && postsContainer) parent.insertBefore(c, postsContainer);
        else document.body.appendChild(c);
      }
      peopleResultsEl = c;
      return c;
    };

    const doFeedPeopleSearch = debounce(async (val) => {
      const el = ensurePeopleEl();
      const q = String(val || '').trim();
      if (!q) {
        el.style.display = 'none';
        el.innerHTML = '';
        if (postsContainer) postsContainer.style.display = 'block';
        return;
      }
      const serverUsers = await fetchUsersFromServer(q);
      const base = serverUsers || users;
      const list = (base || []).filter((u) =>
        (u.name || '').toLowerCase().includes(q.toLowerCase())
      );
      lastFeedResults = list;
      renderUsersInto(el, list);
      el.style.display = 'block';
      if (postsContainer) postsContainer.style.display = 'none';
    }, 250);

    feedSearchInput.addEventListener('input', () =>
      doFeedPeopleSearch(feedSearchInput.value)
    );

    // Open profile from a feed result card
    document.addEventListener('click', (e) => {
      const card = e.target.closest('#peopleResults .user-card');
      if (!card) return;
      const id = String(card.dataset.userId);
      const u =
        (lastFeedResults || []).find((x) => String(x.id) === id) ||
        (users || []).find((x) => String(x.id) === id);
      if (u) {
        showUserProfile({
          id: u.id,
          name: u.name,
          avatar: getInitials(u.name),
          avatarUrl: u.avatarUrl,
          posts: u.posts || 0,
          followers: u.followers || 0,
        });
      }
    });
  }

  // Follow buttons - persist to backend + notify followed user (server)
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.follow-btn, .following-btn');
    if (!btn) return;
    const userId = String(btn.dataset.userId);
    const isCurrentlyFollowing = following.has(userId);

    if (isCurrentlyFollowing) {
      const count = await unfollowUser(userId);
      following.delete(userId);
      updateFollowButtons(userId, false);
      if (count != null) updateUserCardsFollowers(userId, count);
    } else {
      const count = await followUser(userId);
      following.add(userId);
      updateFollowButtons(userId, true);
      if (count != null) updateUserCardsFollowers(userId, count);
    }
  });

  // Contact buttons
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('contact-btn')) {
      const userId = String(e.target.dataset.userId);
      const user = (users || []).find((u) => String(u.id) === userId);
      if (user) {
        showUserProfile(user);
      }
    }
  });

  // Glimpse like/delete handlers
  document.addEventListener('click', async (e) => {
    const likeBtn = e.target.closest('[data-glimpse-like]');
    if (likeBtn) {
      const card = likeBtn.closest('[data-glimpse-id]');
      const id = card?.dataset.glimpseId;
      if (!id) return;
      const span = likeBtn.querySelector('span');
      let count = parseInt(span?.textContent || '0', 10);
      const key = 'g:' + id;
      const isLiking = !likedPosts.has(key);
      if (isLiking) {
        count++;
        likedPosts.add(key);
        likeBtn.style.color = '#ef4444';
      } else {
        count = Math.max(0, count - 1);
        likedPosts.delete(key);
        likeBtn.style.color = 'white';
      }
      if (span) span.textContent = String(count);
      const token = localStorage.getItem('token');
      if (token) {
        try {
          await fetch(`/api/glimpse/${id}/like`, { method: 'PUT', headers: getAuthHeaders() });
        } catch (_) {}
      }
    }
    const delBtn = e.target.closest('[data-glimpse-del]');
    if (delBtn) {
      const card = delBtn.closest('[data-glimpse-id]');
      const id = card?.dataset.glimpseId;
      if (!id) return;
      if (!confirm(t('confirm_delete_post'))) return;
      try {
        const res = await fetch(`/api/glimpse/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
        if (res.ok) {
          glimpses = glimpses.filter((g) => g.id !== id);
          card.remove();
        }
      } catch (_) {}
    }
  });
}

// Login functions / City picker (dynamic from /api/cities)
async function showLocationPrompt() {
  if (!locationPrompt) return;
  locationPrompt.style.display = 'flex';

  // Ensure container for city buttons exists
  let wrap = locationPrompt.querySelector('.location-buttons');
  if (!wrap) {
    const modal = locationPrompt.querySelector('.location-modal') || locationPrompt;
    wrap = document.createElement('div');
    wrap.className = 'location-buttons';
    modal.appendChild(wrap);
  }

  wrap.innerHTML = 'Loading...';

  try {
    const res = await fetch('/api/cities', { headers: getAuthHeaders() });
    const cities = res.ok ? await res.json() : ['Chișinău', 'Ştefan Vodă'];
    wrap.innerHTML = cities
      .map(
        (c) =>
          `<button class="location-btn city-option" data-city="${c}">${c}</button>`
      )
      .join('');
    wrap.querySelectorAll('.city-option').forEach((btn) => {
      btn.onclick = async () => {
        const city = btn.getAttribute('data-city');
        await savePreferredCity(city);
      };
    });
  } catch {
    wrap.innerHTML = `
      <button class="location-btn city-option" data-city="Chișinău">Chișinău</button>
      <button class="location-btn city-option" data-city="Ştefan Vodă">Ştefan Vodă</button>`;
    wrap.querySelectorAll('.city-option').forEach((btn) => {
      btn.onclick = async () => {
        const city = btn.getAttribute('data-city');
        await savePreferredCity(city);
      };
    });
  }
}

function hideLocationPrompt() {
  if (locationPrompt) locationPrompt.style.display = 'none';
  updateCityDisplay();
}

async function savePreferredCity(city) {
  const token = localStorage.getItem('token');
  if (!token) {
    alert(t('please_log_in_first'));
    return;
  }
  try {
    const res = await fetch('/api/me/city', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ city }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to set city');
    }
    const data = await res.json();
    userCityName = data.city || city;
    // persist into local user object
    try {
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      u.city = userCityName;
      localStorage.setItem('user', JSON.stringify(u));
    } catch {}
    hideLocationPrompt();
    updateCityDisplay();
    fetchPosts();
  } catch (e) {
    alert(e.message || 'Failed to set city');
  }
}

function updateCityDisplay() {
  if (cityNameElement) cityNameElement.textContent = userCityName;
  if (mapCityNameElement) mapCityNameElement.textContent = userCityName;
  if (notifCityNameElement) notifCityNameElement.textContent = userCityName;
  if (usersCityNameElement) usersCityNameElement.textContent = userCityName;
  if (salesCityNameElement) salesCityNameElement.textContent = userCityName;
}

// Always show the chosen city name (not coordinates)
function updateCityDisplayWithCoordinates() {
  updateCityDisplay();
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
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    mapInitialized = true;

    L.marker([userLocation.lat, userLocation.lng])
      .addTo(map)
      .bindPopup(t('your_location'))
      .openPopup();

    markers = [];
    posts.forEach((post) => {
      if (post.lat && post.lng) {
        const marker = L.marker([post.lat, post.lng]).addTo(map);
        marker.bindPopup(
          `<b>${post.title}</b><br>${post.location}<br>${post.distance}`
        );
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
  if (darkModeToggle) darkModeToggle.checked = isDarkMode;
  if (isDarkMode) {
    document.body.classList.add('dark-mode');
  }
}

function toggleDarkMode() {
  const isDarkMode = !!darkModeToggle?.checked;
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
  if (myPostsEl) myPostsEl.textContent = '0 posts ';
}

async function fetchNotifications() {
  const token = localStorage.getItem('token');
  if (!token) return;
  try {
    const res = await fetch('/api/notifications', {
      headers: { Authorization: `Bearer ${token}` },
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
  const hasUnread = appNotifications.some((n) => !n.read);
  const badge = document.querySelector('.notification-badge');
  if (badge) badge.style.display = hasUnread ? 'block' : 'none';
}

// Logout function
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  if (accountModal) accountModal.classList.remove('active');
  if (mainApp) mainApp.style.display = 'none';
  if (loginPage) loginPage.style.display = 'flex';
  // Re-apply language on logout so the login screen stays in the chosen language
  currentLang = localStorage.getItem('lang') || currentLang || 'en';
  applyLanguage();
  const emailEl = document.getElementById('email');
  if (emailEl) emailEl.value = '';
  const pwdEl = document.getElementById('password');
  if (pwdEl) pwdEl.value = '';
}

// Switch views
function switchView(view) {
  views.forEach((v) => v.classList.remove('active'));
  const viewEl = document.getElementById(`${view}View`);
  if (viewEl) viewEl.classList.add('active');

  navItems.forEach((item) => {
    if (item.getAttribute('data-view') === view) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  currentView = view;

  // Show top header only on main feed; hide on other views
  const headerEls = [
    document.querySelector('.top-bar'),
    document.querySelector('.app-header'),
    document.querySelector('.header'),
  ].filter(Boolean);
  if (view === 'feed') headerEls.forEach((el) => (el.style.display = ''));
  else headerEls.forEach((el) => (el.style.display = 'none'));

  // When opening Glimpse (notifications), hide its location banner and any city prompt
  if (view === 'notifications') {
    const notifBannerEl = document.querySelector('#notificationsView .location-banner');
    if (notifBannerEl) notifBannerEl.style.display = 'none';
    if (locationPrompt) locationPrompt.style.display = 'none';
    const notifView = document.getElementById('notificationsView');
    if (notifView) {
      notifView.style.paddingTop = '0';
      notifView.style.marginTop = '0';
    }
  }

  if (view === 'map' && !mapInitialized) {
    initializeMap();
  }
  if (view === 'users') {
    // Load initial list or refresh on entering Users tab
    const q = (userSearchInput && userSearchInput.value) ? userSearchInput.value : '';
    searchAndRenderUsers(q);
  }
  if (view === 'notifications') {
    fetchGlimpse();
  }
}

// Show post modal
function showPostModal() {
  currentPostType = '';
  renderPostModal();
  if (postModal) postModal.classList.add('active');
}

// Hide post modal
function hidePostModal() {
  if (postModal) postModal.classList.remove('active');
}

// Render post modal (i18n)
function renderPostModal() {
  if (!modalContent) return;
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
      <div class="post-type-option" onclick="selectPostType('glimpse')">
        <div class="post-type-icon discovery">
          <i class="fas fa-video"></i>
        </div>
        <div class="post-type-info">
          <h3>${t('create_glimpse')}</h3>
          <p>${t('create_glimpse_sub')}</p>
        </div>
      </div>
    `;
  } else if (currentPostType === 'glimpse') {
    modalContent.innerHTML = `
      <button type="button" class="back-btn" onclick="goBackToTypes()">
        <i class="fas fa-arrow-left"></i>
        ${t('back_to_types')}
      </button>
      <div class="form-group">
        <input type="text" id="postTitle" class="form-input" placeholder="${t('add_description_ph')}">
      </div>
      <div class="form-group">
        <label class="image-upload" id="videoUploadLabel">
          <i class="fas fa-cloud-upload-alt"></i>
          <p>${t('upload_video_limit')}</p>
        </label>
        <input type="file" id="postVideo" accept="video/mp4,video/webm" style="display: none;">
        <video id="videoPreview" class="image-preview" style="display:none; width:100%; border-radius:12px;" controls playsinline preload="metadata"></video>
        <div id="videoWarning" style="display:none;color: var(--danger); font-size: 12px; margin-top: 8px;"></div>
      </div>
      <div class="form-group">
        <textarea id="postDescription" class="form-textarea" placeholder="${t('add_description_ph')}"></textarea>
      </div>
      <button type="button" class="submit-btn" id="submitPostBtn">${t('submit_glimpse')}</button>
    `;
    // Video upload
    const videoUploadLabel = document.getElementById('videoUploadLabel');
    const postVideo = document.getElementById('postVideo');
    const videoPreview = document.getElementById('videoPreview');
    const videoWarning = document.getElementById('videoWarning');
    selectedVideoDuration = 0;
    if (videoUploadLabel && postVideo && videoPreview) {
      videoUploadLabel.onclick = function (e) {
        e.preventDefault();
        postVideo.click();
        return false;
      };
      postVideo.onchange = async function (e) {
        if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          // Hint supported formats (MP4/H.264 or WebM)
          if (file && file.type && !/^video\/(mp4|webm)$/i.test(file.type)) {
            if (videoWarning) {
              videoWarning.textContent = 'Unsupported format. Please upload MP4 (H.264/AAC) or WebM.';
              videoWarning.style.display = 'block';
            }
            postVideo.value = '';
            videoPreview.removeAttribute('src');
            videoPreview.load();
            videoPreview.style.display = 'none';
            selectedVideoDuration = 0;
            return;
          }
          const url = URL.createObjectURL(file);
          videoPreview.src = url;
          videoPreview.style.display = 'block';
          videoPreview.onloadedmetadata = () => {
            selectedVideoDuration = videoPreview.duration || 0;
            if (selectedVideoDuration > 30.5) {
              if (videoWarning) {
                videoWarning.textContent = t('video_too_long');
                videoWarning.style.display = 'block';
              }
              postVideo.value = '';
              videoPreview.removeAttribute('src');
              videoPreview.load();
              videoPreview.style.display = 'none';
              selectedVideoDuration = 0;
            } else if (videoWarning) {
              videoWarning.style.display = 'none';
            }
          };
        }
      };
    }
    // Char limit (20) for title/description
    try {
      const MAXC = 20;
      const setupLimit = (el) => {
        if (!el) return;
        let msg = (el.nextElementSibling && el.nextElementSibling.classList && el.nextElementSibling.classList.contains('char-limit-msg'))
          ? el.nextElementSibling
          : (function(){ const d=document.createElement('div'); d.className='char-limit-msg'; d.style.color='var(--danger)'; d.style.fontSize='12px'; d.style.marginTop='6px'; el.parentNode.insertBefore(d, el.nextSibling); return d; })();
        const handler = () => {
          if (el.value.length > MAXC) el.value = el.value.slice(0, MAXC);
          if (el.value.length >= MAXC) { msg.textContent = t('char_limit_reached'); msg.style.display='block'; }
          else { msg.style.display='none'; }
        };
        el.addEventListener('input', handler);
        handler();
      };
      setupLimit(document.getElementById('postTitle'));
      setupLimit(document.getElementById('postDescription'));
    } catch (_) {}
    // Submit
    const submitBtn = document.getElementById('submitPostBtn');
    if (submitBtn) {
      submitBtn.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        submitPost();
        return false;
      };
    }
  } else {
    // post/sale
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
      imageUploadLabel.onclick = function (e) {
        e.preventDefault();
        postImage.click();
        return false;
      };

      const nsfwWarning = document.getElementById('nsfwWarning');
      postImage.onchange = async function (e) {
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
          reader.onload = function (ev) {
            imagePreview.src = ev.target?.result || '';
            imagePreview.style.display = 'block';
          };
          reader.readAsDataURL(file);
        }
      };
    }

    // Char limit (30) for title/description
    try {
      const MAXC = 20;
      const setupLimit = (el) => {
        if (!el) return;
        let msg = (el.nextElementSibling && el.nextElementSibling.classList && el.nextElementSibling.classList.contains('char-limit-msg'))
          ? el.nextElementSibling
          : (function(){ const d=document.createElement('div'); d.className='char-limit-msg'; d.style.color='var(--danger)'; d.style.fontSize='12px'; d.style.marginTop='6px'; el.parentNode.insertBefore(d, el.nextSibling); return d; })();
        const handler = () => {
          if (el.value.length > MAXC) el.value = el.value.slice(0, MAXC);
          if (el.value.length >= MAXC) { msg.textContent = t('char_limit_reached'); msg.style.display='block'; }
          else { msg.style.display='none'; }
        };
        el.addEventListener('input', handler);
        handler();
      };
      setupLimit(document.getElementById('postTitle'));
      setupLimit(document.getElementById('postDescription'));
    } catch (_) {}

    // Submit button
    const submitBtn = document.getElementById('submitPostBtn');
    if (submitBtn) {
      submitBtn.onclick = function (e) {
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
      postForm.onsubmit = function (e) {
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
  switch (type) {
    case 'event':
      return 'https://placehold.co/400x250/3b82f6/white?text=Event';
    case 'discovery':
      return 'https://placehold.co/400x250/8b5cf6/white?text=Discovery';
    case 'challenge':
      return 'https://placehold.co/400x250/10b981/white?text=Challenge';
    default:
      return 'https://placehold.co/400x250/gray/white?text=Post';
  }
}

// Submit post with image upload OR glimpse with video upload
async function submitPost(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  const isGlimpse = currentPostType === 'glimpse';
  const title = document.getElementById('postTitle')?.value || '';
  const descVal = document.getElementById('postDescription')?.value || '';
  if ((title && title.length > 20) || (descVal && descVal.length > 20)) {
    alert(t('char_limit_reached'));
    return false;
  }
  if (!isGlimpse && !title) {
    alert(t('title_required'));
    return false;
  }

  const token = localStorage.getItem('token');
  if (!token) {
    alert(t('please_log_in_first'));
    return;
  }

  const formData = new FormData();

  if (isGlimpse) {
    const postVideo = document.getElementById('postVideo');
    if (!postVideo || !postVideo.files || !postVideo.files[0]) {
      alert(t('video_required'));
      return false;
    }
    if (selectedVideoDuration > 30.5) {
      alert(t('video_too_long'));
      return false;
    }
    formData.append('video', postVideo.files[0]);
  } else {
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
      formData.append('image', postImage.files[0]);
    }
  }

  const postData = isGlimpse
    ? {
        caption: title || (document.getElementById('postDescription')?.value || ''),
        durationSeconds: selectedVideoDuration || 0,
        lat: userLocation ? userLocation.lat : 37.7749,
        lng: userLocation ? userLocation.lng : -122.4194,
      }
    : {
        title: title,
        description: document.getElementById('postDescription')?.value || '',
        type: currentPostType,
        location: document.getElementById('postLocation')?.value || userCityName,
        lat: userLocation ? userLocation.lat : 37.7749,
        lng: userLocation ? userLocation.lng : -122.4194,
        hashtags:
          document
            .getElementById('postHashtags')
            ?.value?.split(',')
            .map((tag) => tag.trim())
            .filter((tag) => tag) || [],
        category: 'all',
        price:
          currentPostType === 'sale'
            ? document.getElementById('postPrice')?.value || ''
            : '',
      };

  formData.append('data', JSON.stringify(postData));

  const submitBtnEl = document.getElementById('submitPostBtn');
  if (submitBtnEl) {
    submitBtnEl.disabled = true;
    submitBtnEl.textContent = t('loading_post');
  }

  const endpoint = isGlimpse ? '/api/glimpse' : '/api/posts';
  fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  })
    .then(async (response) => {
      if (response.status === 401 || response.status === 403) {
        alert(t('session_expired'));
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        if (loginPage) loginPage.style.display = 'flex';
        if (mainApp) mainApp.style.display = 'none';
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
    .then((resp) => {
      if (isGlimpse) {
        const g = resp;
        const newG = {
          id: String(g._id),
          caption: g.caption || '',
          video: resolveMediaUrl(g.video),
          author: g.author?.name || 'You',
          authorId: (g.author && (g.author._id || g.author.id)) ? String(g.author._id || g.author.id) : '',
          likes: Array.isArray(g.likes) ? g.likes.length : 0,
          location: g.location,
          time: g.createdAt ? new Date(g.createdAt).toLocaleString() : 'Just now',
          duration: g.durationSeconds || 0,
        };
        glimpses.unshift(newG);
        renderGlimpses();
        hidePostModal();
        currentPostType = '';
        return;
      }

      const post = resp;
      const newPost = {
        id: String(post._id),
        type: post.type,
        title: post.title,
        category: post.category || 'all',
        distance: '0.1 km',
        time: 'Just now',
        likes: post.likes ? post.likes.length : 0,
        comments: post.comments ? post.comments.length : 0,
        rsvp: post.rsvp || 0,
        image: post.image ? resolveMediaUrl(post.image) : getDefaultImage(post.type),
        location: post.location,
        author: post.author?.name || 'You',
        authorId:
          (post.author && (post.author._id || post.author.id))
            ? String(post.author._id || post.author.id)
            : '',
        lat: post.coordinates?.lat,
        lng: post.coordinates?.lng,
        description: post.description || '',
        price: post.price || '',
        hashtags: post.hashtags || [],
      };

      posts.unshift(newPost);
      renderPosts();
      renderSalesPosts();
      renderMapPosts();

      if (map && newPost.lat && newPost.lng) {
        const marker = L.marker([newPost.lat, newPost.lng]).addTo(map);
        marker.bindPopup(
          `<b>${newPost.title}</b><br>${newPost.location}<br>${newPost.distance}`
        );
        markers.push(marker);
      }

      hidePostModal();
      currentPostType = '';
      hasNewPostNotification = true;
      const badge = document.querySelector('.notification-badge');
      if (badge) badge.style.display = 'block';
      try {
        fetchPosts();
      } catch (_) {}
    })
    .catch((error) => {
      console.error('Error creating post:', error);
      alert(error.message || 'Failed to create post. Please try again.');
      try {
        fetchPosts();
      } catch (_) {}
      setTimeout(() => {
        try {
          fetchPosts();
        } catch (_) {}
      }, 1500);
    })
    .finally(() => {
      const btn = document.getElementById('submitPostBtn');
      if (btn) {
        btn.disabled = false;
        if (isGlimpse) btn.textContent = t('submit_glimpse');
        else btn.textContent =
          currentPostType === 'sale' ? t('submit_post_sale') : t('submit_post_post');
      }
      if (isGlimpse) {
        try { fetchGlimpse(); } catch (_) {}
      }
    });
}

// Render posts to the DOM (exclude sales posts from main feed)
function renderPosts() {
  if (!postsContainer) return;
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const currentUserId = String(user.id || user._id || '');
  const filteredPosts = posts.filter(
    (post) => post.type !== 'sale' && post.type !== 'glimpse' && (selectedCategory === 'all' || post.category === selectedCategory)
  );
  postsContainer.innerHTML = filteredPosts
    .map(
      (post) => `
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
          <button class="action-btn-vertical heart" style="color: ${
            likedPosts.has(String(post.id)) ? '#ef4444' : 'white'
          };">
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
          ${
            post.authorId === currentUserId
              ? `
          <button class="action-btn-vertical delete" title="${t('delete')}">
            <i class="fas fa-trash"></i>
          </button>
          `
              : ''
          }
        </div>
      </div>
    `
    )
    .join('');
}

// Delete post (author only)
document.addEventListener('click', async (e) => {
  const delBtn =
    e.target.closest('.action-btn-vertical.delete') ||
    e.target.closest('.sale-action-btn.delete');
  if (!delBtn) return;
  const postCard = delBtn.closest('[data-post-id]');
  const postId = postCard?.dataset.postId;
  if (!postId) return;
  if (!confirm(t('confirm_delete_post'))) return;
  const token = localStorage.getItem('token');
  try {
    const res = await fetch(`/api/posts/${postId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert('Failed to delete: ' + (err.error || res.status));
      return;
    }
    posts = posts.filter((p) => String(p.id) !== String(postId));
    renderPosts();
    renderSalesPosts();
    if (map) {
      mapInitialized = false;
      initializeMap();
    }
  } catch (err) {
    alert(t('failed_delete'));
    console.error('Delete error:', err);
  }
});

// Render map posts
function renderMapPosts() {
  if (!mapPostsContainer) return;
  mapPostsContainer.innerHTML = posts
    .slice(0, 3)
    .map(
      (post) => `
      <div class="post-card" data-post-id="${post.id}">
        <div class="post-content">
          <h3 class="post-title">${post.title}</h3>
          <p class="post-info">${post.location} • ${post.distance}</p>
        </div>
      </div>
    `
    )
    .join('');
}

// Glimpse (short videos)
async function fetchGlimpse() {
  const token = localStorage.getItem('token');
  if (!token) return;
  try {
    const res = await fetch('/api/glimpse', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    glimpses = (Array.isArray(data) ? data : []).map(g => ({
      id: String(g._id),
      caption: g.caption || '',
      video: resolveMediaUrl(g.video),
      author: g.author?.name || 'Unknown',
      authorId: (g.author && (g.author._id || g.author.id)) ? String(g.author._id || g.author.id) : '',
      likes: Array.isArray(g.likes) ? g.likes.length : 0,
      location: g.location,
      time: g.createdAt ? new Date(g.createdAt).toLocaleString() : 'Just now',
      duration: g.durationSeconds || 0,
    }));
    renderGlimpses();
  } catch (e) { console.error('Failed to fetch glimpse', e); }
}

function renderGlimpses() {
  if (!notificationsContainer) return;
  if (!glimpses.length) {
    notificationsContainer.innerHTML = `<div class="no-notifications"><i class="fas fa-clapperboard"></i><h3>${t('reels_coming_soon')}</h3></div>`;
    return;
  }
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const currentUserId = String(user.id || user._id || '');
  const feedHtml = `
    <div class="glimpse-feed" id="glimpseFeed">
      ${glimpses.map(g => `
        <section class="glimpse-item" data-glimpse-id="${g.id}">
          <video class="glimpse-video" src="${g.video}" playsinline autoplay preload="metadata"></video>
          <div class="glimpse-overlay">
            <div class="post-overlay-info">
              <h3 class="post-title-overlay">${g.caption || ''}</h3>
              <div class="post-meta">
                <span><i class="fas fa-user"></i> ${g.author}</span>
                ${g.location ? `<span><i class=\"fas fa-map-marker-alt\"></i> ${g.location}</span>` : ''}
              </div>
            </div>
            <div class="post-actions-vertical" style="bottom:60px;">
              <button class="action-btn-vertical heart" data-glimpse-like="1" style="color: ${likedPosts.has('g:'+g.id) ? '#ef4444' : 'white'};">
                <i class="fas fa-heart"></i>
                <span>${g.likes}</span>
              </button>
              ${g.authorId === currentUserId ? `<button class="action-btn-vertical delete" data-glimpse-del="1" title="${t('delete')}"><i class="fas fa-trash"></i></button>` : ''}
            </div>
            <div class="glimpse-progress" style="position:absolute;left:16px;right:16px;bottom:12px;height:6px;background:rgba(255,255,255,.18);backdrop-filter:blur(2px);border-radius:999px;overflow:hidden;box-shadow:0 0 0 1px rgba(255,255,255,.25) inset;">
              <div class="gp-fill" style="height:100%;width:0%;background:linear-gradient(90deg,#22c55e,#3b82f6,#7c3aed);"></div>
            </div>
          </div>
        </section>
      `).join('')}
    </div>`;
  notificationsContainer.innerHTML = feedHtml;
  setupGlimpseFeedInteractions();
}

function setupGlimpseFeedInteractions() {
  const feed = document.getElementById('glimpseFeed');
  if (!feed) return;

  const nav = document.querySelector('.bottom-nav');
  const navH = (nav && nav.offsetHeight) ? nav.offsetHeight : 56;

  function layout() {
    const navHeight = (nav && nav.offsetHeight) ? nav.offsetHeight : 56;
    // Pin the feed to the viewport and reserve space for the bottom nav
    feed.style.position = 'fixed';
    feed.style.top = '0';
    feed.style.left = '0';
    feed.style.right = '0';
    feed.style.bottom = navHeight + 'px';
    feed.style.height = 'auto';
    feed.style.margin = '0';
    feed.style.padding = '0';
    feed.style.overflowY = 'auto';
    feed.style.webkitOverflowScrolling = 'touch';
    feed.style.scrollSnapType = 'y mandatory';
    const items = feed.querySelectorAll('.glimpse-item');
    items.forEach(it => {
      it.style.height = '100%';
      it.style.minHeight = '100%';
      it.style.scrollSnapAlign = 'start';
    });
  }
  layout();
  window.addEventListener('resize', layout);

  const items = Array.from(feed.querySelectorAll('.glimpse-item'));
  const videos = items.map(i => i.querySelector('video')).filter(Boolean);

  // Normalize videos (full-bleed, no borders/letterboxing)
  videos.forEach(v => {
    v.muted = false;
    v.removeAttribute('muted');
    v.autoplay = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.removeAttribute('controls');
    v.style.width = '100%';
    v.style.height = '100%';
    v.style.objectFit = 'cover';
    v.style.border = '0';
    v.style.background = 'transparent';
  });

  // Progress bar updates
  videos.forEach(v => {
    const item = v.closest('.glimpse-item');
    const fill = item ? item.querySelector('.gp-fill') : null;
    if (!fill) return;
    const update = () => {
      const d = v.duration || 0;
      const t = v.currentTime || 0;
      if (d > 0 && isFinite(d)) {
        const pct = Math.min(100, Math.max(0, (t / d) * 100));
        fill.style.width = pct + '%';
      }
    };
    v.addEventListener('timeupdate', update);
    v.addEventListener('loadedmetadata', update);
    v.addEventListener('seeked', update);
    v.addEventListener('ended', update);
    update();
  });

  // Scrubber: allow holding/dragging progress bar to seek
  function attachScrubber(item, video) {
  const bar = item.querySelector('.glimpse-progress');
  const fill = item.querySelector('.gp-fill');
  if (!bar || !video) return;

  // Make sure the bar is interactive above overlays
  bar.style.pointerEvents = 'auto';
  bar.style.touchAction = 'none';
  bar.style.zIndex = '6';

  let dragging = false;
  let wasPlaying = false;

  const seekToClientX = (clientX) => {
    const r = bar.getBoundingClientRect();
    let pct = (clientX - r.left) / r.width;
    pct = Math.max(0, Math.min(1, pct));
    if (video.duration && isFinite(video.duration)) {
      video.currentTime = pct * video.duration;
      if (fill) fill.style.width = (pct * 100) + '%';
    }
  };

  const onMove = (e) => {
    if (!dragging) return;
    const x = e.clientX ?? (e.touches && e.touches[0]?.clientX);
    if (x != null) seekToClientX(x);
    e.preventDefault();
    e.stopPropagation();
  };

  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    window.removeEventListener('touchmove', onMove, { passive: false });
    window.removeEventListener('touchend', end);
    window.removeEventListener('touchcancel', end);
    if (wasPlaying) video.play().catch(() => {});
    e.preventDefault();
    e.stopPropagation();
  };

  const start = (e) => {
    dragging = true;
    wasPlaying = !video.paused;
    video.pause();
    const x = e.clientX ?? (e.touches && e.touches[0]?.clientX);
    if (x != null) seekToClientX(x);

    // Capture global moves to keep scrubbing outside the bar bounds
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);

    e.preventDefault();
    e.stopPropagation();
  };

  // Pointer + touch (Safari fallback)
  bar.addEventListener('pointerdown', start);
  bar.addEventListener('touchstart', start, { passive: false });

  // Prevent feed-level click handler from toggling play/pause when using the bar
  ['click', 'mousedown', 'touchend'].forEach(evt =>
    bar.addEventListener(evt, (e) => { if (dragging) e.stopPropagation(); }, { passive: false })
  );
}

// Ensure scrubber is attached
items.forEach((it) => {
  const v = it.querySelector('video');
  if (v) attachScrubber(it, v);
});

  const io = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    const item = entry.target;
    const video = item.querySelector('video');
    if (!video) return;
    if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
      item.classList.add('active');
      video.muted = false;
      video.removeAttribute('muted');
      try { video.volume = 1.0; } catch (_) {}
      video.play().catch(() => {});
      const next = item.nextElementSibling?.querySelector?.('video');
      if (next && next.readyState < 2) next.load();
    } else {
      item.classList.remove('active');
      video.pause();
    }
  });
}, { root: feed, threshold: [0.6] });

  items.forEach(i => io.observe(i));

  // Tap to pause/play
  feed.addEventListener('click', (e) => {
    if (e.target.closest('button')) return; // ignore overlay action buttons
    const item = e.target.closest('.glimpse-item');
    const video = item?.querySelector('video');
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, { passive: true });

  // Start at first item instantly and try muted autoplay
  items[0]?.scrollIntoView({ behavior: 'instant', block: 'start' });
  if (videos[0]) { videos[0].play().catch(() => {}); }
}

// Fetch posts from backend
async function fetchPosts() {
  const token = localStorage.getItem('token');
  if (!token) return;

  try {
    const response = await fetch('/api/posts', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (loginPage) loginPage.style.display = 'flex';
      if (mainApp) mainApp.style.display = 'none';
      return;
    }

    const postsData = await response.json();

    // Get current user ID (ensure it's a string)
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const currentUserId = String(user.id || user._id || '');

    // Reset likedPosts
    likedPosts = new Set();

    // Process posts and check likes
    posts = postsData.map((post) => {
      const isLiked =
        Array.isArray(post.likes) &&
        post.likes.some((like) => {
          const likeIdStr =
            typeof like === 'object' && (like._id || like.id)
              ? String(like._id || like.id)
              : String(like);
          return likeIdStr === currentUserId;
        });

      if (isLiked) {
        likedPosts.add(String(post._id));
      }

      return {
        id: String(post._id),
        type: post.type,
        title: post.title,
        category: post.category || 'all',
        distance: post.distance || '0.1 km',
        time: post.createdAt
          ? new Date(post.createdAt).toLocaleString()
          : 'Just now',
        likes: post.likes ? post.likes.length : 0,
        comments: post.comments ? post.comments.length : 0,
        rsvp: post.rsvp || 0,
        image: post.image ? resolveMediaUrl(post.image) : getDefaultImage(post.type),
        location: post.location,
        author: post.author?.name || 'Unknown',
        authorId:
          (post.author && (post.author._id || post.author.id))
            ? String(post.author._id || post.author.id)
            : '',
        lat: post.coordinates?.lat,
        lng: post.coordinates?.lng,
        description: post.description || '',
        price: post.price || '',
        hashtags: post.hashtags || [],
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
  if (!salesContainer) return;
  const salesPosts = posts.filter((post) => post.type === 'sale');
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const currentUserId = String(user.id || user._id || '');

  salesContainer.innerHTML = salesPosts
    .map(
      (post) => `
      <div class="sale-card" data-post-id="${post.id}">
        <div class="sale-image-container">
          <img src="${post.image}" alt="${post.title}" class="sale-image">
        </div>
        <div class="sale-info-board">
          <h3 class="sale-title" style="margin-bottom: 12px;">${post.title}</h3>
          ${post.price ? `<div class="sale-price" style="margin-bottom: 12px;">${post.price}</div>` : ''}
          ${
            post.description
              ? `<p class="sale-description" style="font-weight: 700; color: var(--gray-900); margin-bottom: 16px;">${post.description}</p>`
              : ''
          }
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
          ${
            post.hashtags && post.hashtags.length > 0
              ? `
            <div class="sale-hashtags">
              ${post.hashtags.map((tag) => `<span class="hashtag">#${tag}</span>`).join('')}
            </div>
          `
              : ''
          }
          <div class="sale-actions">
            <button class="sale-action-btn favorite" style="color: ${
              likedPosts.has(String(post.id)) ? '#f59e0b' : '#64748b'
            };">
              <i class="fas fa-star"></i>
              <span>${t('favorite')}</span>
            </button>
            ${
              post.authorId === currentUserId
                ? `
            <button class="sale-action-btn delete">
              <i class="fas fa-trash"></i>
              <span>${t('delete')}</span>
            </button>
            `
                : ''
            }
          </div>
        </div>
      </div>
    `
    )
    .join('');
}

// Render users into Users tab (filters by search term)
function renderUsers(searchTerm = '') {
  if (!usersContainer) return;
  const filteredUsers = searchTerm
    ? users.filter((user) =>
        (user.name || '').toLowerCase().includes(searchTerm)
      )
    : users;

  usersContainer.innerHTML = filteredUsers
    .map((user) => {
      const initials = getInitials(user.name);
      const avatarUrl = user.avatarUrl ? resolveMediaUrl(user.avatarUrl) : '';
      const style = avatarUrl
        ? `style="background-image:url('${avatarUrl}'); background-size:cover; background-position:center; color: transparent;"`
        : '';
      const uid = String(user.id);
      return `
        <div class="user-card">
          <div class="user-avatar" ${style}>${user.avatar || initials}</div>
          <div class="user-info">
            <div class="user-name">${user.name}</div>
            <div class="user-stats">${user.posts || 0} ${t('posts_word')} • ${user.followers || 0} ${t(
        'followers_word'
      )}</div>
          </div>
          <div class="user-actions">
            <button class="${following.has(uid) ? 'following-btn' : 'follow-btn'}" data-user-id="${uid}">
              ${following.has(uid) ? t('following') : t('follow')}
            </button>
            <button class="contact-btn" data-user-id="${uid}">
              <i class="fas fa-envelope"></i>
            </button>
          </div>
        </div>`;
    })
    .join('');
}

// Helper: render users into an arbitrary container (Feed people results)
function renderUsersInto(el, list = []) {
  if (!el) return;
  el.innerHTML = list
    .map((user) => {
      const initials = getInitials(user.name);
      const avatarUrl = user.avatarUrl ? resolveMediaUrl(user.avatarUrl) : '';
      const style = avatarUrl
        ? `style="background-image:url('${avatarUrl}'); background-size:cover; background-position:center; color: transparent;"`
        : '';
      const uid = String(user.id);
      return `
      <div class="user-card" data-user-id="${uid}">
        <div class="user-avatar" ${style}>${user.avatar || initials}</div>
        <div class="user-info">
          <div class="user-name">${user.name}</div>
          <div class="user-stats">${user.posts || 0} ${t('posts_word')} • ${user.followers || 0} ${t(
        'followers_word'
      )}</div>
        </div>
        <div class="user-actions">
          <button class="${following.has(uid) ? 'following-btn' : 'follow-btn'}" data-user-id="${uid}">
            ${following.has(uid) ? t('following') : t('follow')}
          </button>
          <button class="contact-btn" data-user-id="${uid}">
            <i class="fas fa-envelope"></i>
          </button>
        </div>
      </div>`;
    })
    .join('');
}

// Toggle follow (UI-only helper; server persistence handled in event listener)
function toggleFollow(userId, button) {
  const uid = String(userId);
  if (following.has(uid)) {
    following.delete(uid);
    button.textContent = t('follow');
    button.classList.remove('following-btn');
    button.classList.add('follow-btn');
  } else {
    following.add(uid);
    button.textContent = t('following');
    button.classList.remove('follow-btn');
    button.classList.add('following-btn');
  }
}

// Show user profile modal
function showUserProfile(user) {
  if (userProfileName) userProfileName.textContent = user.name;
  const initials = getInitials(user.name);
  const avatarUrl = user.avatarUrl ? resolveMediaUrl(user.avatarUrl) : '';
  const avatarStyle = avatarUrl
    ? `background-image:url('${avatarUrl}'); background-size:cover; background-position:center; color: transparent;`
    : '';
  if (userProfileContent) {
    userProfileContent.innerHTML = `
      <div style="text-align: center; margin-bottom: 24px;">
        <div class="user-avatar" style="width: 64px; height: 64px; margin: 0 auto 16px; ${avatarStyle}">${user.avatar || initials}</div>
        <div style="font-weight: 600; margin-bottom: 8px;">${user.name}</div>
        <div style="color: var(--gray-600); font-size: 14px;">${user.posts || 0} ${t(
          'posts_word'
        )} • ${user.followers || 0} ${t('followers_word')}</div>
      </div>
      <div style="margin-bottom: 16px;">
        <h3 style="font-weight: 600; margin-bottom: 8px;">${t('recent_posts')}</h3>
        <div style="max-height: 200px; overflow-y: auto;">
          ${
            posts
              .filter((post) => post.author === user.name)
              .slice(0, 3)
              .map(
                (post) => `
            <div class="post-card" style="margin-bottom: 12px;">
              <img src="${post.image}" alt="${post.title}" class="post-image" style="height: 120px;">
              <div class="post-content" style="padding: 12px;">
                <h4 class="post-title" style="font-size: 14px; margin-bottom: 4px;">${post.title}</h4>
                <div class="post-info" style="font-size: 11px;">
                  <i class="fas fa-clock"></i> ${post.time}
                </div>
              </div>
            </div>
          `
              )
              .join('') ||
            `<p style="color: var(--gray-600); text-align: center;">${t('no_posts_yet')}</p>`
          }
        </div>
      </div>
      <div style="display: flex; gap: 12px;">
        <button class="${following.has(String(user.id)) ? 'following-btn' : 'follow-btn'}" style="flex: 1;" data-user-id="${String(user.id)}">
          ${following.has(String(user.id)) ? t('following') : t('follow')}
        </button>
        <button class="contact-btn" style="flex: 1;" onclick="sendMessage('${user.name}')">
          ${t('send_message')}
        </button>
      </div>
    `;
  }
  if (userProfileModal) userProfileModal.classList.add('active');
}

// Hide user profile modal
function hideUserProfileModal() {
  if (userProfileModal) userProfileModal.classList.remove('active');
}

// Send message (placeholder)
function sendMessage(username) {
  alert(`${t('send_message')} ${username}!`);
  hideUserProfileModal();
}

// Show notifications modal
async function showNotificationsModal() {
  await fetchNotifications();

  if (notificationsModalContent) {
    if (appNotifications.length > 0) {
      notificationsModalContent.innerHTML = `
        <div style="padding: 8px 0; display: flex; flex-direction: column; gap: 12px;">
          ${appNotifications
            .map((n) => {
              const actor = n.actor?.name || 'Someone';
              const postTitle = n.post?.title || 'your post';
              const msg =
                n.type === 'like'
                  ? `${t('post_liked')}: "${postTitle}" — ${actor}`
                  : n.message || t('notification_word');
              return `
              <div style="padding: 12px; border: 1px solid var(--gray-200); border-radius: 12px; background: white;">
                <div style="font-weight: 600; margin-bottom: 6px;">${
                  n.type === 'like' ? t('post_liked') : t('notification_word')
                }</div>
                <div style="color: var(--gray-900); margin-bottom: 4px;">${msg}</div>
                <div style="font-size: 12px; color: var(--gray-600);">${new Date(
                  n.createdAt
                ).toLocaleString()}</div>
              </div>`;
            })
            .join('')}
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
  }

  if (notificationsModal) notificationsModal.classList.add('active');

  // Mark as read when opened
  const token = localStorage.getItem('token');
  if (token) {
    try {
      await fetch('/api/notifications/mark-read', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
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
