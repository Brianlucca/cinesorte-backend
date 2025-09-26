const tmdbApi = require("../api/tmdb");

const getGenres = async (req, res) => {
  const { mediaType } = req.params;
  try {
    const response = await tmdbApi.get(`/genre/${mediaType}/list`);
    res.status(200).json(response.data.genres);
  } catch (error) {
    console.error("Erro ao buscar gêneros:", error.message);
    res.status(500).json([]);
  }
};

const getDiscover = async (req, res) => {
  const { mediaType, filters } = req.body;
  if (!mediaType || !filters) {
    return res
      .status(400)
      .json({ message: "mediaType e filters são obrigatórios." });
  }
  try {
    const baseParams = {
      sort_by: filters.sortBy,
      "vote_average.gte": filters.voteAverageGte,
      "with_runtime.lte": filters.runtimeLte,
      include_adult: false,
      watch_region: "BR",
    };
    if (filters.genre) baseParams.with_genres = filters.genre;
    if (filters.releaseYear) {
      if (mediaType === "movie") {
        baseParams.primary_release_year = filters.releaseYear;
      } else {
        baseParams.first_air_date_year = filters.releaseYear;
      }
    }
    if (filters.excludeAnimation) baseParams.without_genres = "16";
    if (filters.keywords && filters.keywords.length > 0) {
      baseParams.with_keywords = filters.keywords.map((k) => k.id).join(",");
    }
    const endpoint = `/discover/${mediaType}`;
    const pagePromises = [1, 2, 3, 4, 5].map((page) =>
      tmdbApi.get(endpoint, { params: { ...baseParams, page } })
    );
    const responses = await Promise.all(pagePromises);
    const allResults = responses.flatMap((response) => response.data.results);
    const uniqueResults = Array.from(
      new Map(allResults.map((item) => [item.id, item])).values()
    );
    const resultsWithPosters = uniqueResults.filter(
      (item) => item.poster_path && item.overview
    );
    if (resultsWithPosters.length === 0) {
      return res.status(200).json([]);
    }
    res.status(200).json(resultsWithPosters);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Falha ao buscar dados do TMDb." });
  }
};

const getDetails = async (req, res) => {
  const { mediaType, id } = req.params;
  try {
    const response = await tmdbApi.get(`/${mediaType}/${id}`, {
      params: {
        append_to_response: "credits,watch/providers,videos",
      },
    });

    const allVideos = response.data.videos?.results || [];
    let bestTrailer = null;

    if (allVideos.length > 0) {
      const officialTrailers = allVideos.filter(
        (v) => v.type === "Trailer" && v.official
      );

      bestTrailer = officialTrailers.find((v) => v.iso_639_1 === "pt");

      if (!bestTrailer) {
        bestTrailer = officialTrailers.find((v) => v.iso_639_1 === "en");
      }

      if (!bestTrailer && officialTrailers.length > 0) {
        bestTrailer = officialTrailers[0];
      }
    }

    response.data.trailer = bestTrailer
      ? { key: bestTrailer.key, site: bestTrailer.site }
      : null;

    delete response.data.videos;

    res.status(200).json(response.data);
  } catch (error) {
    res.status(500).json({ message: "Erro ao buscar detalhes." });
  }
};

const searchMulti = async (req, res) => {
  const { query } = req.query;
  if (!query) {
    return res
      .status(400)
      .json({ message: 'Parâmetro "query" é obrigatório.' });
  }
  try {
    const response = await tmdbApi.get("/search/multi", {
      params: { query: query, include_adult: false, page: 1 },
    });
    const filteredResults = response.data.results.filter(
      (item) =>
        (item.media_type === "movie" || item.media_type === "tv") &&
        item.poster_path
    );
    res.status(200).json(filteredResults);
  } catch (error) {
    res.status(500).json({ message: "Erro ao realizar busca." });
  }
};

const getProviders = async (req, res) => {
  const { mediaType, id } = req.params;
  try {
    const response = await tmdbApi.get(`/${mediaType}/${id}/watch/providers`);
    const providers = response.data.results.BR?.flatrate || [];
    res.status(200).json(providers);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Erro ao buscar provedores de streaming." });
  }
};

module.exports = {
  getGenres,
  getDiscover,
  getDetails,
  searchMulti,
  getProviders,
};
