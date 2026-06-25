const redis = require('../config/redis');
const Ambulance = require('../models/Ambulance');
const ngeohash = require('ngeohash');

// Key patterns:
// ambulance:{id}:status  → AVAILABLE | BUSY | OFFLINE
// ambulance:{id}:location → JSON { lat, lng, geohash }
// ambulance:available    → Redis Set of all available ambulance IDs

const AVAILABLE_SET_KEY = 'ambulance:available';

// ── Sync all ambulances from MongoDB → Redis on boot ──────────────────────
async function syncAmbulancesToRedis() {
  const ambulances = await Ambulance.find({}).lean();

  const pipeline = redis.pipeline();

  for (const amb of ambulances) {
    const id = amb._id.toString();
    const geohash = ngeohash.encode(
      amb.currentLocation.lat,
      amb.currentLocation.lng,
      7 // 7-char geohash = ~150m precision
    );

    pipeline.set(`ambulance:${id}:status`, amb.status);
    pipeline.set(
      `ambulance:${id}:location`,
      JSON.stringify({
        lat: amb.currentLocation.lat,
        lng: amb.currentLocation.lng,
        geohash,
      })
    );

    if (amb.status === 'AVAILABLE') {
      pipeline.sadd(AVAILABLE_SET_KEY, id);
    }
  }

  await pipeline.exec();
  return ambulances.length;
}

// ── Update ambulance status in Redis + MongoDB ────────────────────────────
async function updateAmbulanceStatus(ambulanceId, newStatus) {
  const id = ambulanceId.toString();

  // Update Redis
  await redis.set(`ambulance:${id}:status`, newStatus);

  if (newStatus === 'AVAILABLE') {
    await redis.sadd(AVAILABLE_SET_KEY, id);
  } else {
    await redis.srem(AVAILABLE_SET_KEY, id);
  }

  // Update MongoDB
  await Ambulance.findByIdAndUpdate(ambulanceId, { status: newStatus });
}

// ── Get all available ambulances near a coordinate ────────────────────────
async function getAvailableAmbulancesNear(lat, lng, radiusChars = 5) {
  const queryGeohash = ngeohash.encode(lat, lng, 7);
  const prefix = queryGeohash.slice(0, radiusChars); // e.g. 'tnjn1'

  // Get all available ambulance IDs from Redis Set
  const availableIds = await redis.smembers(AVAILABLE_SET_KEY);

  if (availableIds.length === 0) return [];

  // Fetch their locations in one pipeline
  const pipeline = redis.pipeline();
  for (const id of availableIds) {
    pipeline.get(`ambulance:${id}:location`);
  }
  const results = await pipeline.exec();

  // Filter by geohash prefix (same zone or adjacent)
  const nearby = [];
  for (let i = 0; i < availableIds.length; i++) {
    const raw = results[i][1]; // [error, value] tuple
    if (!raw) continue;

    const location = JSON.parse(raw);
    if (location.geohash.startsWith(prefix)) {
      nearby.push({
        ambulanceId: availableIds[i],
        lat: location.lat,
        lng: location.lng,
        geohash: location.geohash,
      });
    }
  }

  return nearby;
}

// ── Get single ambulance status from Redis ────────────────────────────────
async function getAmbulanceStatus(ambulanceId) {
  return await redis.get(`ambulance:${ambulanceId.toString()}:status`);
}

module.exports = {
  syncAmbulancesToRedis,
  updateAmbulanceStatus,
  getAvailableAmbulancesNear,
  getAmbulanceStatus,
};