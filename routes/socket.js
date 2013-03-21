var request = require('request'),
    cheerio = require('cheerio'),
    BufferList = require('bufferlist').BufferList,
    eventEmitter = require('events').EventEmitter,
    strutil = require('strutil'),
    _ = require('underscore'),
    winston = require('winston');

var logger = function(filename){
  return new (winston.Logger)({
    transports: [
      new (winston.transports.Console)(),
      new (winston.transports.File)({ filename: 'logs/' + filename + '.log' })
    ]
  });
}

// facilitate logging
var applicationLogger = logger('app'),
    errorLogger = logger('error');

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
      if (error) return errorLogger.log('error', error);

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

    $('a[href^="http://ekstrabladet/112"]').remove();

    var articles = $('div.articles a[href^="http://ekstrabladet"]');

    if (articles.length == 0){
      articles = $('a[href^="http://ekstrabladet"]');
    };

    var randomArticle = $(articles[getRandom(articles.length)]);

    fetchArticle(randomArticle.attr('href'));
  };

  var fetchArticle = function(url){
    request(url, function(error, response, body){
      if (error) return errorLogger.log('error', error);

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
      if (error) return errorLogger.log('error', error);

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
        rating : $(this).find('.comment-inner .rating-buttons .rating').text(),
        bodySoundbites : [], // this array will hold all the base64 encoded sound bites for an entire comment
        bodySoundbitesIdx : []
      };

      $(this).find('.comment-inner .comment .body p').each(function(){
        comment.body = comment.body + ' ' + $(this).text();
      });
  
      // there are stringified unicode characters in the comment feed - we need to JSON.parse them to get readable characters
      var parseSource = "{ \"comment\" : \""+ comment.body +"\" }";
      var parsedComment = JSON.parse(parseSource);

      comment.body = parsedComment.comment;
      comment.bodyHTML = comment.body + '<br><br>';

      comments.push(comment);
    });   

    socket.emit('new:status', 'All comments retrieved. Running them by Google TTS...');

    distributeSoundBites();
  };

  var distributeSoundBites = function(){
    // var length = comments.length,
    //     i;
    // for (i = 0; i < length; ++i) {
    //   var commentObj = comments[i];
      var commentObj = comments[0];

      var googleTTSFriendlyComment = splitCommentInGoogleTTSFriendlyBites(commentObj.body); // we need to split comment in to bulks of 100 characters

      googleTextToSpeech(commentObj, googleTTSFriendlyComment);

      events.on('tts:done:' + commentObj.id, function(){
        socket.emit('post:fetched', commentObj);
      });
    // }
  };

  var splitCommentInGoogleTTSFriendlyBites = function(comment){   
    var toSay = [],
        punct = [',',':',';','.','?','!'],
        words = comment.split(' '),
        sentence = '';

    var wordsLength = words.length,
        w;

    for (w = 0; w < wordsLength; ++w){
      var word = words[w],
          couldBePunct = word.substr(word.length,word.length-1);

      // if we've encountered a punct!
      if (_.indexOf(punct, couldBePunct) != -1){
        if (sentence.length + word.length+1 < 100){
          sentence += ' '+word;
          toSay.push(sentence.trim());
        }else{
          toSay.push(sentence.trim());
          toSay.push(word.trim());
        }
        sentence = '';
      }else{
        if (sentence.length + word.length+1 < 100){
          sentence += ' '+word;
        }else{
          toSay.push(sentence.trim());
          sentence = word;
        }
      }
    }

    if (sentence.length > 0){
      toSay.push(sentence.trim())
    }

    return toSay;
  };

  var googleTextToSpeech = function(commentObj, googleFriendlyCommentArr){
    var length = googleFriendlyCommentArr.length,
        conversionQueue = length,
        i;

    for (i = 0; i < length; ++i){
      var idx = i,
          commentPart = googleFriendlyCommentArr[i];

      request({ url : 'http://translate.google.com/translate_tts?deods='+idx+'&ie=utf-8&tl=da&q='+ commentPart, headers : { 'Referer' : '' }, encoding: 'binary' }, function(error, response, body){
        if (error) return errorLogger.log('error', error);

        var data_uri_prefix = "data:" + response.headers["content-type"] + ";base64,";
        var comment64 = new Buffer(body.toString(), 'binary').toString('base64');                                                                                                                                                                 
        comment64 = data_uri_prefix + comment64;

        // FIXME: Major hack to have soundbites arranged in correct order:
        //        We're passing along the original index in the uri. When the call returns we parse out the uri query in the response to refetch our index
        // ... we need to rethink this - but right now, we want it working.
        // "First do it, then do it right, then do it better" - quote: Addy Osmani
        var soundBiteIdx = response.request.uri.query.split('&')[0].split('=')[1];

        commentObj.bodySoundbites[soundBiteIdx] = comment64;

        conversionQueue = conversionQueue - 1;

        if (conversionQueue == 0){
          events.emit('tts:done:' + commentObj.id);
        }
      });

    }

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