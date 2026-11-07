// routeController.js – thin controller for /api/routes
'use strict';

const service = require('../services/routeService');
const { handler } = require('./_handler');

module.exports = {
  list:   handler((req) => service.list(req.query)),
  getById: handler((req) => service.getOr404(req.params.routeId)),
  create: handler((req) => service.create(req.body), { status: 201, message: 'Route created' }),
  update: handler((req) => service.update(req.params.routeId, req.body), { message: 'Route updated' }),
  remove: handler((req) => service.remove(req.params.routeId), { message: 'Route deleted' })
};
