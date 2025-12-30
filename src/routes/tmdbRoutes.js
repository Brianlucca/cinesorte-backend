const express = require('express');
const router = express.Router();
const tmdbController = require('../controllers/tmdbController');
const { verifyToken } = require('../middleware/authMiddleware');

router.get('/genres/:mediaType', tmdbController.getGenres);
router.get('/trending/:timeWindow', tmdbController.getTrending);
router.get('/recommendations/:mediaType', verifyToken, tmdbController.getRecommendations);
router.get('/search', tmdbController.searchMulti);
router.get('/details/:mediaType/:id', tmdbController.getDetails);
router.get('/providers/:mediaType/:id', tmdbController.getProviders);

module.exports = router;