const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { validateTrigger } = require('../middleware/emergencyValidation');
const { triggerEmergency, getSession } = require('../controllers/emergencyController');

router.use(protect); // All emergency routes require login

router.post('/trigger', validate(validateTrigger), triggerEmergency);
router.get('/:id', getSession);
const { getAvailableAmbulancesNear } = require('../services/ambulanceCache');

router.get('/debug/nearby', async (req, res) => {
  const results = await getAvailableAmbulancesNear(25.3176, 82.9739, 5);
  res.json({ count: results.length, data: results });
});

module.exports = router;