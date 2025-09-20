const express = require('express');
const cors = require('cors');
require('dotenv').config();

const tmdbRoutes = require('./routes/tmdbRoutes');
const userRoutes = require('./routes/userRoutes');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'API do Cinesorte está no ar!' });
});

app.use('/api/tmdb', tmdbRoutes);
app.use('/api/users', userRoutes);

app.listen(PORT, () => {
  console.log(`Servidor Cinesorte rodando na porta ${PORT}`);
});