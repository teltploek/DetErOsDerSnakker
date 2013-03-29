
/**
 * Module dependencies.
 */

var express = require('express'),
  cp = require('child_process'), // used for grunt 
  routes = require('./routes'),
  Nationen = require('./routes/nationen.js'),
  uuid = require('node-uuid');

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

var N = {}; // to hold all Nationen room instances

// Socket.io Communication
io.sockets.on('connection', function(socket){
  var roomID = uuid.v1();

  socket.join(roomID); // separate clients - FIMXE: we might actually be able to drop node-uuid and use socket.id - try that out!

  N[roomID] = new Nationen(io, socket, roomID);

  socket.on('app:begin', function(){
    N[roomID]._retrieveFrontPage();
  });
})

// Start server
server.listen(3000, function(){
  console.log("Express server listening on port %d in %s mode", this.address().port, app.settings.env);
});