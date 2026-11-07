// scheduleController.js – thin controller for /api/schedules
'use strict';

const service = require('../services/scheduleService');
const { handler } = require('./_handler');

module.exports = {
  list:   handler((req) => service.list(req.query)),
  getById: handler((req) => service.getOr404(req.params.scheduleId)),
  create: handler((req) => service.create(req.body), { status: 201, message: 'Schedule created' }),
  update: handler((req) => service.update(req.params.scheduleId, req.body), { message: 'Schedule updated' }),
  remove: handler((req) => service.remove(req.params.scheduleId), { message: 'Schedule deleted' })
};
