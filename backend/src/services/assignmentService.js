const ngeohash = require('ngeohash');
const redis = require('../config/redis');
const Ambulance = require('../models/Ambulance');
const EmergencySession = require('../models/EmergencySession');
const { haversineDistance, getETAs } = require('./mapsService');
const { updateAmbulanceStatus } = require('./ambulanceCache');
const logger = require('../utils/logger');

const AVAILABLE_SET_KEY = 'ambulance:available';

// ── Step 1: Get nearby candidates from Redis ──────────────────────────────
async function getNearbyAvailableAmbulances(lat, lng, maxCandidates = 10) {
  const targetGeohash = ngeohash.encode(lat, lng, 7);

  // Get target cell + 8 neighbours to handle boundary artifacts
  const neighbours = ngeohash.neighbors(targetGeohash);
  const searchPrefixes = [targetGeohash.slice(0, 5), ...Object.values(neighbours).map(n => n.slice(0, 5))];
  const uniquePrefixes = [...new Set(searchPrefixes)];

  // Get all available IDs from Redis Set
  const availableIds = await redis.smembers(AVAILABLE_SET_KEY);
  if (availableIds.length === 0) return [];

  // Fetch all locations in one pipeline
  const pipeline = redis.pipeline();
  for (const id of availableIds) {
    pipeline.get(`ambulance:${id}:location`);
  }
  const results = await pipeline.exec();

  // Filter by geohash prefix match
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

  // Sort by haversine distance first, take top N
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
  // Normalize each factor to 0-1 scale (lower = better)
  const etaScore = Math.min(etaSeconds / 600, 1);       // cap at 10 min
  const distScore = Math.min(distanceKm / 10, 1);        // cap at 10 km
  const pingAge = (Date.now() - lastPingMs) / (1000 * 60 * 30); // 30 min cap
  const pingScore = Math.min(pingAge, 1);

  // Weighted sum — lower is better
  return etaScore * 0.5 + distScore * 0.3 + pingScore * 0.2;
}

// ── Main assignment function ──────────────────────────────────────────────
async function assignAmbulance(sessionId, patientLat, patientLng) {
  const startTime = Date.now();

  // 1. Get nearby available candidates from Redis
  const candidates = await getNearbyAvailableAmbulances(patientLat, patientLng, 10);

  if (candidates.length === 0) {
    logger.warn(`No available ambulances near ${patientLat},${patientLng}`);
    return null;
  }

  // 2. Take top 5 by distance for ETA fetch
  const top5 = candidates.slice(0, 5);

  // 3. Fetch real ETAs from Maps API (one call, all destinations)
  const etaSeconds = await getETAs(
    { lat: patientLat, lng: patientLng },
    top5.map((a) => ({ lat: a.lat, lng: a.lng }))
  );

  // 4. Fetch ambulance docs for lastPing
  const ambulanceDocs = await Ambulance.find({
    _id: { $in: top5.map((a) => a.ambulanceId) },
  }).lean();

  const docMap = {};
  for (const doc of ambulanceDocs) {
    docMap[doc._id.toString()] = doc;
  }

  // 5. Score each candidate
  const scored = top5.map((candidate, i) => {
    const doc = docMap[candidate.ambulanceId];
    const lastPingMs = doc?.lastPing ? new Date(doc.lastPing).getTime() : 0;

    return {
      ...candidate,
      etaSeconds: etaSeconds[i],
      score: scoreCandidate(etaSeconds[i], candidate.distanceKm, lastPingMs),
    };
  });

  // 6. Pick lowest score = best candidate
  scored.sort((a, b) => a.score - b.score);
  const best = scored[0];

  // 7. Assign — update Redis + MongoDB atomically-ish
  await updateAmbulanceStatus(best.ambulanceId, 'BUSY');

  await Ambulance.findByIdAndUpdate(best.ambulanceId, {
    assignedSessionId: sessionId,
    status: 'BUSY',
  });

  await EmergencySession.findByIdAndUpdate(sessionId, {
    ambulanceId: best.ambulanceId,
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
    status: 'ASSIGNED',
  });

  const latency = Date.now() - startTime;
  logger.info(`Ambulance assigned in ${latency}ms`, {
    sessionId,
    ambulanceId: best.ambulanceId,
    etaSeconds: best.etaSeconds,
    latency,
  });

  return {
    ambulanceId: best.ambulanceId,
    etaSeconds: best.etaSeconds,
    distanceKm: best.distanceKm,
    score: best.score,
    latency,
  };
}

module.exports = { assignAmbulance, getNearbyAvailableAmbulances };