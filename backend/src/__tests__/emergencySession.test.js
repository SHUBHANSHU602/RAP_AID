require('dotenv').config();
const mongoose = require('mongoose');
const EmergencySession = require('../models/EmergencySession');
const User = require('../models/User');

let testUserId;

beforeAll(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  await User.deleteOne({ email: 'patient_test@rapidaid.dev' });

  const user = await User.create({
    name: 'Test Patient',
    email: 'patient_test@rapidaid.dev',
    password: 'Test@1234',
    role: 'USER',
  });
  testUserId = user._id;
});

afterAll(async () => {
  await EmergencySession.deleteMany({ userId: testUserId });
  await User.deleteOne({ _id: testUserId });
  await mongoose.connection.close();
});

function makeSession(overrides = {}) {
  return {
    userId: testUserId,
    location: { lat: 25.3176, lng: 82.9739 },
    emergencyType: 'CARDIAC',
    severityLevel: 3,
    ...overrides,
  };
}

// ─── 1. Session Creation ───────────────────────────────────────────────────
describe('EmergencySession — creation', () => {
  test('creates a session with valid fields', async () => {
    const session = await EmergencySession.create(makeSession());

    expect(session._id).toBeDefined();
    expect(session.status).toBe('INITIATED');
    expect(session.eventLog).toHaveLength(0);
    expect(session.resolvedAt).toBeNull(); // default: null in schema
  });

  test('rejects invalid emergencyType', async () => {
    await expect(
      EmergencySession.create(makeSession({ emergencyType: 'ZOMBIE_BITE' }))
    ).rejects.toThrow();
  });

  test('rejects severityLevel below 1', async () => {
    await expect(
      EmergencySession.create(makeSession({ severityLevel: 0 }))
    ).rejects.toThrow();
  });

  test('rejects severityLevel above 5', async () => {
    await expect(
      EmergencySession.create(makeSession({ severityLevel: 6 }))
    ).rejects.toThrow();
  });
});

// ─── 2. addEvent() Method ─────────────────────────────────────────────────
describe('EmergencySession — addEvent()', () => {
  let session;

  beforeEach(async () => {
    session = await EmergencySession.create(makeSession());
  });

  afterEach(async () => {
    await EmergencySession.deleteOne({ _id: session._id });
  });

  test('addEvent updates status correctly', async () => {
    session.addEvent('ASSIGNED', { ambulanceId: 'amb_001' });
    await session.save();

    expect(session.status).toBe('ASSIGNED');
  });

  test('addEvent pushes entry to eventLog', async () => {
    session.addEvent('ASSIGNED', { ambulanceId: 'amb_001' });
    await session.save();

    expect(session.eventLog).toHaveLength(1);
  });

  test('eventLog entry has correct shape', async () => {
    const meta = { ambulanceId: 'amb_001', eta: 240 };
    session.addEvent('ASSIGNED', meta);
    await session.save();

    const entry = session.eventLog[0];
    expect(entry.status).toBe('ASSIGNED');
    expect(entry.timestamp).toBeInstanceOf(Date);
    expect(entry.meta.ambulanceId).toBe('amb_001');
    expect(entry.meta.eta).toBe(240);
  });

  test('multiple addEvent calls build the full event trail', async () => {
    session.addEvent('ASSIGNED', { ambulanceId: 'amb_001' });
    session.addEvent('EN_ROUTE', { driverLat: 25.31, driverLng: 82.97 });
    session.addEvent('RESOLVED', { hospitalId: 'hosp_001' });
    await session.save();

    expect(session.eventLog).toHaveLength(3);
    expect(session.status).toBe('RESOLVED');
    expect(session.eventLog[0].status).toBe('ASSIGNED');
    expect(session.eventLog[2].status).toBe('RESOLVED');
  });

  test('eventLog entry has no _id field', async () => {
    session.addEvent('ASSIGNED', {});
    await session.save();

    const entry = session.eventLog[0];
    expect(entry._id).toBeUndefined();
  });

  test('resolvedAt is set when status becomes RESOLVED', async () => {
    session.addEvent('RESOLVED', {});
    await session.save();

    expect(session.resolvedAt).toBeInstanceOf(Date);
  });
});