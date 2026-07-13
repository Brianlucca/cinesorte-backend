const crypto = require("crypto");
const { db, admin } = require("../../config/firebase");
const tmdbApi = require("../tmdb/tmdb.client");
const AppError = require("../../shared/errors/AppError");
const catchAsync = require("../../shared/utils/catchAsync");
const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const now = () => admin.firestore.Timestamp.now();

function parseEpisodeMetadata(payload = {}) {
  const raw = `${payload.seriesTitle || ""} ${payload.title || ""}`;
  const match = raw.match(
    /(?:S(?:eason|aison)?|T(?:emporada)?)\s*(\d{1,2})\s*(?:[x·-]|E(?:P(?:ISODE|IS[ÓO]DIO)?\.?\s*)?)\s*(\d{1,3})|(?:temporada|season)\s*(\d{1,2})\D{0,12}(?:epis[oó]dio|episode|ep\.?)\s*(\d{1,3})/i,
  );
  return {
    seasonNumber:
      Number(payload.seasonNumber ?? match?.[1] ?? match?.[3]) || null,
    episodeNumber:
      Number(payload.episodeNumber ?? match?.[2] ?? match?.[4]) || null,
    seriesTitle:
      String(payload.seriesTitle || payload.showTitle || "")
        .trim()
        .slice(0, 240) || null,
    episodeTitle:
      String(payload.episodeTitle || "")
        .trim()
        .slice(0, 240) || null,
  };
}

function normalizeTitle(value = "") {
  return String(value)
    .replace(
      /\b(?:(?:S|T)\s*\d{1,2}\s*(?:E|EP\.?|x)\s*\d{1,3}|\d{1,2}x\d{1,3}|(?:temporada|season)\s*\d+.*(?:epis[oó]dio|episode|ep\.?)\s*\d+)\b.*$/i,
      "",
    )
    .replace(/\s*[|·:-]\s*(?:epis[oó]dio|episode|ep\.?)\s*\d+.*$/i, "")
    .trim();
}

async function enrichFromTmdb(payload) {
  try {
    const episode = parseEpisodeMetadata(payload);
    const query = normalizeTitle(episode.seriesTitle || payload.title);
    const endpoint =
      episode.seasonNumber && episode.episodeNumber
        ? "/search/tv"
        : "/search/multi";
    const response = await tmdbApi.get(endpoint, {
      params: { query, include_adult: false, page: 1 },
    });
    const item = response.data.results.find(
      (entry) =>
        endpoint === "/search/tv" || ["movie", "tv"].includes(entry.media_type),
    );
    if (!item) return episode;
    const mediaType = endpoint === "/search/tv" ? "tv" : item.media_type;
    if (
      mediaType === "tv" &&
      episode.episodeTitle &&
      (!episode.seasonNumber || !episode.episodeNumber)
    ) {
      try {
        const show = await tmdbApi.get(`/tv/${item.id}`);
        const seasons = (show.data.seasons || [])
          .filter((season) => season.season_number > 0)
          .slice(0, 25);
        const loaded = await Promise.all(
          seasons.map((season) =>
            tmdbApi
              .get(`/tv/${item.id}/season/${season.season_number}`)
              .then((response) => response.data)
              .catch(() => null),
          ),
        );
        const wanted = normalizeTitle(episode.episodeTitle).toLocaleLowerCase(
          "pt-BR",
        );
        for (const season of loaded.filter(Boolean)) {
          const found = (season.episodes || []).find(
            (entry) =>
              normalizeTitle(entry.name).toLocaleLowerCase("pt-BR") === wanted,
          );
          if (found) {
            episode.seasonNumber = season.season_number;
            episode.episodeNumber = found.episode_number;
            break;
          }
        }
      } catch {
        /* MantÃ©m metadados fornecidos pelo streaming. */
      }
    }
    let episodeDetails = {};
    if (mediaType === "tv" && episode.seasonNumber && episode.episodeNumber) {
      try {
        const detail = await tmdbApi.get(
          `/tv/${item.id}/season/${episode.seasonNumber}/episode/${episode.episodeNumber}`,
        );
        episodeDetails = {
          episodeTitle: detail.data.name || episode.episodeTitle,
          episodeStillPath: detail.data.still_path || null,
          episodeRuntime: detail.data.runtime || null,
          expectedDurationSeconds: detail.data.runtime
            ? detail.data.runtime * 60
            : null,
        };
      } catch {
        episodeDetails = {};
      }
    }
    let expectedDurationSeconds =
      episodeDetails.expectedDurationSeconds || null;
    if (!expectedDurationSeconds && mediaType === "movie") {
      try {
        const detail = await tmdbApi.get(`/movie/${item.id}`);
        expectedDurationSeconds = detail.data.runtime
          ? detail.data.runtime * 60
          : null;
      } catch {
        expectedDurationSeconds = null;
      }
    }
    return {
      ...episode,
      ...episodeDetails,
      expectedDurationSeconds,
      tmdbId: item.id,
      mediaType,
      mediaTitle: item.title || item.name || query,
      posterPath: item.poster_path || null,
      backdropPath: item.backdrop_path || null,
      releaseDate: item.release_date || item.first_air_date || null,
      matchQuery: query,
    };
  } catch {
    return {};
  }
}

exports.createPairingCode = catchAsync(async (req, res) => {
  const previousCodes = await db
    .collection("extensionPairingCodes")
    .where("uid", "==", req.user.uid)
    .limit(20)
    .get();
  if (!previousCodes.empty) {
    const cleanup = db.batch();
    previousCodes.docs.forEach((doc) => cleanup.delete(doc.ref));
    await cleanup.commit();
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await db
    .collection("extensionPairingCodes")
    .doc(sha256(code))
    .set({
      uid: req.user.uid,
      createdAt: now(),
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 600000),
      usedAt: null,
    });
  res.status(201).json({ code, expiresInSeconds: 600 });
});

exports.exchangePairingCode = catchAsync(async (req, res, next) => {
  const code = String(req.body?.code || "").replace(/\D/g, "");
  if (code.length !== 6) return next(new AppError("Código inválido.", 400));
  const ref = db.collection("extensionPairingCodes").doc(sha256(code));
  const token = crypto.randomBytes(32).toString("base64url");
  let pairing;
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    pairing = snapshot.data();
    if (!snapshot.exists || pairing.usedAt || pairing.expiresAt.toMillis() < Date.now()) {
      throw new AppError("Código inválido ou expirado.", 400);
    }
    const previousTokens = await transaction.get(
      db.collection("extensionTokens").where("uid", "==", pairing.uid).limit(20),
    );
    transaction.delete(ref);
    previousTokens.docs.forEach((doc) => transaction.delete(doc.ref));
    transaction.set(db.collection("extensionTokens").doc(sha256(token)), {
      uid: pairing.uid,
      name: String(req.body?.deviceName || "Navegador").slice(0, 80),
      createdAt: now(),
      lastUsedAt: now(),
      revokedAt: null,
    });
  });
  const userSnapshot = await db.collection("users").doc(pairing.uid).get();
  const user = userSnapshot.data() || {};
  res.json({
    token,
    account: {
      username: user.username || null,
      photoURL: user.photoURL || null,
    },
  });
});

exports.verifyExtensionToken = catchAsync(async (req, res, next) => {
  const raw = String(req.headers.authorization || "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (!raw) return next(new AppError("Extensão não conectada.", 401));
  const ref = db.collection("extensionTokens").doc(sha256(raw));
  const snapshot = await ref.get();
  const token = snapshot.data();
  if (!snapshot.exists || token.revokedAt)
    return next(new AppError("Token da extensão inválido.", 401));
  req.extensionUser = { uid: token.uid, tokenRef: ref };
  const lastUsedMillis = token.lastUsedAt?.toMillis?.() || 0;
  if (Date.now() - lastUsedMillis >= 15 * 60 * 1000) {
    ref.update({ lastUsedAt: now() }).catch(() => {});
  }
  next();
});

exports.upsertProgress = catchAsync(async (req, res, next) => {
  const payload = req.body || {};
  const provider = String(payload.provider || "").slice(0, 40);
  const providerContentId = String(payload.providerContentId || "").slice(
    0,
    160,
  );
  const title = String(payload.title || "")
    .trim()
    .slice(0, 240);
  const positionSeconds = Math.max(
    0,
    Math.floor(Number(payload.positionSeconds) || 0),
  );
  const durationSeconds = Math.max(
    0,
    Math.floor(Number(payload.durationSeconds) || 0),
  );
  if (!provider || !title || durationSeconds <= 0)
    return next(new AppError("Progresso incompleto.", 400));
  const ref = db
    .collection("users")
    .doc(req.extensionUser.uid)
    .collection("watchProgress")
    .doc(sha256(`${provider}:${providerContentId || title.toLowerCase()}`));
  const existing = await ref.get();
  const existingData = existing.exists ? existing.data() : null;
  const looksLikeTechnicalReset =
    existingData &&
    existingData.positionSeconds >= 30 &&
    positionSeconds <= 3 &&
    existingData.durationSeconds === durationSeconds;
  if (looksLikeTechnicalReset) {
    return res.json({
      saved: false,
      ignored: "technical-reset",
      completed: Boolean(existingData.completed),
    });
  }
  const episodeMetadata = parseEpisodeMetadata(payload);
  const identityChanged =
    existingData &&
    (existingData.seasonNumber !== episodeMetadata.seasonNumber ||
      existingData.episodeNumber !== episodeMetadata.episodeNumber);
  const needsDurationRepair =
    existingData?.tmdbId && !existingData.expectedDurationSeconds;
  const tmdb =
    existing.exists &&
    existingData.tmdbId &&
    !identityChanged &&
    !needsDurationRepair
      ? episodeMetadata
      : await enrichFromTmdb(payload);
  const expectedDurationSeconds =
    Number(
      tmdb.expectedDurationSeconds || existingData?.expectedDurationSeconds,
    ) || null;
  const durationLooksCanonical =
    !expectedDurationSeconds ||
    durationSeconds >= expectedDurationSeconds * 0.7;
  const completed =
    positionSeconds / durationSeconds >= 0.85 && durationLooksCanonical;
  const savedItem = {
    provider,
    providerContentId: providerContentId || null,
    title,
    url: String(payload.url || "").slice(0, 2000),
    thumbnailUrl: String(payload.thumbnailUrl || "").slice(0, 2000) || null,
    positionSeconds,
    durationSeconds,
    progressPercent: Math.min(
      100,
      Math.round((positionSeconds / durationSeconds) * 100),
    ),
    completed,
    paused: Boolean(payload.paused),
    captureReason: String(payload.captureReason || "").slice(0, 30) || null,
    ...tmdb,
    updatedAt: now(),
    createdAt: existing.exists ? existing.data().createdAt : now(),
  };
  await ref.set(savedItem, { merge: true });
  res.json({
    saved: true,
    completed,
    item: {
      id: ref.id,
      ...(existingData || {}),
      ...savedItem,
      updatedAt: new Date().toISOString(),
      createdAt:
        existingData?.createdAt?.toDate?.()?.toISOString() ||
        new Date().toISOString(),
    },
  });
});

exports.listProgress = catchAsync(async (req, res) => {
  const snapshot = await db
    .collection("users")
    .doc(req.user.uid)
    .collection("watchProgress")
    .orderBy("updatedAt", "desc")
    .limit(20)
    .get();
  const items = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || null,
    updatedAt: doc.data().updatedAt?.toDate?.()?.toISOString() || null,
  }));
  res.json(items);
});

exports.listExtensionProgress = catchAsync(async (req, res) => {
  const snapshot = await db
    .collection("users")
    .doc(req.extensionUser.uid)
    .collection("watchProgress")
    .orderBy("updatedAt", "desc")
    .limit(50)
    .get();
  const items = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || null,
    updatedAt: doc.data().updatedAt?.toDate?.()?.toISOString() || null,
  }));
  res.json(items);
});

exports.getExtensionStatus = catchAsync(async (req, res) => {
  const snapshot = await db
    .collection("extensionTokens")
    .where("uid", "==", req.user.uid)
    .limit(20)
    .get();
  const connected = snapshot.docs.some((doc) => !doc.data().revokedAt);
  res.json({
    connected,
    devices: snapshot.docs.filter((doc) => !doc.data().revokedAt).length,
  });
});

exports.removeExtensionProgress = catchAsync(async (req, res, next) => {
  const provider = String(req.body?.provider || "").slice(0, 40);
  const providerContentId = String(req.body?.providerContentId || "").slice(
    0,
    160,
  );
  const title = String(req.body?.title || "")
    .trim()
    .slice(0, 240);
  if (!provider || (!providerContentId && !title))
    return next(new AppError("Conteúdo inválido.", 400));
  const id = sha256(`${provider}:${providerContentId || title.toLowerCase()}`);
  await db
    .collection("users")
    .doc(req.extensionUser.uid)
    .collection("watchProgress")
    .doc(id)
    .delete();
  res.sendStatus(204);
});

exports.revokeExtensionToken = catchAsync(async (req, res) => {
  const snapshot = await db
    .collection("extensionTokens")
    .where("uid", "==", req.extensionUser.uid)
    .limit(20)
    .get();
  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  res.sendStatus(204);
});

exports.getCurrentExtensionSession = catchAsync(async (req, res) => {
  const userSnapshot = await db
    .collection("users")
    .doc(req.extensionUser.uid)
    .get();
  const user = userSnapshot.data() || {};
  res.json({
    valid: true,
    account: {
      username: user.username || null,
      photoURL: user.photoURL || null,
    },
  });
});

exports.deleteProgress = catchAsync(async (req, res) => {
  await db
    .collection("users")
    .doc(req.user.uid)
    .collection("watchProgress")
    .doc(req.params.id)
    .delete();
  res.sendStatus(204);
});
