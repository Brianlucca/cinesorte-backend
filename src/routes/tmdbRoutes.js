const express = require('express');
const router = express.Router();
const tmdbController = require('../controllers/tmdbController');

router.get('/genres/:mediaType', tmdbController.getGenres);
router.post('/discover', tmdbController.getDiscover);
router.get('/search', tmdbController.searchMulti);
router.get('/details/:mediaType/:id', tmdbController.getDetails);
router.get('/providers/:mediaType/:id', tmdbController.getProviders);

module.exports = router;