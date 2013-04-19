
/**
 * Module dependencies.
 */

var express = require('express'),
    // fs = require('fs'),
    cp = require('child_process'), // used for grunt 
    routes = require('./routes'),
    Nationen = require('./routes/nationen.js');

  // setup grunt as a child process
var grunt = cp.spawn('grunt.cmd', ['default', 'watch']);

// TODO: read package.json data with fs to show project status (version etc.) in index footer
// var packageJSON = JSON.parse(fs.readFileSync('package.json', 'utf8'));

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
  process.env.DBSTR = 'mongodb://localhost/DetErOsDerSnakker';
  
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

app.configure('production', function(){
  app.set('dbString', process.env.DBSTR); // the db connection string is stored in nodejitsu dashboard as an environment variable
  app.use(express.errorHandler());
});

// Routes
app.get('/', routes.index);

// redirect all others to the index (HTML5 history)
// app.get('*', routes.index);

// Socket.io Communication
io.sockets.on('connection', function(socket){
  var roomID = socket.id;

  socket.join(roomID);

  var N = new Nationen(io, socket, roomID);

  socket.on('app:begin', function(){
    N.beginAfterDbConnection(process.env.DBSTR);
  });
});

// Start server
server.listen(3000, function(){
  console.log("Express server listening on port %d in %s mode", this.address().port, app.settings.env);
});