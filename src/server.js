const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
require('dotenv').config();

const tmdbRoutes = require('./routes/tmdbRoutes');
const interactionRoutes = require('./routes/interactionRoutes');
const socialRoutes = require('./routes/socialRoutes');
const authRoutes = require('./routes/authRoutes');
const { tmdbApiLimiter, sanitizeInput } = require('./middleware/securityMiddleware');
const { startKeepAlive } = require('./services/keepAliveService');

const app = express();
const PORT = process.env.PORT || 3001;

const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigin = process.env.FRONTEND_URL;
    if (!origin || !allowedOrigin) {
      callback(null, true);
      return;
    }
    const normalizedAllowedOrigin = allowedOrigin.endsWith('/') ? allowedOrigin.slice(0, -1) : allowedOrigin;
    const normalizedOrigin = origin.endsWith('/') ? origin.slice(0, -1) : origin;

    if (normalizedOrigin === normalizedAllowedOrigin) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
};

app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

app.use(sanitizeInput);

app.get('/', (req, res) => {
  res.json({ message: 'Cinesorte API is running' });
});

app.use('/api/tmdb', tmdbApiLimiter, tmdbRoutes);
app.use('/api/users', authRoutes);
app.use('/api/users', interactionRoutes);
app.use('/api/social', socialRoutes);

if (process.env.NODE_ENV === 'production') {
  startKeepAlive();
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});