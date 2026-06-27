const ngeohash = require('ngeohash');
const redis = require('../config/redis');
const Ambulance = require('../models/Ambulance');
const EmergencySession = require('../models/EmergencySession');
const { haversineDistance, getETAs } = require('./mapsService');
const { updateAmbulanceStatus } = require('./ambulanceCache');
const logger = require('../utils/logger');
const { getIO } = require('../sockets/emergencyRoom');
const AVAILABLE_SET_KEY = 'ambulance:available';

// ── Step 1: Get nearby candidates from Redis ──────────────────────────────
async function getNearbyAvailableAmbulances(lat, lng, maxCandidates = 10) {
  const targetGeohash = ngeohash.encode(lat, lng, 7);

  const neighbours = ngeohash.neighbors(targetGeohash);
  const searchPrefixes = [
    targetGeohash.slice(0, 5),
    ...Object.values(neighbours).map((n) => n.slice(0, 5)),
  ];
  const uniquePrefixes = [...new Set(searchPrefixes)];

  const availableIds = await redis.smembers(AVAILABLE_SET_KEY);
  if (availableIds.length === 0) return [];

  const pipeline = redis.pipeline();
  for (const id of availableIds) {
    pipeline.get(`ambulance:${id}:location`);
  }
  const results = await pipeline.exec();

  const nearby = [];
  for (let i = 0; i < availableIds.length; i++) {
    const raw = results[i][1];
    if (!raw) continue;

    const location = JSON.parse(raw);
    const ambulancePrefix = location.geohash.slice(0, 5);

    if (uniquePrefixes.includes(ambulancePrefix)) {
      nearby.push({
        ambulanceId: availableIds[i],
        lat: location.lat,
        lng: location.lng,
      });
    }
  }

  return nearby
    .map((a) => ({
      ...a,
      distanceKm: haversineDistance(lat, lng, a.lat, a.lng),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, maxCandidates);
}

// ── Step 2: Score candidates ──────────────────────────────────────────────
function scoreCandidate(etaSeconds, distanceKm, lastPingMs) {
  const etaScore = Math.min(etaSeconds / 600, 1);
  const distScore = Math.min(distanceKm / 10, 1);
  const pingAge = (Date.now() - lastPingMs) / (1000 * 60 * 30);
  const pingScore = Math.min(pingAge, 1);

  return etaScore * 0.5 + distScore * 0.3 + pingScore * 0.2;
}

// ── Main assignment function ──────────────────────────────────────────────
async function assignAmbulance(sessionId, patientLat, patientLng) {
  const t = { start: Date.now() };

  // Step 1: Redis candidate fetch
  const candidates = await getNearbyAvailableAmbulances(patientLat, patientLng, 10);
  t.afterRedis = Date.now();

  if (candidates.length === 0) {
    logger.warn(`No available ambulances near ${patientLat},${patientLng}`);
    return null;
  }

  const top5 = candidates.slice(0, 5);

  // Step 2: ETA + MongoDB fetch in parallel
  const [etaSeconds, ambulanceDocs] = await Promise.all([
    getETAs(
      { lat: patientLat, lng: patientLng },
      top5.map((a) => ({ lat: a.lat, lng: a.lng }))
    ),
    Ambulance.find({
      _id: { $in: top5.map((a) => a.ambulanceId) },
    }).lean(),
  ]);
  t.afterETA = Date.now();
  t.afterMongo = t.afterETA; // parallel — same moment

  // Step 3: Build doc map
  const docMap = {};
  for (const doc of ambulanceDocs) {
    docMap[doc._id.toString()] = doc;
  }

  // Step 4: Score + pick winner
  const scored = top5.map((candidate, i) => {
    const doc = docMap[candidate.ambulanceId];
    const lastPingMs = doc?.lastPing ? new Date(doc.lastPing).getTime() : 0;
    return {
      ...candidate,
      etaSeconds: etaSeconds[i],
      score: scoreCandidate(etaSeconds[i], candidate.distanceKm, lastPingMs),
    };
  });
  scored.sort((a, b) => a.score - b.score);
  const best = scored[0];
  t.afterScoring = Date.now();

  // Step 5: All writes in parallel
  await Promise.all([
    updateAmbulanceStatus(best.ambulanceId, 'BUSY'),
    Ambulance.findByIdAndUpdate(best.ambulanceId, {
      assignedSessionId: sessionId,
      status: 'BUSY',
    }),
    EmergencySession.findByIdAndUpdate(sessionId, {
      ambulanceId: best.ambulanceId,
      status: 'ASSIGNED',
      $push: {
        eventLog: {
          status: 'ASSIGNED',
          timestamp: new Date(),
          meta: {
            ambulanceId: best.ambulanceId,
            etaSeconds: best.etaSeconds,
            distanceKm: best.distanceKm,
            score: best.score,
          },
        },
      },
    }),
  ]);
  t.afterWrite = Date.now();

  try {
  const io = getIO();
  io.to(`session:${sessionId}`).emit('ambulance_assigned', {
    sessionId,
    ambulanceId: best.ambulanceId,
    etaSeconds: best.etaSeconds,
    distanceKm: best.distanceKm,
    message: `Ambulance assigned — arriving in approximately ${Math.round(best.etaSeconds / 60)} minutes`,
  });
  logger.info(`Emitted ambulance_assigned to session:${sessionId}`);
} catch (err) {
  // Don't crash assignment if socket emit fails
  logger.warn(`Socket emit failed: ${err.message}`);
}

  // Latency breakdown
  const breakdown = {
    redis: t.afterRedis - t.start,
    eta: t.afterETA - t.afterRedis,
    mongo: t.afterMongo - t.afterETA,
    scoring: t.afterScoring - t.afterMongo,
    write: t.afterWrite - t.afterScoring,
    total: t.afterWrite - t.start,
  };

  logger.info(`Assignment complete in ${breakdown.total}ms`, breakdown);

  return {
    ambulanceId: best.ambulanceId,
    etaSeconds: best.etaSeconds,
    distanceKm: best.distanceKm,
    score: best.score,
    latency: breakdown.total,
    breakdown,
  };
}

module.exports = { assignAmbulance, getNearbyAvailableAmbulances };