// Serve public routes

var express = require('express')
var Router = express.Router
var join = require('path').join

module.exports = (function () {
  var routes = Router()

  // routes.use('/public', express.static(join(__dirname, 'build')))
  routes.use('/', express.static(join(__dirname, 'build/static')))

  return routes
})()