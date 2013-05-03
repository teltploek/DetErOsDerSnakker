
/**
 * Module dependencies.
 */

var express = require('express'),
    routes = require('./routes'),
    Nationen = require('./routes/nationen.js');

var app = module.exports = express();
var server = require('http').createServer(app);
var articleUrl = '';

// Hook Socket.io into Express
var io = require('socket.io').listen(server);

// AppFog does not support socket.io - we need to set it to xhr-polling
io.set('transports', ['xhr-polling']);
io.set('polling duration', 10); 

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
  var cp = require('child_process'); // used for grunt 

  // setup grunt as a child process
  var grunt = cp.spawn('grunt.cmd', ['default', 'watch']);

  grunt.stdout.on('data', function(data) {
    // relay output to console
    console.log("%s", data)
  });

  process.env.DBSTR = 'mongodb://localhost/DetErOsDerSnakker';
  
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

app.configure('production', function(){
  app.set('dbString', process.env.DBSTR); // the db connection string is stored in nodejitsu dashboard as an environment variable
  app.use(express.errorHandler());
});

// Routes
app.get('/', function(req, res){
  if (req.query.a){    
    articleUrl = req.query.a;
  }else{
    articleUrl = '';
  }

  routes.index(req, res);
});

app.get('/velkommen', routes.welcome);
app.get('/bookmarklet', routes.bookmarklet);

// Socket.io Communication
io.sockets.on('connection', function(socket){
  var roomID = socket.id;

  socket.join(roomID);

  var N = new Nationen(io, socket, roomID);

  socket.on('app:begin', function(){
    N.reset();
    
    if (articleUrl !== ''){
      N.setArticleUrl(articleUrl);
    };

    N.beginAfterDbConnection(process.env.DBSTR);
  });
});

// Start server
server.listen(3000, function(){
  console.log("Express server listening on port %d in %s mode", this.address().port, app.settings.env);
});