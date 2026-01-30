const tmdbApi = require("../api/tmdb");
const { db } = require("../config/firebase");
const catchAsync = require("../utils/catchAsync");

exports.getRecommendations = catchAsync(async (req, res, next) => {
  if (!req.user || !req.user.uid) {
    const response = await tmdbApi.get(`/discover/${req.params.mediaType}`, {
      params: { language: "pt-BR", sort_by: "popularity.desc" },
    });
    return res.status(200).json(response.data.results);
  }
  const { uid } = req.user;
  const { mediaType } = req.params;
  const page = req.query.page || 1;
  const userDoc = await db.collection("users").doc(uid).get();
  const genreCounts = userDoc.exists ? userDoc.data().genreCounts || {} : {};
  const sortedGenres = Object.entries(genreCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([id]) => id)
    .join(",");
  const params = { page, language: "pt-BR" };
  if (sortedGenres) params.with_genres = sortedGenres;
  const response = await tmdbApi.get(`/discover/${mediaType}`, { params });
  const interactionsSnap = await db
    .collection("interactions")
    .where("userId", "==", uid)
    .select("mediaId")
    .get();
  const seenIds = new Set(interactionsSnap.docs.map((d) => d.data().mediaId));
  const filtered = response.data.results.filter(
    (i) => !seenIds.has(i.id.toString()),
  );
  res.status(200).json(filtered);
});

exports.getTrending = catchAsync(async (req, res, next) => {
  const { timeWindow } = req.params;
  const response = await tmdbApi.get(`/trending/all/${timeWindow}`, {
    params: { language: "pt-BR" },
  });
  res.status(200).json(response.data.results);
});

exports.getDiscover = catchAsync(async (req, res, next) => {
  const {
    with_genres,
    page,
    media_type,
    sort_by,
    provider_id,
    monetization_types,
  } = req.query;
  const type = media_type || "movie";
  const params = {
    page: page || 1,
    language: "pt-BR",
    include_adult: false,
    "vote_count.gte": 50,
    sort_by: sort_by || "popularity.desc",
    watch_region: "BR",
  };
  if (with_genres) params.with_genres = with_genres;
  if (provider_id) params.with_watch_providers = provider_id;
  if (monetization_types)
    params.with_watch_monetization_types = monetization_types;
  const response = await tmdbApi.get(`/discover/${type}`, { params });
  const results = response.data.results.map((item) => ({
    ...item,
    media_type: type,
  }));
  res.status(200).json(results);
});

exports.getNowPlaying = catchAsync(async (req, res, next) => {
  const response = await tmdbApi.get("/movie/now_playing", {
    params: { language: "pt-BR", region: "BR" },
  });
  res.status(200).json(response.data.results);
});

exports.getLatestTrailers = catchAsync(async (req, res, next) => {
  const response = await tmdbApi.get("/movie/upcoming", {
    params: { language: "pt-BR", region: "BR" },
  });
  const movies = response.data.results.slice(0, 10);
  const trailers = await Promise.all(
    movies.map(async (movie) => {
      try {
        const vidRes = await tmdbApi.get(`/movie/${movie.id}/videos`);
        const trailer =
          vidRes.data.results.find(
            (v) => v.type === "Trailer" && v.site === "YouTube",
          ) || vidRes.data.results[0];
        if (trailer)
          return { ...movie, trailerKey: trailer.key, media_type: "movie" };
        return null;
      } catch (e) {
        return null;
      }
    }),
  );
  res.status(200).json(trailers.filter((t) => t !== null));
});

exports.getAnimeReleases = catchAsync(async (req, res, next) => {
  const response = await tmdbApi.get("/discover/tv", {
    params: {
      with_genres: 16,
      with_original_language: "ja",
      sort_by: "first_air_date.desc",
      "vote_count.gte": 10,
      language: "pt-BR",
    },
  });
  res
    .status(200)
    .json(response.data.results.map((i) => ({ ...i, media_type: "tv" })));
});

exports.getAnimations = catchAsync(async (req, res, next) => {
  const response = await tmdbApi.get("/discover/movie", {
    params: { with_genres: 16, sort_by: "popularity.desc", language: "pt-BR" },
  });
  res
    .status(200)
    .json(response.data.results.map((i) => ({ ...i, media_type: "movie" })));
});

exports.getGenres = catchAsync(async (req, res, next) => {
  const [movieGenres, tvGenres] = await Promise.all([
    tmdbApi.get("/genre/movie/list"),
    tmdbApi.get("/genre/tv/list"),
  ]);
  const combinedMap = new Map();
  movieGenres.data.genres.forEach((g) => combinedMap.set(g.id, g));
  tvGenres.data.genres.forEach((g) => combinedMap.set(g.id, g));
  res.status(200).json(Array.from(combinedMap.values()));
});

exports.getDetails = catchAsync(async (req, res, next) => {
  const { mediaType, id } = req.params;
  let append =
    "credits,watch/providers,videos,recommendations,similar,images,external_ids,keywords";
  if (mediaType === "person") append = "combined_credits,images,external_ids";
  const response = await tmdbApi.get(`/${mediaType}/${id}`, {
    params: { append_to_response: append, language: "pt-BR" },
  });
  if (mediaType !== "person") {
    const allVideos = response.data.videos?.results || [];
    let best =
      allVideos.find(
        (v) => v.type === "Trailer" && v.official && v.iso_639_1 === "pt",
      ) ||
      allVideos.find((v) => v.type === "Trailer" && v.official) ||
      allVideos[0];
    response.data.trailer = best ? { key: best.key, site: best.site } : null;
    delete response.data.videos;
  }
  res.status(200).json(response.data);
});

exports.getPersonExternalIds = catchAsync(async (req, res, next) => {
  const response = await tmdbApi.get(`/person/${req.params.id}/external_ids`);
  res.status(200).json(response.data);
});

exports.searchMulti = catchAsync(async (req, res, next) => {
  if (!req.query.query) return res.status(400).json({ message: "Query vazia" });
  const response = await tmdbApi.get("/search/multi", {
    params: {
      query: req.query.query,
      language: "pt-BR",
      include_adult: false,
      page: 1,
    },
  });
  const filtered = response.data.results.filter((item) => {
    if (item.media_type === "person")
      return item.profile_path && item.known_for?.length > 0;
    return (
      (item.media_type === "movie" || item.media_type === "tv") &&
      item.poster_path
    );
  });
  res.status(200).json(filtered);
});

exports.getProviders = catchAsync(async (req, res, next) => {
  const response = await tmdbApi.get(
    `/${req.params.mediaType}/${req.params.id}/watch/providers`,
  );
  res.status(200).json(response.data.results.BR?.flatrate || []);
});

exports.getSeasonDetails = catchAsync(async (req, res, next) => {
  const response = await tmdbApi.get(
    `/tv/${req.params.id}/season/${req.params.seasonNumber}`,
    { params: { language: "pt-BR" } },
  );
  res.status(200).json(response.data);
});

exports.getEpisodeDetails = catchAsync(async (req, res, next) => {
  const response = await tmdbApi.get(
    `/tv/${req.params.id}/season/${req.params.seasonNumber}/episode/${req.params.episodeNumber}`,
    {
      params: {
        append_to_response: "credits,images,videos",
        language: "pt-BR",
      },
    },
  );
  res.status(200).json(response.data);
});

exports.getAwards = catchAsync(async (req, res, next) => {
  const details = await tmdbApi.get(`/movie/${req.params.id}`);
  const awards = { wins: [], nominations: [] };
  if (details.data.vote_average > 7.5 && details.data.vote_count > 1000) {
    awards.wins.push({
      name: "Top Rated",
      category: "Community Choice",
      year: new Date(details.data.release_date).getFullYear().toString(),
    });
  }
  res.status(200).json(awards);
});
