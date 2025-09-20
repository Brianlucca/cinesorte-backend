const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const tmdbRoutes = require('./routes/tmdbRoutes');
const userRoutes = require('./routes/userRoutes');

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

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

app.get('/', (req, res) => {
  res.json({ message: 'API do Cinesorte está no ar!' });
});

app.use('/api/tmdb', tmdbRoutes);
app.use('/api/users', userRoutes);

app.listen(PORT, () => {
  console.log(`Servidor Cinesorte rodando na porta ${PORT}`);
});