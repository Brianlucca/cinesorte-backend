const tmdbApi = require('../api/tmdb');
const { db } = require('../config/firebase');

const getGenres = async (req, res) => {
  const { mediaType } = req.params;
  try {
    const response = await tmdbApi.get(`/genre/${mediaType}/list`);
    res.status(200).json(response.data.genres);
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
    res.status(500).json({ message: 'Failed to fetch trending data' });
  }
};

const getRecommendations = async (req, res) => {
  const { uid } = req.user;
  const { mediaType } = req.params;
  const page = req.query.page || 1;

  try {
    const interactionsSnapshot = await db.collection('interactions')
      .where('userId', '==', uid)
      .select('mediaId')
      .get();

    const interactedIds = new Set(interactionsSnapshot.docs.map(doc => doc.data().mediaId));

    const response = await tmdbApi.get(`/${mediaType}/popular`, {
      params: { page }
    });

    const results = response.data.results;
    
    const filteredResults = results.filter(item => !interactedIds.has(item.id.toString()));

    res.status(200).json(filteredResults);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch recommendations' });
  }
};

const getDetails = async (req, res) => {
  const { mediaType, id } = req.params;
  try {
    const response = await tmdbApi.get(`/${mediaType}/${id}`, {
      params: { append_to_response: 'credits,watch/providers,videos' },
    });

    const allVideos = response.data.videos?.results || [];
    let bestTrailer = allVideos.find(v => v.type === 'Trailer' && v.official && v.iso_639_1 === 'pt') 
                   || allVideos.find(v => v.type === 'Trailer' && v.official)
                   || allVideos[0];

    response.data.trailer = bestTrailer ? { key: bestTrailer.key, site: bestTrailer.site } : null;
    delete response.data.videos;

    res.status(200).json(response.data);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching details' });
  }
};

const searchMulti = async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ message: 'Query parameter is required' });

  try {
    const response = await tmdbApi.get('/search/multi', {
      params: { query, include_adult: false, page: 1 },
    });
    const filteredResults = response.data.results.filter(
      item => (item.media_type === 'movie' || item.media_type === 'tv') && item.poster_path
    );
    res.status(200).json(filteredResults);
  } catch (error) {
    res.status(500).json({ message: 'Search failed' });
  }
};

const getProviders = async (req, res) => {
  const { mediaType, id } = req.params;
  try {
    const response = await tmdbApi.get(`/${mediaType}/${id}/watch/providers`);
    const providers = response.data.results.BR?.flatrate || [];
    res.status(200).json(providers);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching providers' });
  }
};

module.exports = {
  getGenres,
  getTrending,
  getRecommendations,
  getDetails,
  searchMulti,
  getProviders,
};