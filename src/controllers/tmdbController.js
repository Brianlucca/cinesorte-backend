const tmdbApi = require("../api/tmdb");
const { db } = require("../config/firebase");

const getRecommendations = async (req, res) => {
  const { uid } = req.user;
  const { mediaType } = req.params;
  const page = req.query.page || 1;

  try {
    const userDoc = await db.collection("users").doc(uid).get();
    const genreCounts = userDoc.data().genreCounts || {};

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
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
};

const getGenres = async (req, res) => {
  try {
    const [movieGenres, tvGenres] = await Promise.all([
      tmdbApi.get("/genre/movie/list"),
      tmdbApi.get("/genre/tv/list"),
    ]);

    const combinedMap = new Map();
    movieGenres.data.genres.forEach((g) => combinedMap.set(g.id, g));
    tvGenres.data.genres.forEach((g) => combinedMap.set(g.id, g));

    res.status(200).json(Array.from(combinedMap.values()));
  } catch (error) {
    res.status(500).json([]);
  }
};

const getTrending = async (req, res) => {
  const { timeWindow } = req.params;
  try {
    const response = await tmdbApi.get(`/trending/all/${timeWindow}`);
    res.status(200).json(response.data.results);
  } catch (error) {
    res.status(500).json({ message: "Erro TMDB." });
  }
};

const getDiscover = async (req, res) => {
  const { with_genres, page, media_type, sort_by } = req.query;
  const type = media_type || "movie";

  try {
    const params = {
      page: page || 1,
      language: "pt-BR",
      include_adult: false,
      "vote_count.gte": 50,
    };

    if (with_genres) params.with_genres = with_genres;
    if (sort_by) params.sort_by = sort_by;

    const response = await tmdbApi.get(`/discover/${type}`, { params });

    const results = response.data.results.map((item) => ({
      ...item,
      media_type: type,
    }));

    res.status(200).json(results);
  } catch (error) {
    res.status(200).json([]);
  }
};

const getLatestTrailers = async (req, res) => {
  try {
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
          if (trailer) {
            return { ...movie, trailerKey: trailer.key, media_type: "movie" };
          }
          return null;
        } catch (e) {
          return null;
        }
      }),
    );

    res.status(200).json(trailers.filter((t) => t !== null));
  } catch (error) {
    res.status(500).json([]);
  }
};

const getAnimeReleases = async (req, res) => {
  try {
    const response = await tmdbApi.get("/discover/tv", {
      params: {
        with_genres: 16,
        with_original_language: "ja",
        sort_by: "first_air_date.desc",
        "vote_count.gte": 10,
      },
    });
    const results = response.data.results.map((i) => ({
      ...i,
      media_type: "tv",
    }));
    res.status(200).json(results);
  } catch (error) {
    res.status(500).json([]);
  }
};

const getAnimations = async (req, res) => {
  try {
    const response = await tmdbApi.get("/discover/movie", {
      params: { with_genres: 16, sort_by: "popularity.desc" },
    });
    const results = response.data.results.map((i) => ({
      ...i,
      media_type: "movie",
    }));
    res.status(200).json(results);
  } catch (error) {
    res.status(500).json([]);
  }
};

const getDetails = async (req, res) => {
  const { mediaType, id } = req.params;
  try {
    let appendToResponse =
      "credits,watch/providers,videos,recommendations,similar,images,external_ids,keywords";

    if (mediaType === "person") {
      appendToResponse = "combined_credits,images,external_ids";
    }

    const response = await tmdbApi.get(`/${mediaType}/${id}`, {
      params: { append_to_response: appendToResponse },
    });

    if (mediaType !== "person") {
      const allVideos = response.data.videos?.results || [];
      let bestTrailer =
        allVideos.find(
          (v) => v.type === "Trailer" && v.official && v.iso_639_1 === "pt",
        ) ||
        allVideos.find((v) => v.type === "Trailer" && v.official) ||
        allVideos[0];

      response.data.trailer = bestTrailer
        ? { key: bestTrailer.key, site: bestTrailer.site }
        : null;
      delete response.data.videos;
    }

    res.status(200).json(response.data);
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
};

const getPersonExternalIds = async (req, res) => {
  const { id } = req.params;
  try {
    const response = await tmdbApi.get(`/person/${id}/external_ids`);
    res.status(200).json(response.data);
  } catch (error) {
    res.status(200).json({});
  }
};

const searchMulti = async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ message: "Query vazia" });

  try {
    const response = await tmdbApi.get("/search/multi", {
      params: { query, include_adult: false, page: 1 },
    });

    const filteredResults = response.data.results.filter((item) => {
      if (item.media_type === "person") {
        return item.profile_path && item.known_for && item.known_for.length > 0;
      }
      return (
        (item.media_type === "movie" || item.media_type === "tv") &&
        item.poster_path
      );
    });

    res.status(200).json(filteredResults);
  } catch (error) {
    res.status(500).json({ message: "Erro busca." });
  }
};

const getProviders = async (req, res) => {
  const { mediaType, id } = req.params;
  try {
    const response = await tmdbApi.get(`/${mediaType}/${id}/watch/providers`);
    const providers = response.data.results.BR?.flatrate || [];
    res.status(200).json(providers);
  } catch (error) {
    res.status(500).json([]);
  }
};

const getSeasonDetails = async (req, res) => {
  const { id, seasonNumber } = req.params;
  try {
    const response = await tmdbApi.get(`/tv/${id}/season/${seasonNumber}`);
    res.status(200).json(response.data);
  } catch (error) {
    res.status(500).json({ message: "Erro ao buscar episódios da temporada." });
  }
};

const getEpisodeDetails = async (req, res) => {
  const { id, seasonNumber, episodeNumber } = req.params;
  try {
    const response = await tmdbApi.get(
      `/tv/${id}/season/${seasonNumber}/episode/${episodeNumber}`,
      {
        params: { append_to_response: "credits,images,videos" },
      },
    );
    res.status(200).json(response.data);
  } catch (error) {
    res.status(500).json({ message: "Erro ao buscar detalhes do episódio." });
  }
};

const getAwards = async (req, res) => {
  const { id } = req.params;
  try {
    const dummyAwards = {
      wins: [],
      nominations: [],
    };

    const details = await tmdbApi.get(`/movie/${id}`);
    if (details.data.vote_average > 7.5 && details.data.vote_count > 1000) {
      dummyAwards.wins.push({
        name: "Top Rated",
        category: "Community Choice",
        year: new Date(details.data.release_date).getFullYear().toString(),
      });
    }

    res.status(200).json(dummyAwards);
  } catch (error) {
    res.status(200).json({ wins: [], nominations: [] });
  }
};

module.exports = {
  getRecommendations,
  getGenres,
  getTrending,
  getDiscover,
  getLatestTrailers,
  getAnimeReleases,
  getAnimations,
  getDetails,
  getPersonExternalIds,
  searchMulti,
  getProviders,
  getSeasonDetails,
  getEpisodeDetails,
  getAwards,
};