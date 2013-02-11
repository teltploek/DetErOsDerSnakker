
/**
 * Module dependencies.
 */

var express = require('express'),
  cp = require('child_process'), // used for grunt 
  routes = require('./routes'),
  socket = require('./routes/socket.js');


  // setup grunt as a child process
var grunt = cp.spawn('grunt.cmd', ['default', 'watch']);

grunt.stdout.on('data', function(data) {
  // relay output to console
  console.log("%s", data)
})

var app = module.exports = express();
var server = require('http').createServer(app);

// Hook Socket.io into Express
var io = require('socket.io').listen(server);

// Configuration

app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.set('view options', {
    layout: false
  });
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(express.static(__dirname + '/public'));
  app.use(app.router);
});

app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

app.configure('production', function(){
  app.use(express.errorHandler());
});

// Routes
app.get('/', routes.index);

// redirect all others to the index (HTML5 history)
app.get('*', routes.error);

// Socket.io Communication
io.sockets.on('connection', socket);

// Start server
server.listen(3000, function(){
  console.log("Express server listening on port %d in %s mode", this.address().port, app.settings.env);
});
