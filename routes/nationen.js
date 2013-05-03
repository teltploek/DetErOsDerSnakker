
/*!
 * Nationen
 */

/**
 * Module dependencies.
 */

var request = require('request'),
	cp = require('child_process'),
    cheerio = require('cheerio'),
    BufferList = require('bufferlist').BufferList,
    eventEmitter = require('events').EventEmitter,
    strutil = require('strutil'),
    _ = require('underscore'),
    mongoose = require('mongoose');

// Database schema
var articleSchema = mongoose.Schema({
	articleID : String,	
	timesSeen: Number,
	comments : [{
		id : Number,
		avatarUrl : String,
		name : String,
		date : String,
		body : String,
		rating : String,
		sound : Array
	}]
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
  this.existingArticle = false;
  this.articleID = '';
  this.articleUrl = '';
  this.comments = [];

  this.isDbConnected = false;
};

Nationen.prototype.reset = function(){
	this.events = new eventEmitter;
  	this.existingArticle = false;
  	this.articleID = '';
  	this.articleUrl = '';
  	this.comments = [];
};

/**
 * Used when users wants a certain article
 *
 * @api public
 */

Nationen.prototype.setArticleUrl = function(url){
	this.articleUrl = 'http://' + url;
};

/**
 * Wait for db-connection and begin when ready
 *
 * @api public
 */

Nationen.prototype.beginAfterDbConnection = function(dbConnectionString){
	var me = this;

	// FIXME: this isn't working properly - and is not the supported way to check connection status
	this.isDbConnected = mongoose.connection._hasOpened;

	if (!this.isDbConnected){
		mongoose.connect(dbConnectionString);

	  	this.db = mongoose.connection;

		this.db.once('open', function(){
			me.isDbConnected = true;

			if (me.articleUrl === ''){
				me.retrieveFrontPage();
			}else{
				me._fetchArticle(me.articleUrl);
			}
		});
	}else{
		if (this.articleUrl === ''){
			this.retrieveFrontPage();
		}else{
			this._fetchArticle(me.articleUrl);
		}
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

	this.mainIO.sockets.in(this.roomID).emit('new:status', 'Ekstrabladet.dk hentet...');

	this._findArticle(body);
};

/**
 * Find article url for which to parse comments from
 *
 * @param {String} the document body html
 * @api private
 */

Nationen.prototype._findArticle = function(body){
    this.mainIO.sockets.in(this.roomID).emit('new:status', 'Finder tilfældig artikel...');

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
	
	this.articleID = this._parseArticleID(url);

	request({ followAllRedirects : true, url : url }, function(error, response, body){
		// if (error) return errorLogger.log('error', error);
	
		me.mainIO.sockets.in(me.roomID).emit('new:status', 'Artikel fundet:');


		var $ = cheerio.load(body);

		var articleData = {
			title : $('h1.rubrik').first().text().trim(),
			href  : url,
			cleanHref : url.split('http://')[1] // href used for facebook like link
		};

		me.mainIO.sockets.in(me.roomID).emit('new:status', '' + articleData.title + ' - ' + articleData.href);

		me.mainIO.sockets.in(me.roomID).emit('article:found', articleData);

		me._fetchComments(me.articleID);
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

/**
 * Fetch comments from comment feed
 *
 * @param {Cheerio Object} The article HTML wrapped in Cheerio
 * @param {String} The article ID
 * @api private
 */

Nationen.prototype._fetchComments = function(articleID){
	var me = this;

	var commentsUrl = 'http://orange.ekstrabladet.dk/comments/get.json?disable_new_comments=false&target=comments&comments_expand=true&notification=comment&id='+articleID+'&client_width=610&max_level=100&context=default';

	this.mainIO.sockets.in(this.roomID).emit('new:status', 'Henter tilhørende Nationen kommmentarer...');

	request(commentsUrl, function(error, response, body){
  		// if (error) return errorLogger.log('error', error);

		me._parseFeed(body);
	});
};

/**
 * Parse the html using cheerio
 *
 * @param {Cheerio Object} The article HTML wrapped in Cheerio
 * @param {String} The JSON body returned by the http request
 * @api private
 */

Nationen.prototype._parseFeed = function(body){   
	// we need to sanitize the response from the nationen url because the result is pure and utter crap
    var content = this._sanitizeBogusJSON(body);

    var $ = cheerio.load(content);

    var commentObj = $('li.comment');

    if (commentObj.length){
      this.mainIO.sockets.in(this.roomID).emit('article:comments', commentObj.length);

      this._retrieveCommentObject(content);
    }else{
      this.mainIO.sockets.in(this.roomID).emit('new:status', 'Ingen kommentarer til denne artikel - finder ny artikel...');
      this.retrieveFrontPage();
    }
};

/**
 * Find out if this article is stored in the database and return 
 * the comment array or an empty array
 *
 * @param {String} the articleID for the article to retrieve
 * @api private
 */

Nationen.prototype._retrieveCommentObject = function(content){
	var me = this;

	Article.find({ articleID : me.articleID }, function(err, results){
		try{
			if (results && results.length){
				var result = results[0];
				me.existingArticle = true;
	
				me._retrieveComments(content, result.comments);
			}else{
				me.existingArticle = false;
				me._retrieveComments(content, []);
			}
		}catch(e){
			me.existingArticle = false;
			me._retrieveComments(content, []);
		}
	})
};

/**
 * Traverse through comments and retrieve data from each
 *
 * @param {String} HTML tree of comments
 * @api private
 */
Nationen.prototype._retrieveComments = function(content, existingComments){
    var me = this,
    	$ = cheerio.load(content),
        i = 0;

    // utils object for the retrieval of DOM node data
    var utils = {
		get : {
			avatarUrl : function(cheerioObj){
				return cheerioObj.find('.comment-inner').first().find('.avatar img').attr('src');
			},
			handle : function(cheerioObj){
				return cheerioObj.find('.comment-inner').first().find('.name-date .name').text();
			},
			date : function(cheerioObj){
				return cheerioObj.find('.comment-inner').first().find('.name-date .date').text();
			},
			rating : function(cheerioObj){
				return cheerioObj.find('.comment-inner').first().find('.rating-buttons .rating').text();
			},
			body : function($, cheerioObj){
				var body = '';
				cheerioObj.find('.comment-inner').first().find('.body p').each(function(i, elem){
	        		body = body + ' ' + $(elem).text();
	      		});

	      		return body;
			}
		},
		// there are stringified unicode characters in the comment feed - we need to JSON.parse them to get readable characters
		convertStringifiedUnicodeString : function(str){
			try{
				return JSON.parse("{ \"ent\" : \""+ str +"\" }").ent;
			}
			catch(e){
				return str;
			}
		}
	};
    
    this.mainIO.sockets.in(this.roomID).emit('new:status', 'Kommentarer fundet - indsamler kommentarer...');

    $('li.comment').each(function(){
		var existingComment = existingComments[i],
			comment,
			commentElm = $(this);

		if (existingComment){ // if we already have this comment in our database, we should just update the rating and date
			comment = existingComment;
			comment.rating = utils.get.rating(commentElm);
			comment.date = utils.get.date(commentElm);
		}else{
			var comment = {
				id : i,
				avatarUrl 	: utils.get.avatarUrl(commentElm),
				name 		: utils.convertStringifiedUnicodeString(utils.get.handle(commentElm)),
				date 		: utils.get.date(commentElm),
				body 		: utils.convertStringifiedUnicodeString(utils.get.body($, commentElm)),
				rating 		: utils.get.rating(commentElm),
				sound 		: [] // this array will hold all the base64 encoded sound bites for an entire comment
			};
		};

      	me.comments.push(comment);

      	i++;
	});   

    this.mainIO.sockets.in(this.roomID).emit('new:status', 'Alle kommentarer indsamlet. Konverterer til lyd...');

    this._distributeSoundBites();
  };

 /**
 * Handle transport of string data to chopping block and audio methods, while reporting back about the progress
 * 
 * @api private
 */

Nationen.prototype._distributeSoundBites = function(){
	var me = this,
		length = this.comments.length,
	    allCommentQueue = length,
	    i,
	    convertedComments = [],
	    article;

	for (i = 0; i < length; ++i) {
		var commentObj = this.comments[i];

		this.events.on('tts:done:' + commentObj.id, function(finishedCommentObj) {
			convertedComments[finishedCommentObj.id] = finishedCommentObj;

			allCommentQueue = allCommentQueue - 1;

			me.mainIO.sockets.in(me.roomID).emit('progress:update', allCommentQueue);

			if (allCommentQueue == 0){

				// find out if we should update existing db record or create new one
				if (me.existingArticle){
					Article.update(
						{ articleID : me.articleID },
						{ $set: { comments: convertedComments }, $inc: { timesSeen : 1 } },
						function(){
							me.mainIO.sockets.in(me.roomID).emit('post:fetched', convertedComments);
						}
					);
					}else{
						article = new Article({
							articleID : me.articleID,
							comments: convertedComments,
							timesSeen: 1
					});

					article.save(function(){
						me.mainIO.sockets.in(me.roomID).emit('post:fetched', convertedComments);
					});
				}
			}
		});

		if (commentObj.sound.length == 0){
			var googleTTSFriendlyComment = this._splitCommentInGoogleTTSFriendlyBites(commentObj.body); // we need to split comment in to bulks of 100 characters

			var tts = cp.fork(__dirname + '/tts.js');

			tts.on('message', function(data) {
			  me.events.emit(data.message, data.commentObj);
			});

			tts.send({ commentObj : commentObj, googleTTSFriendlyComment : googleTTSFriendlyComment });
		}else{
			this.events.emit('tts:done:' + commentObj.id, commentObj);
		}
	}
};

/**
 * Google TTS has a 100 character string limitation - we take care of that here + other friendly things
 *
 * @param {String} The raw comment text
 * @api private
 */

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

/**
 * The JSON coming from EB nationen is far from valid JSON. We need to sanitize it before being able to get anything out of it.
 *
 * @param {String} "JSON"
 * @api private
 */

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

/**
 * Return random number
 *
 * @param {Number} A max to the range in which to find a random number
 * @api private
 */

Nationen.prototype._getRandom = function(max){
    return Math.floor(Math.random()*max);
};