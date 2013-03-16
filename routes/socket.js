var request = require('request'),
    cheerio = require('cheerio'),
    BufferList = require('bufferlist').BufferList,
    eventEmitter = require('events').EventEmitter,
    strutil = require('strutil');

var nationen = (function () {

  var events = new eventEmitter
      socket = null,
      comments = [];


  var init = function(mainSocket){
    socket = mainSocket; // setting global socket for nationen scope

    retrieveFrontPage(); // unveil madness!
  };

  var retrieveFrontPage = function(){
    request('http://ekstrabladet.dk/', function(error, response, body) {
      if (error) return console.error(error);

      successMediator(body, function(comments){
        socket.emit('message:incoming', comments);
      });
    });
  }

  var successMediator = function (body, callback){
    socket.emit('new:status', 'ekstrabladet.dk fetched!');

    // FIXME: We might not need this - we need to make it event based due to asyncronous nature of Google TTS call... think it through, matey
    events.on('comments:fetched', function(){
      callback(comments);
    });

    findArticle(body);
  };

  var findArticle = function(body){
    socket.emit('new:status', 'Fetching random article...');

    var $ = cheerio.load(body);

    var articles = $('div.articles a[href^="http://ekstrabladet"]');

    if (articles.length == 0){
      articles = $('a[href^="http://ekstrabladet"]');
    };

    var randomArticle = $(articles[getRandom(articles.length)]);

    fetchArticle(randomArticle.attr('href'));
  };

  var fetchArticle = function(url){
    request(url, function(error, response, body){
      if (error) return console.error(error);

      socket.emit('new:status', 'Random article found:');     

      var $ = cheerio.load(body);

      socket.emit('new:status', '<a href="'+url+'" target="_blank">' + $('h1.rubrik').first().text() + '</a>');

      fetchComments($, url);
    });
  };

  var parseArticleID = function(url){
    return url.split('article')[1].split('.ece')[0];
  };

  var fetchComments = function(articleHtml, url){
    var articleID = parseArticleID(url),
        commentsUrl = 'http://orange.ekstrabladet.dk/comments/get.json?disable_new_comments=false&target=comments&comments_expand=true&notification=comment&id='+articleID+'&client_width=610&max_level=100&context=default';
   
    socket.emit('new:status', 'Fetching nationen comments...');

    request(commentsUrl, function(error, response, body){
      if (error) return console.error(error);

      parseFeed(articleHtml, body);
    });    
  };

  var parseFeed = function(articleHtml, body){   
    // we need to sanitize the response from the nationen url because the result is pure and utter crap
    var content = sanitizeBogusJSON(body);

    var $ = cheerio.load(content);

    var commentObj = $('li.comment');

    if (commentObj.length){
      retrieveComments($, commentObj);
    }else{
      socket.emit('new:status', 'No comments for this article - finding new article...');
      retrieveFrontPage();
    }
  };

  var retrieveComments = function($, commentObj){
    socket.emit('new:status', 'Comments found - retrieving comments...');

    commentObj.each(function(idx, elm){
      var comment = {
        id : idx,
        avatarUrl : $(this).find('.comment-inner .avatar img').attr('src'),
        name : $(this).find('.comment-inner .name-date .name').text(),
        date : $(this).find('.comment-inner .name-date .date').text(),
        body : '',
        bodyHTML : '',
        rating : $(this).find('.comment-inner .rating-buttons .rating').text()
      };

      $(this).find('.comment-inner .comment .body p').each(function(){
        comment.body = comment.body + ' ' + $(this).text();
      });

      comment.body = unescape(comment.body);
      comment.bodyHTML = comment.body + '<br><br>';

      comments.push(comment);
    });   

    socket.emit('new:status', 'All comments retrieved. Running them by Google TTS...');

    distributeSoundBites();
  };

  var distributeSoundBites = function(){
    // for (var i = 0; i < comments.length; ++i) {
      var comment = comments[0];

      googleTextToSpeech(comment);

      events.on('tts:done:' + comment.id, function(){
        socket.emit('post:fetched', comment);
      });
    // }
  };

  var googleTextToSpeech = function(comment){
    // TODO: Split comment body into parts of hundred characters, and pass them in separately. Stich them together in an array afterwards

    request({ url : 'http://translate.google.com/translate_tts?ie=utf-8&tl=da&q='+ comment.body.substr(0, 100), headers : { 'Referer' : '' }, encoding: 'binary' }, function(error, response, body){
      if (error) return console.error(error);

      var data_uri_prefix = "data:" + response.headers["content-type"] + ";base64,";
      var comment64 = new Buffer(body.toString(), 'binary').toString('base64');                                                                                                                                                                 
      comment64 = data_uri_prefix + comment64;

      comment.bodySoundbite = comment64;

      events.emit('tts:done:' + comment.id);
    });
  };

  var sanitizeBogusJSON = function(bogusJSON){
    var content = bogusJSON.toString('utf8');

    content = content.replace(/{{/g, '');     

    content = content.replace(/}}/g, '');
    content = content.replace(/\\"/g, "'");
    content = content.replace(/\\\//g, "/");

    content = content.replace(/\\\\n/g, "");
    content = content.replace(/\\\\t/g, "");

    content = content.replace(/\\n/g, "");
    content = content.replace(/\\t/g, "");
    content = content.replace(/(<br>)*/g, "");

    return content;
  };

  var getRandom = function(max){
    return Math.floor(Math.random()*max);
  };

  return {
    init: init
  };
}());

// export function for listening to the socket
module.exports = function (socket) {	
	socket.on('app:begin', function (data) {
    socket.emit('new:status', 'Fetching ekstrabladet.dk...');

    nationen.init(socket);
	});
};