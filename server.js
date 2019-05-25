// server.js

// =============================================================================
// BASE SETUP
// =============================================================================

// call the packages we need
var express             = require('express');
var expressValidator    = require('express-validator');
var bodyParser          = require('body-parser');
var mongoose            = require('mongoose');
var morgan              = require('morgan');

// import app configurations
var config              = require('./config');

// import routes
var router              = require('./routes/router.js');

// define our app using express
var app                 = express();

// connect to our db
mongoose.connect(config.database);

// configure app to use bodyParser()
// this will let us get the data from a POST
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(expressValidator());
app.use(morgan(config.loglevel));

// set app port
var port = process.env.PORT || config.app_port;

// REGISTER OUR ROUTES
// all of our routes will be prefixed with /api
app.use('/api', router);

// =============================================================================
// START THE SERVER
// =============================================================================
app.listen(port);
console.log(
    config.app_name + ' - listening on port: ' 
    + config.app_port 
    + ', API version: ' + config.version
);