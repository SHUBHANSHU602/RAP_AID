require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Ambulance = require('../models/Ambulance');
const Hospital = require('../models/Hospital');
const logger = require('./logger');

const VARANASI_CENTER = { lat: 25.3176, lng: 82.9739 };

const randomOffset = (base, range) => 
  parseFloat((base + (Math.random() - 0.5) * range).toFixed(6));

const createServiceArea = (lat, lng, size = 0.05) => ({
  type: 'Polygon',
  coordinates: [[
    [lng - size, lat - size],
    [lng + size, lat - size],
    [lng + size, lat + size],
    [lng - size, lat + size],
    [lng - size, lat - size]
  ]]
});

const seedDatabase = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    logger.info('Connected to MongoDB for seeding');

    await User.deleteMany({ role: { $in: ['DRIVER', 'ADMIN'] } });
    await Ambulance.deleteMany({});
    await Hospital.deleteMany({});
    logger.info('Cleared existing seed data');

    const adminUser = await User.create({
      name: 'RapidAid Admin',
      email: 'admin@rapidaid.com',
      password: 'admin123',
      role: 'ADMIN'
    });
    logger.info(`Admin created: ${adminUser.email}`);

    const drivers = [];
    for (let i = 1; i <= 20; i++) {
      const driver = await User.create({
        name: `Driver ${i}`,
        email: `driver${i}@rapidaid.com`,
        password: 'driver123',
        role: 'DRIVER'
      });
      drivers.push(driver);
    }
    logger.info(`Created ${drivers.length} drivers`);

    const ambulances = [];
    for (let i = 0; i < 20; i++) {
      const lat = randomOffset(VARANASI_CENTER.lat, 0.1);
      const lng = randomOffset(VARANASI_CENTER.lng, 0.1);
      const ambulance = await Ambulance.create({
        driverId: drivers[i]._id,
        currentLocation: { lat, lng },
        status: 'AVAILABLE',
        lastPing: new Date(),
        serviceArea: createServiceArea(lat, lng)
      });
      ambulances.push(ambulance);
    }
    logger.info(`Created ${ambulances.length} ambulances`);

    const hospitalData = [
      {
        name: 'Sir Sunderlal Hospital',
        location: { lat: 25.2677, lng: 82.9913 },
        address: 'BHU Campus, Varanasi',
        specializations: ['TRAUMA', 'CARDIAC', 'GENERAL'],
        availableBeds: 50,
        emergencyCapacity: 20,
        avgHandlingTime: 15,
        rating: 4.5
      },
      {
        name: 'Heritage Hospital',
        location: { lat: 25.3320, lng: 83.0100 },
        address: 'Lanka, Varanasi',
        specializations: ['CARDIAC', 'NEUROLOGY', 'GENERAL'],
        availableBeds: 30,
        emergencyCapacity: 10,
        avgHandlingTime: 20,
        rating: 4.2
      },
      {
        name: 'Shubham Hospital',
        location: { lat: 25.3500, lng: 82.9500 },
        address: 'Sigra, Varanasi',
        specializations: ['BURNS', 'TRAUMA', 'GENERAL'],
        availableBeds: 20,
        emergencyCapacity: 8,
        avgHandlingTime: 25,
        rating: 3.9
      },
      {
        name: 'Varanasi Children Hospital',
        location: { lat: 25.3000, lng: 83.0200 },
        address: 'Nadesar, Varanasi',
        specializations: ['PEDIATRIC', 'GENERAL'],
        availableBeds: 25,
        emergencyCapacity: 12,
        avgHandlingTime: 18,
        rating: 4.0
      },
      {
        name: 'Trauma Centre Varanasi',
        location: { lat: 25.2900, lng: 82.9600 },
        address: 'Shivpur, Varanasi',
        specializations: ['TRAUMA', 'NEUROLOGY', 'BURNS'],
        availableBeds: 15,
        emergencyCapacity: 6,
        avgHandlingTime: 12,
        rating: 4.3
      }
    ];

    await Hospital.insertMany(hospitalData);
    logger.info(`Created ${hospitalData.length} hospitals`);

    logger.info('Seeding completed successfully');
    logger.info('Admin credentials: admin@rapidaid.com / admin123');
    logger.info('Driver credentials: driver1@rapidaid.com / driver123');

    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    logger.error(`Seeding failed: ${err.message}`);
    await mongoose.connection.close();
    process.exit(1);
  }
};

seedDatabase();