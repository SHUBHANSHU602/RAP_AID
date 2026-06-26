require('dotenv').config();
const mongoose = require('mongoose');
const { syncAmbulancesToRedis } = require('../services/ambulanceCache');
const { assignAmbulance } = require('../services/assignmentService');
const EmergencySession = require('../models/EmergencySession');
const User = require('../models/User');
const logger = require('./logger');

// Varanasi coordinates with slight variation to simulate real requests
const TEST_COORDS = [
  { lat: 25.3176, lng: 82.9739 },
  { lat: 25.3200, lng: 82.9800 },
  { lat: 25.3150, lng: 82.9700 },
  { lat: 25.3250, lng: 82.9850 },
  { lat: 25.3100, lng: 82.9650 },
];

async function runBenchmark() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  await syncAmbulancesToRedis();
  console.log('Ambulances synced to Redis\n');

  // Get a test user
  const user = await User.findOne({ role: 'USER' }).lean();
  if (!user) throw new Error('No USER found — run seed first');

  const results = [];

  for (let i = 0; i < 5; i++) {
    const coords = TEST_COORDS[i % TEST_COORDS.length];

    // Create a real session so assignAmbulance has a valid sessionId
    const session = await EmergencySession.create({
      userId: user._id,
      location: coords,
      emergencyType: 'CARDIAC',
      severityLevel: 3,
    });

    const result = await assignAmbulance(session._id, coords.lat, coords.lng);

    if (result) {
      results.push(result.breakdown);
      console.log(`Run ${i + 1}: total=${result.breakdown.total}ms | redis=${result.breakdown.redis}ms | eta=${result.breakdown.eta}ms | mongo=${result.breakdown.mongo}ms | write=${result.breakdown.write}ms`);
    } else {
      console.log(`Run ${i + 1}: No ambulances available`);
    }
  }

  if (results.length > 0) {
    const avg = (key) =>
      Math.round(results.reduce((s, r) => s + r[key], 0) / results.length);

    console.log('\n── Averages ──────────────────────────────');
    console.log(`Total:   ${avg('total')}ms`);
    console.log(`Redis:   ${avg('redis')}ms`);
    console.log(`ETA:     ${avg('eta')}ms`);
    console.log(`MongoDB: ${avg('mongo')}ms`);
    console.log(`Write:   ${avg('write')}ms`);
    console.log('──────────────────────────────────────────');

    const target = 300;
    const passing = results.filter((r) => r.total < target).length;
    console.log(`\n${passing}/${results.length} runs under ${target}ms target`);
  }

  // Cleanup
  await EmergencySession.deleteMany({ userId: user._id });
  await mongoose.connection.close();
  process.exit(0);
}

runBenchmark().catch((err) => {
  console.error('Benchmark failed:', err.message);
  process.exit(1);
});