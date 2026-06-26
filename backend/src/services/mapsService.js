const axios = require('axios');
const logger = require('../utils/logger');

const MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Haversine formula — straight-line distance between two coordinates in km
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Fetch real ETAs from Google Maps Distance Matrix API
async function getETAs(originCoords, destinations) {
  if (!MAPS_API_KEY) {
    // Fallback: estimate ETA from haversine (assume 30km/h avg speed in city)
    logger.warn('No Google Maps API key — using haversine ETA estimate');
    return destinations.map((dest) => {
      const distKm = haversineDistance(
        originCoords.lat, originCoords.lng,
        dest.lat, dest.lng
      );
      return Math.round((distKm / 30) * 60 * 60); // seconds
    });
  }

  const origins = `${originCoords.lat},${originCoords.lng}`;
  const destinationStr = destinations
    .map((d) => `${d.lat},${d.lng}`)
    .join('|');

  const url = `https://maps.googleapis.com/maps/api/distancematrix/json`;

  const response = await axios.get(url, {
    params: {
      origins,
      destinations: destinationStr,
      key: MAPS_API_KEY,
      mode: 'driving',
      traffic_model: 'best_guess',
      departure_time: 'now',
    },
    timeout: 5000, // 5s hard timeout
  });

  const rows = response.data.rows[0]?.elements || [];
  return rows.map((el) => {
    if (el.status !== 'OK') return Infinity;
    return el.duration_in_traffic?.value || el.duration?.value || Infinity;
  });
}

module.exports = { haversineDistance, getETAs };