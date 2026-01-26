const express = require('express');
const router = express.Router();
const tmdbController = require('../controllers/tmdbController');
const { verifyToken } = require('../middleware/authMiddleware');
const { tmdbApiLimiter } = require('../middleware/securityMiddleware');

router.use(tmdbApiLimiter);

router.get('/genres', tmdbController.getGenres);
router.get('/trending/:timeWindow', tmdbController.getTrending);
router.get('/discover', tmdbController.getDiscover);
router.get('/latest-trailers', tmdbController.getLatestTrailers);
router.get('/anime-releases', tmdbController.getAnimeReleases);
router.get('/animations', tmdbController.getAnimations);
router.get('/recommendations/:mediaType', verifyToken, tmdbController.getRecommendations);
router.get('/search', tmdbController.searchMulti);
router.get('/details/:mediaType/:id', tmdbController.getDetails);
router.get('/details/person/:id/external_ids', tmdbController.getPersonExternalIds);
router.get('/details/tv/:id/season/:seasonNumber', tmdbController.getSeasonDetails);
router.get('/details/tv/:id/season/:seasonNumber/episode/:episodeNumber', tmdbController.getEpisodeDetails);
router.get('/providers/:mediaType/:id', tmdbController.getProviders);
router.get('/awards/:id', tmdbController.getAwards);



module.exports = router;