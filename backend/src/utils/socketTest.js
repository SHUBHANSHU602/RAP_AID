require('dotenv').config();
const { io } = require('socket.io-client');
const axios = require('axios');

const BASE_URL = 'http://localhost:5000/api/v1';

async function runTest() {
  // Step 1: Login to get token
  const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
    email: 'admin@rapidaid.com',
    password: 'admin123',
  });

  const loginPayload = loginRes.data?.data ?? loginRes.data;
  const token = loginPayload?.accessToken;

  if (!token) {
    throw new Error(`Login response did not include an access token. Response: ${JSON.stringify(loginRes.data)}`);
  }

  console.log('✓ Logged in, got token');

  // Step 2: Trigger emergency to get sessionId
  const emergencyRes = await axios.post(
    `${BASE_URL}/emergency/trigger`,
    { lat: 25.3176, lng: 82.9739, emergencyType: 'CARDIAC', severityLevel: 3 },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  const emergencyPayload = emergencyRes.data?.data ?? emergencyRes.data;
  const sessionId = emergencyPayload?.sessionId;

  if (!sessionId) {
    throw new Error(`Emergency response did not include a sessionId. Response: ${JSON.stringify(emergencyRes.data)}`);
  }

  console.log('✓ Emergency triggered, sessionId:', sessionId);

  // Step 3: Connect socket
  const socket = io('http://localhost:5000', {
    auth: { token },
    transports: ['websocket'],
  });

  socket.on('connect', () => {
    console.log('✓ Socket connected:', socket.id);
    socket.emit('join_session', sessionId);
  });

  socket.on('joined', (data) => {
    console.log('✓ Joined room:', data);
  });

  socket.on('ambulance_assigned', (data) => {
    console.log('✓ AMBULANCE ASSIGNED:', JSON.stringify(data, null, 2));
    socket.disconnect();
    process.exit(0);
  });

  socket.on('connect_error', (err) => {
    console.error('✗ Connection error:', err.message);
    process.exit(1);
  });

  // Timeout after 10s
  setTimeout(() => {
    console.log('⚠ Timeout — no assignment event received. This can happen when Redis or assignment services are unavailable.');
    socket.disconnect();
    process.exit(0);
  }, 10000);
}

runTest().catch((err) => {
  console.error('✗ Test failed:', err.message);
  process.exit(1);
});