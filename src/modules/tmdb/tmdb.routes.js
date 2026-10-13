const express = require('express');
const router = express.Router();
const tmdbController = require("./tmdb.controller");
const { verifyToken } = require("../../shared/middleware/auth");

router.use((req, res, next) => {
  if (req.path.startsWith("/recommendations/")) {
    res.set("Cache-Control", "private, no-store");
  } else {
    res.set(
      "Cache-Control",
      "public, max-age=60, stale-while-revalidate=300",
    );
  }
  next();
});

router.get('/genres', tmdbController.getGenres);
router.get('/trending/:timeWindow', tmdbController.getTrending);
router.get('/discover', tmdbController.getDiscover);
router.get('/now-playing', tmdbController.getNowPlaying);
router.get('/latest-trailers', tmdbController.getLatestTrailers);
router.get('/anime-releases', tmdbController.getAnimeReleases);
router.get('/animations', tmdbController.getAnimations);
router.get('/recommendations/:mediaType', verifyToken, tmdbController.getRecommendations);
router.get('/search', tmdbController.searchMulti);
router.get('/details/:mediaType/:id', tmdbController.getDetails);
router.get('/details/person/:id/external_ids', tmdbController.getPersonExternalIds);
router.get('/details/person/:id/tagged-images', tmdbController.getPersonTaggedImages);
router.get('/details/person/:id/filmography', tmdbController.getPersonFilmography);
router.get('/details/tv/:id/season/:seasonNumber', tmdbController.getSeasonDetails);
router.get('/details/tv/:id/season/:seasonNumber/episode/:episodeNumber', tmdbController.getEpisodeDetails);
router.get('/providers/:mediaType/:id', tmdbController.getProviders);
router.get('/awards/:id', tmdbController.getAwards);

module.exports = router;
