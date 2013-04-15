
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
    winston = require('winston'),
    mongoose = require('mongoose');

var articleSchema = mongoose.Schema({
	articleID : String,
	comments : [{
		id : Number,
		avatarUrl : String,
		name : String,
		date : String,
		body : String,
		bodyHTML : String,
		rating : String,
		bodySoundbites : Array
	}],
	count: Number
});

var Article = mongoose.model('Article', articleSchema);

/**
 * Export the constructor.
 */
exports = module.exports = Nationen;

/**
 * Nationen constructor.
 *
 * @param {socket.io} io sockets express instance
 * @param {socket} socket instance
 * @param {String} namespace the socket belongs to
 * @api public
 */

function Nationen(mainIO, mainSocket, roomID) {
  var me = this;

  this.roomID = roomID;
  this.initialSocket = mainSocket;
  this.mainIO = mainIO;

  this.events = new eventEmitter;
  this.articleID = '';
  this.comments = [];

  this.isDbConnected = false;
};

Nationen.prototype.beginAfterDbConnection = function(dbConnectionString){
	var me = this;

	if (!this.isDbConnected){
		mongoose.connect(dbConnectionString);

	  	this.db = mongoose.connection;

		this.db.once('open', function(){
			me.isDbConnected = true;

			me.retrieveFrontPage();
		});
	}else{
		this.retrieveFrontPage();
	}
};

/**
 * Scrape front page
 *
 * @api public
 */

Nationen.prototype.retrieveFrontPage = function(){
	var me = this;

	this.comments = [];

	request('http://ekstrabladet.dk/', function(error, response, body) {
	  // if (error) return errorLogger.log('error', error);
	
		me._successMediator(body, function(comments){
			me.mainIO.sockets.in(me.roomID).emit('message:incoming', comments);
		});
	});
};

/**
 * Mediator for successful callback for front page scrape
 *
 * @param {String} the fetched body html
 * @param {Function} which method to call, when we're ready to send data to front end
 * @api private
 */

Nationen.prototype._successMediator = function(body, callback){
	var me = this;

	this.mainIO.sockets.in(this.roomID).emit('new:status', 'ekstrabladet.dk fetched!');

	this._findArticle(body);
};

/**
 * Find article url for which to parse comments from
 *
 * @param {String} the document body html
 * @api private
 */

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

/**
 * Fetch article by url
 *
 * @param {String} the url for the article we wish to fetch
 * @api private
 */

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

		me._lookForStoredArticle($, url);
	});
};

/**
 * Parsing the url to find the ID of the article
 *
 * @param {String} the url for an article
 * @api private
 */

Nationen.prototype._parseArticleID = function(url){
	return url.split('article')[1].split('.ece')[0];
};


Nationen.prototype._lookForStoredArticle = function(articleHtml, url){
	var me = this;

	this.articleID = '1945143';
	// this.articleID = this._parseArticleID(url);


	Article.find({ articleID : me.articleID }, function(err, results){
		try{
			if (results && results.length){
				var result = results[0];

				me.mainIO.sockets.in(me.roomID).emit('post:fetched', result.comments);
			}else{
				me._fetchComments(me.articleID, articleHtml);
			}
		}catch(e){
			console.log(e);
		}
	})
};

/**
 * Fetch comments from comment feed
 *
 * @param ...
 * @api private
 */

Nationen.prototype._fetchComments = function(articleID, articleHtml){
	var me = this;

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
      this.retrieveFrontPage();
    }
};

Nationen.prototype._retrieveComments = function(content){
    var me = this,
    	$ = cheerio.load(content),
        i = 0;
    
    this.mainIO.sockets.in(this.roomID).emit('new:status', 'Comments found - retrieving comments...');

    $('li.comment').each(function(){
      var comment = {
        id : i,
        avatarUrl : $(this).find('.comment-inner').first().find('.avatar img').attr('src'),
        name : $(this).find('.comment-inner').first().find('.name-date .name').text(),
        date : $(this).find('.comment-inner').first().find('.name-date .date').text(),
        body : '',
        bodyHTML : '',
        rating : $(this).find('.comment-inner').first().find('.rating-buttons .rating').text(),
        bodySoundbites : [] // this array will hold all the base64 encoded sound bites for an entire comment
      };

      $(this).find('.comment-inner').first().find('.body p').each(function(i, elem){
        comment.body = comment.body + ' ' + $(elem).text();
      });
  
      // there are stringified unicode characters in the comment feed - we need to JSON.parse them to get readable characters
      var parseSource = "{ \"comment\" : \""+ comment.body +"\" }";
      var parsedName = JSON.parse("{ \"name\" : \""+ comment.name +"\" }");
      var parsedComment = JSON.parse(parseSource);

      comment.name = parsedName.name;
      comment.body = parsedComment.comment;
      comment.bodyHTML = comment.body;

      me.comments.push(comment);

      i++;
    });   

    this.mainIO.sockets.in(this.roomID).emit('new:status', 'All comments retrieved. Running them by Google TTS...');

    this._distributeSoundBites();
  };

Nationen.prototype._distributeSoundBites = function(){
	var me = this,
		length = this.comments.length,
	    allCommentQueue = length,
	    i,
	    convertedComments = [],
	    article;

	for (i = 0; i < length; ++i) {
	  var commentObj = this.comments[i];

	  var googleTTSFriendlyComment = this._splitCommentInGoogleTTSFriendlyBites(commentObj.body); // we need to split comment in to bulks of 100 characters

	  this._converCommentsToAudio(commentObj, googleTTSFriendlyComment);

	  this.events.on('tts:done:' + commentObj.id, function(finishedCommentObj){
	    convertedComments[finishedCommentObj.id] = finishedCommentObj;

	    allCommentQueue = allCommentQueue - 1;

	    me.mainIO.sockets.in(me.roomID).emit('progress:update', allCommentQueue);

	    if (allCommentQueue == 0){
	    	article = new Article({
	    		articleID : me.articleID,
	    		comments: convertedComments
	    	});

	    	article.save(function(){
	    		me.mainIO.sockets.in(me.roomID).emit('post:fetched', convertedComments);
	    	})

	      }
	  });
	}
};

Nationen.prototype._splitCommentInGoogleTTSFriendlyBites = function(comment){
	var toSay = [],
	    punct = [',',':',';','.','?','!'];

	// we don't want more than one punct in a row
	comment = comment.replace(/\.\.+/g, '.');

	// we don't want to read out web addresses
	comment = comment.replace(/(ftp|http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?/g, 'web-adresse');

	// put space after each an every punct sign
    _.each(punct, function(val){
    	comment = comment.split(val).join(val + ' ');
    });

    // remove double spaces
    comment = comment.split('  ').join(' ');

	var words = comment.split(' '),
	    sentence = '';

	var wordsLength = words.length,
	    w;

	for (w = 0; w < wordsLength; ++w){
	  var word = words[w],
	      couldBePunct = word.substr(word.length, word.length-1);

	  // if we've encountered a punct!
	  if (_.indexOf(punct, couldBePunct) != -1){
	    if (sentence.length + word.length+1 < 100){
	      sentence += ' ' + word;
	      toSay.push(sentence.trim());
	    }else{
	      toSay.push(sentence.trim());
	      toSay.push(word.trim());
	    }
	    sentence = '';
	  }else{
	    if (sentence.length + word.length+1 < 100){
	      sentence += ' ' + word;
	    }else{
	      toSay.push(sentence.trim());
	      sentence = ' ' + word;
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
	    // 		  ... we need to rethink this - but right now, we want it working.
	    // "First do it, then do it right, then do it better" - quote: Addy Osmani
	    var soundBiteIdx = response.request.uri.query.split('&')[0].split('=')[1];

	    commentObj.bodySoundbites[soundBiteIdx] = comment64;

	    conversionQueue = conversionQueue - 1;

	    if (conversionQueue == 0){
	      me.events.emit('tts:done:' + commentObj.id, commentObj);
	    }
	  });
	}
};

Nationen.prototype._googleTextToSpeech = function(url, callback){
	request({ url : url, headers : { 'Referer' : '' }, encoding: 'binary' }, callback);
};

Nationen.prototype._convertTTSResponseToBase64 = function(response, body){
	var data_uri_prefix = 'data:' + response.headers['content-type'] + ';base64,';

	// try to handle response, or fail gracefully...
	try{
    	var comment64 = new Buffer(body.toString(), 'binary').toString('base64');
	}
	catch(e){ // ...by adding empty sound to base64 string
		var comment64 = '/+MYxAAAAANIAUAAAASEEB/jwOFM/0MM/90b/+RhST//w4NFwOjf///PZu////9lns5GFDv//l9GlUIEEIAAAgIg8Ir/JGq3/+MYxDsLIj5QMYcoAP0dv9HIjUcH//yYSg';
	}

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