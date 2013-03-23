var request = require('request'),
    cheerio = require('cheerio'),
    BufferList = require('bufferlist').BufferList,
    eventEmitter = require('events').EventEmitter,
    strutil = require('strutil'),
    _ = require('underscore'),
    winston = require('winston');

// TODO: move all logging-stuff to app.js
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

  // we need a couple of hardcoded messages in the system, that we need to pass along to Google TTS as well
  var narration = {
    cycle: {
      answer : 'Svar til foregående kommentar'
    },
    author : {
      by : 'Kommentar af indsendt af',
      when : 'den '
    },
    rating: {
      '+' : 'Plus',
      '-' : 'Minus'
    }
  };

  var init = function(mainSocket){
    comments = [];
    
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

    // we remove articles that we know doesn't have comments - 112 articles doesn't
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

      var articleData = {
        title : $('h1.rubrik').first().text(),
        href  : url
      }

      socket.emit('new:status', '' + articleData.title + ' - ' + articleData.href);

      socket.emit('article:found', articleData);

      fetchComments($, url);
    });
  };

  var parseArticleID = function(url){
    return url.split('article')[1].split('.ece')[0];
  };

  var fetchComments = function(articleHtml, url){
    var articleID = parseArticleID(url);

    var commentsUrl = 'http://orange.ekstrabladet.dk/comments/get.json?disable_new_comments=false&target=comments&comments_expand=true&notification=comment&id='+articleID+'&client_width=610&max_level=100&context=default';
   
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
      retrieveComments(content);
    }else{
      socket.emit('new:status', 'No comments for this article - finding new article...');
      retrieveFrontPage();
    }
  };

  var retrieveComments = function(content){
    var $ = cheerio.load(content),
        i = 0;
    
    socket.emit('new:status', 'Comments found - retrieving comments...');

    $('li.comment').each(function(){
      i++;

      var comment = {
        id : i,
        avatarUrl : $(this).find('.comment-inner').first().find('.avatar img').attr('src'),
        name : $(this).find('.comment-inner').first().find('.name-date .name').text(),
        date : $(this).find('.comment-inner').first().find('.name-date .date').text(),
        body : '',
        bodyHTML : '',
        rating : $(this).find('.comment-inner').first().find('.rating-buttons .rating').text(),
        bodySoundbites : [], // this array will hold all the base64 encoded sound bites for an entire comment
        bodySoundbitesIdx : []
      };

      $(this).find('.comment-inner').first().find('.body p').each(function(i, elem){
        comment.body = comment.body + ' ' + $(elem).text();
      });
  
      // there are stringified unicode characters in the comment feed - we need to JSON.parse them to get readable characters
      var parseSource = "{ \"comment\" : \""+ comment.body +"\" }";
      var parsedComment = JSON.parse(parseSource);

      comment.body = parsedComment.comment;
      comment.bodyHTML = comment.body;

      comments.push(comment);
    });   

    socket.emit('new:status', 'All comments retrieved. Running them by Google TTS...');

    distributeSoundBites();
  };

  var distributeSoundBites = function(){
    var length = comments.length,
        allCommentQueue = length,
        i;

    for (i = 0; i < length; ++i) {
      var commentObj = comments[i];

      var googleTTSFriendlyComment = splitCommentInGoogleTTSFriendlyBites(commentObj.body); // we need to split comment in to bulks of 100 characters

      converCommentsToAudio(commentObj, googleTTSFriendlyComment);

      events.on('tts:done:' + commentObj.id, function(){
        comments.push(commentObj);

        allCommentQueue = allCommentQueue - 1;

        if (allCommentQueue == 0){
          socket.emit('post:fetched', comments);
        }
      });
    }
  };

  // TODO: add space after all puncts - and remove double spaces afterwards - TTS has trouble with words that comes right after a punct sign
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

  var converCommentsToAudio = function(commentObj, googleFriendlyCommentArr){
    var length = googleFriendlyCommentArr.length,
        conversionQueue = length,
        i;

    for (i = 0; i < length; ++i){
      var idx = i,
          commentPart = googleFriendlyCommentArr[i];

      googleTextToSpeech('http://translate.google.com/translate_tts?deods='+idx+'&ie=utf-8&tl=da&q='+ commentPart, function(error, response, body){
        if (error) return errorLogger.log('error', error);

        var comment64 = convertTTSResponseToBase64(response, body);

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

  var googleTextToSpeech = function(url, callback){
    request({ url : url, headers : { 'Referer' : '' }, encoding: 'binary' }, callback);
  };

  var convertTTSResponseToBase64 = function(response, body){
    var data_uri_prefix = 'data:' + response.headers['content-type'] + ';base64,';
    var comment64 = new Buffer(body.toString(), 'binary').toString('base64');

    return data_uri_prefix + comment64;
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