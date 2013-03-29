
/*!
 * Nationen
 * TODO: documentation... as always...
 */

/**
 * Module dependencies.
 */

var request = require('request'),
    cheerio = require('cheerio'),
    BufferList = require('bufferlist').BufferList,
    eventEmitter = require('events').EventEmitter,
    strutil = require('strutil'),
    _ = require('underscore'),
    winston = require('winston');

/**
 * Export the constructor.
 */
exports = module.exports = Nationen;

function Nationen(mainIO, mainSocket, roomID) {
  var me = this;

  this.roomID = roomID;
  this.initialSocket = mainSocket;
  this.mainIO = mainIO;

  this.events = new eventEmitter;
  this.comments = [];
};

Nationen.prototype._retrieveFrontPage = function(){
	var me = this;

	request('http://ekstrabladet.dk/', function(error, response, body) {
	  // if (error) return errorLogger.log('error', error);
	
		me._successMediator(body, function(comments){
			me.mainIO.sockets.in(me.roomID).emit('message:incoming', comments);
		});
	});
};

Nationen.prototype._successMediator = function(body, callback){
	var me = this;

	this.mainIO.sockets.in(this.roomID).emit('new:status', 'ekstrabladet.dk fetched!');

	// FIXME: We might not need this - we need to make it event based due to asyncronous nature of Google TTS call... think it through, matey
	this.events.on('comments:fetched', function(){
		callback(me.comments);
	});

	this._findArticle(body);
};

Nationen.prototype._findArticle = function(body){
    this.mainIO.sockets.in(this.roomID).emit('new:status', 'Fetching random article...');

    var $ = cheerio.load(body);

    // we remove articles that we know doesn't have comments - 112 articles doesn't
    $('a[href^="http://ekstrabladet/112"]').remove();

    var articles = $('div.articles a[href^="http://ekstrabladet"]');

    if (articles.length == 0){
      articles = $('a[href^="http://ekstrabladet"]');
    };

    var randomArticle = $(articles[this._getRandom(articles.length)]);

    this._fetchArticle(randomArticle.attr('href'));
};

Nationen.prototype._fetchArticle = function(url){
	var me = this;

	request(url, function(error, response, body){
		// if (error) return errorLogger.log('error', error);

		me.mainIO.sockets.in(me.roomID).emit('new:status', 'Random article found:');

		var $ = cheerio.load(body);

		var articleData = {
			title : $('h1.rubrik').first().text(),
			href  : url
		}

		me.mainIO.sockets.in(me.roomID).emit('new:status', '' + articleData.title + ' - ' + articleData.href);

		me.mainIO.sockets.in(me.roomID).emit('article:found', articleData);

		me._fetchComments($, url);
	});
};

Nationen.prototype._parseArticleID = function(url){
	return url.split('article')[1].split('.ece')[0];
};

Nationen.prototype._fetchComments = function(articleHtml, url){
	var me = this,
		articleID = this._parseArticleID(url);

	var commentsUrl = 'http://orange.ekstrabladet.dk/comments/get.json?disable_new_comments=false&target=comments&comments_expand=true&notification=comment&id='+articleID+'&client_width=610&max_level=100&context=default';

	this.mainIO.sockets.in(this.roomID).emit('new:status', 'Fetching nationen comments...');

	request(commentsUrl, function(error, response, body){
  		// if (error) return errorLogger.log('error', error);

		me._parseFeed(articleHtml, body);
	});
};

Nationen.prototype._parseFeed = function(articleHtml, body){   
	// we need to sanitize the response from the nationen url because the result is pure and utter crap
    var content = this._sanitizeBogusJSON(body);

    var $ = cheerio.load(content);

    var commentObj = $('li.comment');

    if (commentObj.length){
      this.mainIO.sockets.in(this.roomID).emit('article:comments', commentObj.length);

      this._retrieveComments(content);
    }else{
      this.mainIO.sockets.in(this.roomID).emit('new:status', 'No comments for this article - finding new article...');
      this._retrieveFrontPage();
    }
};

Nationen.prototype._retrieveComments = function(content){
    var me = this,
    	$ = cheerio.load(content),
        i = 0;
    
    this.mainIO.sockets.in(this.roomID).emit('new:status', 'Comments found - retrieving comments...');

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

      me.comments.push(comment);
    });   

    this.mainIO.sockets.in(this.roomID).emit('new:status', 'All comments retrieved. Running them by Google TTS...');

    this._distributeSoundBites();
  };

Nationen.prototype._distributeSoundBites = function(){
	var me = this,
		length = this.comments.length,
	    allCommentQueue = length,
	    i;

	for (i = 0; i < length; ++i) {
	  var commentObj = this.comments[i];

	  var googleTTSFriendlyComment = this._splitCommentInGoogleTTSFriendlyBites(commentObj.body); // we need to split comment in to bulks of 100 characters

	  this._converCommentsToAudio(commentObj, googleTTSFriendlyComment);

	  this.events.on('tts:done:' + commentObj.id, function(){
	    me.comments.push(commentObj); // FIXME: do we add comments yet again here? Find out if this is a mistake

	    allCommentQueue = allCommentQueue - 1;

	    me.mainIO.sockets.in(me.roomID).emit('progress:update', allCommentQueue);

	    if (allCommentQueue == 0){
	      me.mainIO.sockets.in(me.roomID).emit('post:fetched', me.comments);
	    }
	  });
	}
};

// TODO: add space after all puncts - and remove double spaces afterwards - TTS has trouble with words that comes right after a punct sign
Nationen.prototype._splitCommentInGoogleTTSFriendlyBites = function(comment){
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

Nationen.prototype._converCommentsToAudio = function(commentObj, googleFriendlyCommentArr){
	var me = this,
		length = googleFriendlyCommentArr.length,
	    conversionQueue = length,
	    i;

	for (i = 0; i < length; ++i){
	  var idx = i,
	      commentPart = googleFriendlyCommentArr[i];

	  this._googleTextToSpeech('http://translate.google.com/translate_tts?deods='+idx+'&ie=utf-8&tl=da&q='+ commentPart, function(error, response, body){
	    if (error) return errorLogger.log('error', error);

	    var comment64 = me._convertTTSResponseToBase64(response, body);

	    // FIXME: Major hack to have soundbites arranged in correct order:
	    //        We're passing along the original index in the uri. When the call returns we parse out the uri query in the response to refetch our index
	    // ... we need to rethink this - but right now, we want it working.
	    // "First do it, then do it right, then do it better" - quote: Addy Osmani
	    var soundBiteIdx = response.request.uri.query.split('&')[0].split('=')[1];

	    commentObj.bodySoundbites[soundBiteIdx] = comment64;

	    conversionQueue = conversionQueue - 1;

	    if (conversionQueue == 0){
	      me.events.emit('tts:done:' + commentObj.id);
	    }
	  });
	}
};

Nationen.prototype._googleTextToSpeech = function(url, callback){
	request({ url : url, headers : { 'Referer' : '' }, encoding: 'binary' }, callback);
};

Nationen.prototype._convertTTSResponseToBase64 = function(response, body){
	var data_uri_prefix = 'data:' + response.headers['content-type'] + ';base64,';
    var comment64 = new Buffer(body.toString(), 'binary').toString('base64');

	return data_uri_prefix + comment64;
};

Nationen.prototype._sanitizeBogusJSON = function(bogusJSON){
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

Nationen.prototype._getRandom = function(max){
    return Math.floor(Math.random()*max);
};