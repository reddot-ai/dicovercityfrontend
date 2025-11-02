const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');

// NSFW detection (prefer tfjs-node when available)
let tf;
try { tf = require('@tensorflow/tfjs-node'); } catch { tf = require('@tensorflow/tfjs'); }
const nsfw = require('nsfwjs');
const { createCanvas, loadImage } = require('canvas');

const app = express();

const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// NSFW configuration (tweak via environment variables)
const NSFW_CFG = {
  FAIL_OPEN: process.env.NSFW_FAIL_OPEN === 'true', // default false: if model errors, block upload unless explicitly allowed
  BLOCK_CORE: parseFloat(process.env.NSFW_BLOCK_CORE || '0.55'),
  MARGIN_CORE: parseFloat(process.env.NSFW_MARGIN_CORE || '0.15'),
  BLOCK_SEXY: parseFloat(process.env.NSFW_BLOCK_SEXY || '0.9'),
  MARGIN_SEXY: parseFloat(process.env.NSFW_MARGIN_SEXY || '0.2'),
  LOG_SCORES: process.env.NSFW_LOG_SCORES === 'true',
  STRICT: process.env.NSFW_STRICT === 'true',
  DISABLE: process.env.NSFW_DISABLE === 'true'
};

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer configuration for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({
  storage,
  limits: { fileSize: 10_000_000 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype?.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed!'));
  }
});

// Multer configuration for video uploads (Glimpse)
const videoUpload = multer({
  storage,
  limits: { fileSize: 200_000_000 }, // 200MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype?.startsWith('video/')) cb(null, true);
    else cb(new Error('Only video files are allowed!'));
  }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));

// Serve frontend static assets
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND_DIR));

// Allowed cities and defaults for coordinates
const ALLOWED_CITIES = ["Chișinău", "Ştefan Vodă"];
const CITY_COORDS = {
  "Chișinău": { lat: 47.0105, lng: 28.8638 },
  "Ştefan Vodă": { lat: 46.5134, lng: 29.6619 }
};
const normalizeCity = c => (typeof c === 'string' ? c.trim() : '');
const getValidCity = c => {
  const n = normalizeCity(c);
  return ALLOWED_CITIES.includes(n) ? n : '';
};

if (NSFW_CFG.LOG_SCORES) {
  console.log('NSFW_LOG_SCORES enabled');
}

// MongoDB connection
mongoose.connect(process.env.MONGO_URL || 'mongodb://localhost:27017/discover-city')
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Schemas and Models
const userSchema = new mongoose.Schema({
  name: { type: String, index: 'text' },
  email: { type: String, unique: true },
  password: String,
  city: { type: String, default: '' },
  avatar: String, // URL
  followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }],
  following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }]
});
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});
const User = mongoose.model('User', userSchema);

const postSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  type: { type: String, enum: ['event', 'discovery', 'challenge', 'post', 'sale'], required: true },
  category: { type: String, enum: ['music', 'food', 'art', 'sports', 'nightlife', 'all'], default: 'all' },
  location: { type: String, required: true },
  coordinates: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true }
  },
  image: { type: String, default: '' },
  hashtags: [{ type: String }],
  price: { type: String, default: '' },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  comments: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  }],
  rsvp: { type: Number, default: 0 },
  eventDate: Date,
  distance: { type: String, default: '0 km' },
  createdAt: { type: Date, default: Date.now }
});
// Index location for faster city filtering
postSchema.index({ location: 1 });
const Post = mongoose.model('Post', postSchema);

// Glimpse (short video) schema
const glimpseSchema = new mongoose.Schema({
  caption: { type: String, default: '' },
  video: { type: String, required: true }, // URL
  durationSeconds: { type: Number, default: 0 },
  location: { type: String, required: true },
  coordinates: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true }
  },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  comments: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});
glimpseSchema.index({ location: 1, createdAt: -1 });
const Glimpse = mongoose.model('Glimpse', glimpseSchema);

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },   // recipient
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },  // actor
  type: { type: String, enum: ['like','follow'], required: true },
  post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
  message: { type: String, default: '' },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Notification = mongoose.model('Notification', notificationSchema);

// Auth middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(401).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
};

// NSFW model helpers
let nsfwModel = null;
let nsfwModelPromise = null;
async function getNSFWModel() {
  if (nsfwModel) return nsfwModel;
  if (!nsfwModelPromise) {
    try { await tf.ready(); } catch (_) {}
    // Load NSFWJS model; if network is unavailable, this may throw.
    nsfwModelPromise = nsfw.load('MobileNetV2');
  }
  nsfwModel = await nsfwModelPromise;
  if (!nsfwModel) throw new Error('NSFW model failed to load');
  return nsfwModel;
}
async function isImageSafe(absPath) {
  if (NSFW_CFG.DISABLE) return true;
  try {
    const model = await getNSFWModel();
    const buf = fs.readFileSync(absPath);

    const inputs = [];
    let base;
    const hasTfNode = !!(tf?.node && typeof tf.node.decodeImage === 'function');
    if (hasTfNode) {
      base = tf.node.decodeImage(buf, 3);
      inputs.push(base);
      if (base && base.shape && tf?.image?.flipLeftRight) {
        try { inputs.push(tf.image.flipLeftRight(base)); } catch (_) {}
      }
    } else {
      // Canvas path for environments without tfjs-node: build Tensor3D from pixel data
      const img = await loadImage(absPath);
      const cnv = createCanvas(img.width, img.height);
      const ctx = cnv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const { data, width, height } = imageData;
      const rgb = new Uint8Array(width * height * 3);
      for (let i = 0, j = 0; i < data.length; i += 4) {
        rgb[j++] = data[i];     // R
        rgb[j++] = data[i + 1]; // G
        rgb[j++] = data[i + 2]; // B
      }
      base = tf.tensor3d(rgb, [height, width, 3], 'int32');
      inputs.push(base);
      try {
        const flipped = tf.reverse(base, 1); // horizontal flip along width axis
        inputs.push(flipped);
      } catch (_) {}
    }

    const predsArr = [];
    for (const inp of inputs) {
      const preds = await model.classify(inp);
      predsArr.push(preds);
    }

    for (const inp of inputs) {
      if (inp && typeof inp.dispose === 'function') {
        try { inp.dispose(); } catch (_) {}
      }
    }

    if (!predsArr.length) return true; // nothing classified, allow

    const classes = ['Porn','Hentai','Sexy','Neutral','Drawing'];
    const avg = Object.fromEntries(classes.map(c => [c, 0]));
    for (const c of classes) {
      avg[c] = predsArr.reduce((sum, preds) => sum + ((preds.find(p => p.className === c)?.probability) || 0), 0) / predsArr.length;
    }

    if (NSFW_CFG.LOG_SCORES) {
      console.log('NSFW scores:', avg);
    }

    const porn = avg.Porn, hentai = avg.Hentai, sexy = avg.Sexy;
    const neutral = avg.Neutral, drawing = avg.Drawing;
    const sfw = (neutral || 0) + (drawing || 0);

    const core = Math.max(porn || 0, hentai || 0);

    let block = false;
    if (NSFW_CFG.STRICT) {
      const nsfwSum = (porn || 0) + (hentai || 0) + (sexy || 0);
      const blockByCoreStrict = core >= 0.35 || (core >= 0.3 && sfw <= 0.2);
      const blockBySexyStrict = (sexy || 0) >= 0.5 && (sexy || 0) > sfw;
      const blockBySumStrict = nsfwSum >= 0.6 && core > 0.25;
      block = blockByCoreStrict || blockBySexyStrict || blockBySumStrict;
      if (NSFW_CFG.LOG_SCORES) console.log('NSFW decision (strict):', { core, sexy, sfw, nsfwSum, block });
    } else {
      const blockByCore = core >= NSFW_CFG.BLOCK_CORE && core > sfw + NSFW_CFG.MARGIN_CORE;
      const blockBySexy = (sexy || 0) >= NSFW_CFG.BLOCK_SEXY && (sexy || 0) > sfw + NSFW_CFG.MARGIN_SEXY;
      block = blockByCore || blockBySexy;
      if (NSFW_CFG.LOG_SCORES) console.log('NSFW decision (default):', { core, sexy, sfw, block });
    }

    return !block;
  } catch (e) {
    console.warn('NSFW check error:', e?.message || e);
    // Default fail-closed unless explicitly configured to fail-open.
    return !!NSFW_CFG.FAIL_OPEN;
  }
}

// Basic text moderation (keyword-based). Replace/extend with provider API if desired.
const NSFW_KEYWORDS = [
  'porn','xxx','sex','hentai','nude','nudity','nsfw','cum','blowjob','boobs','ass','anal','fuck','dick','pussy','cock','vagina','breasts','nipple','erotic'
];
const NSFW_REGEX = new RegExp(`\\b(${NSFW_KEYWORDS.map(k => k.replace(/[.*+?^${}()|[\\]\\]/g, '\\\\$&')).join('|')})\\b`, 'i');
function isTextSafe({ title = '', description = '', hashtags = [] }) {
  const text = [title, description, ...(Array.isArray(hashtags) ? hashtags : [])].join(' ');
  return !NSFW_REGEX.test(text);
}

// AUTH ROUTES
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const user = new User({ name, email, password });
    await user.save();
    const token = jwt.sign({ id: user._id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
res.status(201).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        followers: user.followers.length,
        following: user.following.length,
        avatar: user.avatar || '',
        city: user.city || ''
      }
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user._id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        followers: user.followers.length,
        following: user.following.length,
        avatar: user.avatar || '',
        city: user.city || ''
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// USER ROUTES

// Search users by name (preferred by frontend)
app.get('/api/users/search', authenticateToken, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const match = q ? { name: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {};
    const users = await User.find(match).limit(25).select('_id name avatar followers');
    res.json(users.map(u => ({
      _id: u._id,
      name: u.name,
      avatarUrl: u.avatar || '',
      followersCount: Array.isArray(u.followers) ? u.followers.length : 0
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List users (supports ?search= as fallback)
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const q = String(req.query.search || '').trim();
    const match = q ? { name: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {};
    const users = await User.find(match).select('-password');
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Current user basic info (including city)
app.get('/api/me', authenticateToken, async (req, res) => {
  try {
    const u = await User.findById(req.user.id).select('name email avatar followers following city');
    if (!u) return res.status(404).json({ error: 'Not found' });
    res.json({
      id: u._id,
      name: u.name,
      email: u.email,
      avatar: u.avatar || '',
      followers: Array.isArray(u.followers) ? u.followers.length : 0,
      following: Array.isArray(u.following) ? u.following.length : 0,
      city: u.city || ''
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Current user's following set (for persistence in UI)
app.get('/api/me/following', authenticateToken, async (req, res) => {
  try {
    const me = await User.findById(req.user.id).select('following');
    if (!me) return res.status(404).json({ error: 'Not found' });
    res.json({ following: (me.following || []).map(id => String(id)) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Set or update preferred city for the current user
app.put('/api/me/city', authenticateToken, async (req, res) => {
  try {
    const { city } = req.body || {};
    if (typeof city !== 'string' || !city.trim()) return res.status(400).json({ error: 'city is required' });
    const me = await User.findByIdAndUpdate(req.user.id, { $set: { city: city.trim() } }, { new: true }).select('city');
    if (!me) return res.status(404).json({ error: 'Not found' });
    res.json({ city: me.city || '' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cities for dropdown (fixed set)
app.get('/api/cities', authenticateToken, async (req, res) => {
  try {
    res.json(ALLOWED_CITIES);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Follow (idempotent follow) - preferred by frontend
app.post('/api/users/:id/follow', authenticateToken, async (req, res) => {
  try {
    const targetId = req.params.id;
    if (String(targetId) === String(req.user.id)) return res.status(400).json({ error: 'Cannot follow yourself' });

    const [userToFollow, currentUser] = await Promise.all([
      User.findById(targetId),
      User.findById(req.user.id)
    ]);
    if (!userToFollow || !currentUser) return res.status(404).json({ error: 'User not found' });

    const already = currentUser.following.some(id => String(id) === String(userToFollow._id));
    if (!already) {
      currentUser.following.push(userToFollow._id);
      userToFollow.followers.push(currentUser._id);
      await Promise.all([currentUser.save(), userToFollow.save()]);

      // Create follow notification in Romanian as requested
      try {
        await Notification.create({
          user: userToFollow._id,
          actor: currentUser._id,
          type: 'follow',
          message: `Ai un urmaritor nou!: ${currentUser.name}`
        });
      } catch (_) {}
    }

    res.json({ followersCount: (userToFollow.followers || []).length, following: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Unfollow (idempotent)
app.delete('/api/users/:id/follow', authenticateToken, async (req, res) => {
  try {
    const targetId = req.params.id;
    const [userToUnfollow, currentUser] = await Promise.all([
      User.findById(targetId),
      User.findById(req.user.id)
    ]);
    if (!userToUnfollow || !currentUser) return res.status(404).json({ error: 'User not found' });

    currentUser.following = (currentUser.following || []).filter(id => String(id) !== String(userToUnfollow._id));
    userToUnfollow.followers = (userToUnfollow.followers || []).filter(id => String(id) !== String(currentUser._id));
    await Promise.all([currentUser.save(), userToUnfollow.save()]);

    res.json({ followersCount: (userToUnfollow.followers || []).length, following: false });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Backward-compatible toggle (PUT) — also emits notification on follow
app.put('/api/users/:id/follow', authenticateToken, async (req, res) => {
  try {
    const userToFollow = await User.findById(req.params.id);
    const currentUser = await User.findById(req.user.id);
    if (!userToFollow || !currentUser) return res.status(404).json({ error: 'User not found' });

    const isFollowing = currentUser.following.some(id => id.toString() === userToFollow._id.toString());
    if (isFollowing) {
      currentUser.following = currentUser.following.filter(id => id.toString() !== userToFollow._id.toString());
      userToFollow.followers = userToFollow.followers.filter(id => id.toString() !== currentUser._id.toString());
    } else {
      currentUser.following.push(userToFollow._id);
      userToFollow.followers.push(currentUser._id);
      try {
        await Notification.create({
          user: userToFollow._id,
          actor: currentUser._id,
          type: 'follow',
          message: `Ai un urmaritor nou!: ${currentUser.name}`
        });
      } catch (_) {}
    }

    await currentUser.save();
    await userToFollow.save();
    res.json({ following: !isFollowing, followersCount: (userToFollow.followers || []).length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST ROUTES
app.get('/api/posts', authenticateToken, async (req, res) => {
  try {
    const qCity = (req.query.city || '').toString().trim();
    let filter = {};
    if (qCity) {
      filter.location = qCity;
    } else {
      try {
        const me = await User.findById(req.user.id).select('city');
        if (me && me.city) filter.location = me.city;
      } catch (_) {}
    }
    const posts = await Post.find(filter).populate('author', 'name').sort({ createdAt: -1 });
    res.json(posts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/posts', authenticateToken, upload.any(), async (req, res) => {
  try {
    const postData = req.body.data ? JSON.parse(req.body.data) : req.body;
    const {
      title, description, type, category = 'all', location,
      lat, lng, hashtags = [], price, eventDate, image: imageField, imageBase64
    } = postData;

if (!title || !type) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Text moderation
    if (!isTextSafe({ title, description, hashtags })) {
      const f0 = Array.isArray(req.files) && req.files[0];
      if (f0) {
        try { fs.unlinkSync(path.join(__dirname, 'uploads', f0.filename)); } catch (_) {}
      }
      return res.status(400).json({ error: 'content violates policy' });
    }

    let imageUrl = '';
    let fileObj = Array.isArray(req.files) && req.files.length ? req.files[0] : null;

    // Support base64 data URLs sent in JSON
    if (!fileObj && (typeof imageBase64 === 'string' || typeof imageField === 'string')) {
      const dataUrl = (typeof imageBase64 === 'string' ? imageBase64 : imageField) || '';
      const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (m) {
        const ext = m[1].split('/')[1].replace(/\+/g, '');
        const filename = `${Date.now()}.${ext || 'png'}`;
        const abs = path.join(__dirname, 'uploads', filename);
        try {
          fs.writeFileSync(abs, Buffer.from(m[2], 'base64'));
          fileObj = { filename };
        } catch (_) {}
      }
    }

    if (fileObj) {
      const absPath = path.join(__dirname, 'uploads', fileObj.filename);
      if (NSFW_CFG.LOG_SCORES) console.log('Moderating image:', absPath);
      const safe = await isImageSafe(absPath);
      if (!safe) {
        try { fs.unlinkSync(absPath); } catch (_) {}
        return res.status(400).json({ error: 'image violates policy' });
      }
      imageUrl = `/uploads/${fileObj.filename}`;
    }

    // Enforce posting within the user's selected city only
    const meForCity = await User.findById(req.user.id).select('city');
    const cityToUse = getValidCity(meForCity?.city);
    if (!cityToUse) return res.status(400).json({ error: 'please set your city before posting' });
    const latNum = Number.isFinite(parseFloat(lat)) ? parseFloat(lat) : (CITY_COORDS[cityToUse]?.lat ?? NaN);
    const lngNum = Number.isFinite(parseFloat(lng)) ? parseFloat(lng) : (CITY_COORDS[cityToUse]?.lng ?? NaN);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      return res.status(400).json({ error: 'missing coordinates for selected city' });
    }

    const post = new Post({
      title,
      description,
      type,
      category,
      location: cityToUse,
      coordinates: { lat: latNum, lng: lngNum },
      image: imageUrl,
      hashtags: Array.isArray(hashtags) ? hashtags : [],
      price: price || '',
      author: req.user.id,
      eventDate: type === 'event' ? eventDate : undefined
    });

    await post.save();
    const populatedPost = await Post.findById(post._id).populate('author', 'name');
    res.status(201).json(populatedPost);
  } catch (error) {
    console.error('Post creation error:', error);
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/posts/:id/like', authenticateToken, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const idx = post.likes.findIndex(id => id.toString() === req.user.id.toString());
    const wasLiked = idx === -1;
    if (wasLiked) post.likes.push(req.user.id);
    else post.likes.splice(idx, 1);

    await post.save();

    if (wasLiked && post.author && post.author.toString() !== req.user.id.toString()) {
      await Notification.create({
        user: post.author,
        actor: req.user.id,
        type: 'like',
        post: post._id,
        message: '' // message optional; UI composes from type/post
      });
    }

    res.json({ likes: post.likes.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/posts/:id/rsvp', authenticateToken, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    post.rsvp += 1;
    await post.save();
    res.json({ rsvp: post.rsvp });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/posts/:id', authenticateToken, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.author.toString() !== req.user.id.toString()) {
      return res.status(403).json({ error: 'Not authorized to delete this post' });
    }

    if (post.image) {
      try {
        const rel = post.image.startsWith('/') ? post.image.slice(1) : post.image;
        const filePath = path.join(__dirname, rel);
        fs.unlink(filePath, () => {});
      } catch (_) {}
    }

    try { await Notification.deleteMany({ post: post._id }); } catch (_) {}
    await post.deleteOne();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// NOTIFICATION ROUTES
app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .populate('actor', 'name')
      .populate('post', 'title');
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/notifications/mark-read', authenticateToken, async (req, res) => {
  try {
    await Notification.updateMany({ user: req.user.id, read: false }, { $set: { read: true } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Optional: allow client to create a notification (used by older UI fallback)
app.post('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const { to, type, title, message, post } = req.body || {};
    if (!to || !type) return res.status(400).json({ error: 'Missing fields' });
    const doc = await Notification.create({
      user: to,
      actor: req.user.id,
      type,
      post: post || undefined,
      message: message || '',
    });
    res.json(doc);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GLIMPSE ROUTES (short videos)
app.get('/api/glimpse', authenticateToken, async (req, res) => {
  try {
    const qCity = (req.query.city || '').toString().trim();
    let filter = {};
    if (qCity) {
      filter.location = qCity;
    } else {
      try {
        const me = await User.findById(req.user.id).select('city');
        if (me && me.city) filter.location = me.city;
      } catch (_) {}
    }
    const items = await Glimpse.find(filter).populate('author', 'name').sort({ createdAt: -1 });
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/glimpse', authenticateToken, videoUpload.single('video'), async (req, res) => {
  try {
    const data = req.body.data ? JSON.parse(req.body.data) : req.body;
    const { caption = '', durationSeconds = 0, lat, lng } = data;

    // Enforce 30s max duration (client also checks)
    const dur = Number(durationSeconds) || 0;
    if (dur > 30.5) return res.status(400).json({ error: 'video too long' });

    if (!req.file) return res.status(400).json({ error: 'video is required' });

    const meForCity = await User.findById(req.user.id).select('city');
    const cityToUse = getValidCity(meForCity?.city);
    if (!cityToUse) return res.status(400).json({ error: 'please set your city before posting' });
    const latNum = Number.isFinite(parseFloat(lat)) ? parseFloat(lat) : (CITY_COORDS[cityToUse]?.lat ?? NaN);
    const lngNum = Number.isFinite(parseFloat(lng)) ? parseFloat(lng) : (CITY_COORDS[cityToUse]?.lng ?? NaN);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      return res.status(400).json({ error: 'missing coordinates for selected city' });
    }

    const videoUrl = `/uploads/${req.file.filename}`;
    const doc = await Glimpse.create({
      caption,
      video: videoUrl,
      durationSeconds: dur,
      location: cityToUse,
      coordinates: { lat: latNum, lng: lngNum },
      author: req.user.id,
    });
    const populated = await Glimpse.findById(doc._id).populate('author', 'name');
    res.status(201).json(populated);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/glimpse/:id/like', authenticateToken, async (req, res) => {
  try {
    const item = await Glimpse.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    const idx = item.likes.findIndex(id => String(id) === String(req.user.id));
    if (idx === -1) item.likes.push(req.user.id); else item.likes.splice(idx,1);
    await item.save();
    res.json({ likes: item.likes.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/glimpse/:id', authenticateToken, async (req, res) => {
  try {
    const item = await Glimpse.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    if (String(item.author) !== String(req.user.id)) return res.status(403).json({ error: 'Not authorized' });

    if (item.video) {
      try {
        const rel = item.video.startsWith('/') ? item.video.slice(1) : item.video;
        const filePath = path.join(__dirname, rel);
        fs.unlink(filePath, () => {});
      } catch (_) {}
    }
    await item.deleteOne();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Root -> serve SPA index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// SPA fallback for all non-API routes (Express 5 compatible)
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// Error handler (last)
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: 'File upload error: ' + error.message });
  } else if (error?.message?.includes('Only image files')) {
    return res.status(400).json({ error: 'Only image files are allowed!' });
  }
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Server error' });
});

function getLANIPv4() {
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if ((net.family === 'IPv4' || net.family === 4) && !net.internal) return net.address;
      }
    }
  } catch (_) {}
  return 'localhost';
}

app.listen(PORT, HOST, () => {
  const ip = getLANIPv4();
  console.log(`🚀 Server running on:`);
  console.log(`   - Local:  http://localhost:${PORT}`);
  console.log(`   - LAN:    http://${ip}:${PORT}`);
});