
/*!
 * Nationen
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
    mongoose = require('mongoose'),
    cp = require('child_process');

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

			// this will only work when we can host the app in a multi threaded env
			// -
			// var tts = cp.fork('./local_modules/tts.js');

			// tts.on('message', function(data) {
			// 	me.events.emit(data.message, data.commentObj);
			// });

			// tts.send({ commentObj : commentObj, googleTTSFriendlyComment : googleTTSFriendlyComment });

			this._converCommentsToAudio(commentObj, googleTTSFriendlyComment);
		}else{
			this.events.emit('tts:done:' + commentObj.id, commentObj);
		}
	}
};


 /* Transporting and keeping track of audio conversion
  *
  * @param {Object} The comment object in the form of the Article schema
  * @param {Array} The array holding Google TTS friendly comments
  * @api private
  */
 
 Nationen.prototype._converCommentsToAudio = function(commentObj, googleFriendlyCommentArr){
 	var me = this,
 		length = googleFriendlyCommentArr.length,
 	    conversionQueue = length,
 	    i;
 
	for (i = 0; i < length; ++i){
 	  var idx = i,
 	      commentPart = googleFriendlyCommentArr[i];
 
 	  this._googleTextToSpeech('http://translate.google.com/translate_tts?deods='+idx+'&ie=utf-8&tl=da&q='+ commentPart, function(error, response, body){
 	    //if (error) return errorLogger.log('error', error);
 
 	    var comment64 = me._convertTTSResponseToBase64(response, body);
 
 	    // FIXME: Major hack to have soundbites arranged in correct order:
 	    //        We're passing along the original index in the uri. When the call returns we parse out the uri query in the response to refetch our index
 	    // 		  ... we need to rethink this - but right now, we want it working.
 	    // "First do it, then do it right, then do it better" - quote: Addy Osmani
 	    var soundBiteIdx = response.request.uri.query.split('&')[0].split('=')[1];
 
 	    commentObj.sound[soundBiteIdx] = comment64;
 
 	    conversionQueue = conversionQueue - 1;
 
 	    if (conversionQueue == 0){
 	      me.events.emit('tts:done:' + commentObj.id, commentObj);
 	    }
 	  });
 	}
 };
 
 /**
  * Executing the actual Google TTS request
  *
  * @param {String} The Google TTS url with params to call
  * @param {Function} The success callback
  * @api private
  */
 
 Nationen.prototype._googleTextToSpeech = function(url, callback){
 	request({ url : url, headers : { 'Referer' : '' }, encoding: 'binary' }, callback);
 };
 
 /**
  * Converting audio data to base64 string, or die trying
  *
  * @param {Object} The response object from the request
  * @param {String} The body retrieved by a http request
  * @api private
  */
 
 Nationen.prototype._convertTTSResponseToBase64 = function(response, body){
	// try to handle response, or fail gracefully...
	try{
        // if we get html return from google we're being blocked because of unusual traffic...
        if (response.headers['content-type'] != 'text/html'){
            var data_uri_prefix = 'data:' + response.headers['content-type'] + ';base64,';
            var comment64 = new Buffer(body.toString(), 'binary').toString('base64');
        }else{
            var data_uri_prefix = 'data:audio/mpeg;base64,';
            var comment64 = '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0F3MKLkx7px46zif/n/VYF5ILEEWBqHofAsEQPwFBID4kYoaIBAuHBosaDUHhDGigf3E87FPQqRZ//NCxHYj89qkAZhAAE44GxI8PhFF/////zhU8PhVv////xWHFho5K0XIK4lZ0uR3K9NVZe8f13bssVz+7c1/yiD/Ih/ccpo0/fcde5dkiwiCpwhu465q5qXDwzBYiHDTp4H2bUKOJpg8//NAxEIk88qAAY9AATAaA0MggcLnURYuLihJY4R3WoS5nTgmnuDz3qbFExRJHmHiNSkOH8CMYk0vy9DExe9Oenag7F7PFy6Gnh4ZR4hYckCN/////1czH////4oKKwFLaeABPIftipz/80LECRWL1qgBgigAX/B4c9+JEKGf+cPh+IKXKW/2DwoKChw+HVLlR/78xwcUEBIRdjercv//dVJcTc4+Rt+bRS8v/99x61djiFBEWQXJqhn//////KJCofIq9WQJsvx/P////3///vf/80DEDhJrCswBwSgB///+/bOhHW2pOr5L1dEIQ7qd0vMQ8g4eggh0DgcAgcIQBwDMHA4HCIogRSISfa65JGU4mPzdYvm2H/9Vvzxkq98vyl//H/yL/8Gf+6uIjx73//5/kfP/evv+v//zQsQfFDKu0AAITLnzfx9f9u392gIR2u6ad5dRKeX2dKNdlaW5q0SoOIqZGHJYf5UTQcKxN/xt8WZXAptt6Xjkzgz1eLQ8z8616p///r3mNc4sPIWfsRXMcarsRQi2a7r3dHcvZ0XYkv/zQMQqE7py0AAwirgW16dHmlmVxdxpRosY5XEBEotKYzPceaJAUJgJox4bB1BT//VQwzpioUjWy2HJcsI39+KS7DpmPh8//9f98ZeLZ1YxheWaHIKwdMFBjoy1f3zPF/1/XNTCqt9S//NCxDYROgrIAMBQmZ///+xy3g0sWE2FRewl98s7gq+RIWesrHx3bp1yKR30gh5ArSENIxtP9fX//M+ULNDnDbDgU1hcmA6Fgb0DsjVLuIi+KuI/rel6soSH43p4Yj1va7////nKVdZU//NAxE0Ska7AAMiQlOMxUabTCjLNg5NAL6rOivLAXFuc7Dg6137fzf1/tv759amktI4DtE05DeZytJkUaTMSWQ+Mf/dHiBwoATYCIljzle29wRnP//qPs/1WFhrClhZiRpswIluH/Sj/80LEXRQ5frgA0cyUlENQ7ZylATLZudm///f//zO1A8xmOqiBLFWhSlOJqgcFFOdHpMd7sxRwI4PnEu/P+n/+fFxjin/UgTl1JTX5pvDDZgSexya00eIiI20QoZRTVt/LXSr////+XNH/80DEaBJZtrQAycqUgEKizie7B5aKzEc5RQrjXEyqZHMdikcaCiIscpVT//b/or2zpb/9dqzWVg897u2m4WSRqTQP4MI6K1DAIBBgaeAwIekJyJonvR////////msYFnY0ibsjrZDif/zQsR5FHLCtADASrgdVDHccPmm5Vh9nKljmNmrT//r/R6T5A9qpMb/Vcy6Do7GPVR+URAQxKoBvGgVEZOMQYEyVnn+d////7X/T8kAMXIMWjwPjjv+YNhYOiSJjAfCK85Bsg8ePf9EO//zQMSDFAq6qAFSOACc6HDVR083///8ajYbIppgPQycXdLD1cUPf/MN/64kgPQJQRTqR57ba1v/+1te52Y3//////UtStzZjVKXKUrIYz9DGM6lMYxjVKWUpZjf///8pZStMZ6GMoUB//NCxI0T8pqMAY04AGDATBgIxUNajwliUNKPeoO1TEFMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NAxJkTWr2UAcsQAFVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80DEpgAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQMT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NCxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NAxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80LE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80DE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQMT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NCxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NAxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80LE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80DE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQMT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NCxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NAxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80LE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80DE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQMT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NCxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NAxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80LE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80DE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVf/mjq4zuu/+xFAUrN6j/8/MEsNMC+4F2BpQGoHTUwAbA+Mcz/C2A3RS6f/YZ8TmtMc/+gtNPiDBPY7gwWKYHKEJ//pqZhZZ8P/zQsT/AAADSAAAAADChBxzB9jJCfBl//+//ldSRQIggOWRMroKIgn//9vt/rRMGNS+Rcny6LjEfnifFJiCaX//////5Ppm5FxiL4jQXJR0agdoABJt2SOwDg2YVJQsniqOChFtecx53v/zQMT/AAADSAFAAAAy5cPgmkpEQKTayERQfS+S391d9TdJEwbK7q3tp0ooW1sLPXp5uTgQ4I67c3D2CcA4Jo2DZD+HyoyXxqPXPsLVlx0GryQRSHHs//3//sr//v80qoW65////4v6//NCxP8hK9IYAZqYAX3///GbKrM///tysnYW//R/4yuqpSQAExcUjywdFgK1IKhwyKhDHoIgp82kDwOrX+Wd7lcG6w1QV0FrNEkFGHTRW58j3JhkmfNzYeM3TU9M+brNCTJI9EbBOhhS//NAxNYjQxp8AZxYAPjiL4jI5yOmVnSXJAeI9Cwe5WkYjDojFKY9CaSJLmCx9KCaSJsylGhsmlRdKkqr////////rT1ppqUowW6DLdZ8zN3OqH1nu/WtSMV/5rMxqeBIXJH0MCMDYCP/80LEpCUrDnwB3GgBUGbnEE7msORIYfn04ciENTJBjwlOQhQIYhCnUafNNVw7tbPt5hfOsfBwG+ow4xD2fakFvH+dZpsRoIYWwljt5AZGo4E4hLTGORoyxMFojhCa0UYNiYBA2Jg8KMP/80DEaySjRpAA2869BOimDlEU90Zvv///t1///X/6tv7zD1cqTPMaTd2cy9GSYphN84BBhbEutEsIUAsmrsoAqkHLRIEnuCiagERh1yIoupUnGgsssZWx2FVrlCWdTsDMhiplNwfBeP/zQsQzH2MKrADTzrhFqdJFebpiH+fphM0ZPSqZrjF6xg6z3a3JebJWrASqJhHIMWLsYqq9R040sQRUavZv31//////////q8xX7KeYr5hhBX4gWKVRwDXG9VJKCZ63KZKC9mssqZ6R0P/zQMQRF4sKuADKxLjJZqAFm45ibcYRawex1HpK3OkP5ek4lFbF6J7zqhq1sKt5OO2LOyWebpnuda3KqmMiA7kDtUI+z1/////////////13VpznUjCpmhjNKrDkwFoQsKnJhHAatNz//NCxA0VKWa0ANMGlHrMKTA0WtQh8e20p90I5qZbHW8mA8uyuJL02JT3ydPTPz2/UuPJBqql6rPb7/G9hTTv/////9ynrrOtkkFiBtg8mLtF2DRUbZy6+AXji8EdZ8BJABKS+1pmIJbO//NAxBQYM2KkANwKvGfkqpafqA5Ck2EkL6YzobUw+QTA7SSmOpJInui93/v/6Cmpvt//+mkv+l////////1t7uR7nZFVrFRuXmKNFSlAURFSkQzs1z3cposRhMBMlNnIBR2FJIHNXET/80LEDhfLKpwA00S9WchvwKQHg0w8DDotmfMR6E8JsC2jyEvC3ANosLpUJ86BkXlvZnZTd/1fq/RUr////1zMzPn////////tdGc0qJMpTPZC/bL1LoUpBWIsGWG1KpYo8MizZRwiCu3/80DEChGYiogBWjAARQMyKh6SMLTNjWUqtauUspsWpTEWcyhwViA6gYBJCI7pPHv////EQFLHjv///8rVFvw1CoxRIaIwzDrtVRuiyEARrs0yUsJJ4DcXCW02jwOty6WIokiFgTxMzf/zQsQeGCGygAGPaACH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bBPYwYQAYwxMVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsR3AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQMTTAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NCxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NAxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80LE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80DE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQMT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NCxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NAxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80LE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80DE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQMT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NCxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NAxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80LE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80DE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQMT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NCxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NAxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80LE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80DE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVTlL8W0hQxRfCoDfEAGYM8dA4y2Hekk6qgJAwBMAgKw4EpS1aPE/8SysOHjhw8w9HhWarR0n/+boyI0eUyMyMj/////MjIyf7P/zQsT/AAADSAAAAACsRkMOMLR0sYjR5YqsRkaORH/kZEZOlisyjjOCYqCxkBgmGP+sVDhoyAxVCgAQCcShfzLbkMeoeqG9X2YJnNDCCA4GL6BgAAIJ2AAAQfxE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qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NCxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NAxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80LE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80DE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQsT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQMT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NCxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NAxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80LE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80DE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQsT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQMT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NCxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NAxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80LE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80DE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQsT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQMT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NAxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80LE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80DE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQsT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQMT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NCxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NAxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80LE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80DE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQsT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQMT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NCxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NAxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80LE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80DE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQsT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQMT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NCxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NAxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80LE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80DE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQsT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQMT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NCxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NAxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80LE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80DE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQsT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQMT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NCxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NAxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80LE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80DE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQsT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQMT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NCxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NAxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80LE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80DE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQsT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQMT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NCxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NAxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80LE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80DE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQsT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQMT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
        }
	}
	catch(e){ // ...by adding empty sound to base64 string
		var data_uri_prefix = 'data:audio/mpeg;base64,';
            var comment64 = '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0F3MKLkx7px46zif/n/VYF5ILEEWBqHofAsEQPwFBID4kYoaIBAuHBosaDUHhDGigf3E87FPQqRZ//NCxHYj89qkAZhAAE44GxI8PhFF/////zhU8PhVv////xWHFho5K0XIK4lZ0uR3K9NVZe8f13bssVz+7c1/yiD/Ih/ccpo0/fcde5dkiwiCpwhu465q5qXDwzBYiHDTp4H2bUKOJpg8//NAxEIk88qAAY9AATAaA0MggcLnURYuLihJY4R3WoS5nTgmnuDz3qbFExRJHmHiNSkOH8CMYk0vy9DExe9Oenag7F7PFy6Gnh4ZR4hYckCN/////1czH////4oKKwFLaeABPIftipz/80LECRWL1qgBgigAX/B4c9+JEKGf+cPh+IKXKW/2DwoKChw+HVLlR/78xwcUEBIRdjercv//dVJcTc4+Rt+bRS8v/99x61djiFBEWQXJqhn//////KJCofIq9WQJsvx/P////3///vf/80DEDhJrCswBwSgB///+/bOhHW2pOr5L1dEIQ7qd0vMQ8g4eggh0DgcAgcIQBwDMHA4HCIogRSISfa65JGU4mPzdYvm2H/9Vvzxkq98vyl//H/yL/8Gf+6uIjx73//5/kfP/evv+v//zQsQfFDKu0AAITLnzfx9f9u392gIR2u6ad5dRKeX2dKNdlaW5q0SoOIqZGHJYf5UTQcKxN/xt8WZXAptt6Xjkzgz1eLQ8z8616p///r3mNc4sPIWfsRXMcarsRQi2a7r3dHcvZ0XYkv/zQMQqE7py0AAwirgW16dHmlmVxdxpRosY5XEBEotKYzPceaJAUJgJox4bB1BT//VQwzpioUjWy2HJcsI39+KS7DpmPh8//9f98ZeLZ1YxheWaHIKwdMFBjoy1f3zPF/1/XNTCqt9S//NCxDYROgrIAMBQmZ///+xy3g0sWE2FRewl98s7gq+RIWesrHx3bp1yKR30gh5ArSENIxtP9fX//M+ULNDnDbDgU1hcmA6Fgb0DsjVLuIi+KuI/rel6soSH43p4Yj1va7////nKVdZU//NAxE0Ska7AAMiQlOMxUabTCjLNg5NAL6rOivLAXFuc7Dg6137fzf1/tv759amktI4DtE05DeZytJkUaTMSWQ+Mf/dHiBwoATYCIljzle29wRnP//qPs/1WFhrClhZiRpswIluH/Sj/80LEXRQ5frgA0cyUlENQ7ZylATLZudm///f//zO1A8xmOqiBLFWhSlOJqgcFFOdHpMd7sxRwI4PnEu/P+n/+fFxjin/UgTl1JTX5pvDDZgSexya00eIiI20QoZRTVt/LXSr////+XNH/80DEaBJZtrQAycqUgEKizie7B5aKzEc5RQrjXEyqZHMdikcaCiIscpVT//b/or2zpb/9dqzWVg897u2m4WSRqTQP4MI6K1DAIBBgaeAwIekJyJonvR////////msYFnY0ibsjrZDif/zQsR5FHLCtADASrgdVDHccPmm5Vh9nKljmNmrT//r/R6T5A9qpMb/Vcy6Do7GPVR+URAQxKoBvGgVEZOMQYEyVnn+d////7X/T8kAMXIMWjwPjjv+YNhYOiSJjAfCK85Bsg8ePf9EO//zQMSDFAq6qAFSOACc6HDVR083///8ajYbIppgPQycXdLD1cUPf/MN/64kgPQJQRTqR57ba1v/+1te52Y3//////UtStzZjVKXKUrIYz9DGM6lMYxjVKWUpZjf///8pZStMZ6GMoUB//NCxI0T8pqMAY04AGDATBgIxUNajwliUNKPeoO1TEFMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NAxJkTWr2UAcsQAFVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80DEpgAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQMT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NCxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NAxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80LE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80DE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQMT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NCxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NAxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80LE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80DE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQMT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NCxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NAxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80LE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80DE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQMT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NCxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NAxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80LE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80DE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVf/mjq4zuu/+xFAUrN6j/8/MEsNMC+4F2BpQGoHTUwAbA+Mcz/C2A3RS6f/YZ8TmtMc/+gtNPiDBPY7gwWKYHKEJ//pqZhZZ8P/zQsT/AAADSAAAAADChBxzB9jJCfBl//+//ldSRQIggOWRMroKIgn//9vt/rRMGNS+Rcny6LjEfnifFJiCaX//////5Ppm5FxiL4jQXJR0agdoABJt2SOwDg2YVJQsniqOChFtecx53v/zQMT/AAADSAFAAAAy5cPgmkpEQKTayERQfS+S391d9TdJEwbK7q3tp0ooW1sLPXp5uTgQ4I67c3D2CcA4Jo2DZD+HyoyXxqPXPsLVlx0GryQRSHHs//3//sr//v80qoW65////4v6//NCxP8hK9IYAZqYAX3///GbKrM///tysnYW//R/4yuqpSQAExcUjywdFgK1IKhwyKhDHoIgp82kDwOrX+Wd7lcG6w1QV0FrNEkFGHTRW58j3JhkmfNzYeM3TU9M+brNCTJI9EbBOhhS//NAxNYjQxp8AZxYAPjiL4jI5yOmVnSXJAeI9Cwe5WkYjDojFKY9CaSJLmCx9KCaSJsylGhsmlRdKkqr////////rT1ppqUowW6DLdZ8zN3OqH1nu/WtSMV/5rMxqeBIXJH0MCMDYCP/80LEpCUrDnwB3GgBUGbnEE7msORIYfn04ciENTJBjwlOQhQIYhCnUafNNVw7tbPt5hfOsfBwG+ow4xD2fakFvH+dZpsRoIYWwljt5AZGo4E4hLTGORoyxMFojhCa0UYNiYBA2Jg8KMP/80DEaySjRpAA2869BOimDlEU90Zvv///t1///X/6tv7zD1cqTPMaTd2cy9GSYphN84BBhbEutEsIUAsmrsoAqkHLRIEnuCiagERh1yIoupUnGgsssZWx2FVrlCWdTsDMhiplNwfBeP/zQsQzH2MKrADTzrhFqdJFebpiH+fphM0ZPSqZrjF6xg6z3a3JebJWrASqJhHIMWLsYqq9R040sQRUavZv31//////////q8xX7KeYr5hhBX4gWKVRwDXG9VJKCZ63KZKC9mssqZ6R0P/zQMQRF4sKuADKxLjJZqAFm45ibcYRawex1HpK3OkP5ek4lFbF6J7zqhq1sKt5OO2LOyWebpnuda3KqmMiA7kDtUI+z1/////////////13VpznUjCpmhjNKrDkwFoQsKnJhHAatNz//NCxA0VKWa0ANMGlHrMKTA0WtQh8e20p90I5qZbHW8mA8uyuJL02JT3ydPTPz2/UuPJBqql6rPb7/G9hTTv/////9ynrrOtkkFiBtg8mLtF2DRUbZy6+AXji8EdZ8BJABKS+1pmIJbO//NAxBQYM2KkANwKvGfkqpafqA5Ck2EkL6YzobUw+QTA7SSmOpJInui93/v/6Cmpvt//+mkv+l////////1t7uR7nZFVrFRuXmKNFSlAURFSkQzs1z3cposRhMBMlNnIBR2FJIHNXET/80LEDhfLKpwA00S9WchvwKQHg0w8DDotmfMR6E8JsC2jyEvC3ANosLpUJ86BkXlvZnZTd/1fq/RUr////1zMzPn////////tdGc0qJMpTPZC/bL1LoUpBWIsGWG1KpYo8MizZRwiCu3/80DEChGYiogBWjAARQMyKh6SMLTNjWUqtauUspsWpTEWcyhwViA6gYBJCI7pPHv////EQFLHjv///8rVFvw1CoxRIaIwzDrtVRuiyEARrs0yUsJJ4DcXCW02jwOty6WIokiFgTxMzf/zQsQeGCGygAGPaACHIsdyBsMAMCUx4IWH1qxNgHQG4A67ezYLeMGPBZv/q+XC4aF8vn0P9//oFxA3B85/+UcCAXFWgD//93G53//+TMGlke0MT2HDMCAHBOHQDYeGJPWj/7/vfQRF2f/zQMQZGDjyvAGMwACZ/lduCARSxkTxvlYqQ0n3GLM4FySyYnaVqrltM3+ff1vWP4Xj/So2CqigcTcXhB+LpKKMmP0r9RMTtN///+QVuf/ySG/zhdCloLYXSZRrSUEbm0Yt/GYclNJn//NCxBMTwSK8AdhAAM5z///x7zUWVTftrWK0HINgyDUFIlGnEKpkXfOn36RuexCdbs2tQNUagew9eAw6QZQWb/////UH0RW7kd8zXKLeGu0i+iCQLI5NkAkcjOXXjL/HfvXk43VRYziI//NAxCAS8TK8ANIKcAhZg825+J8YKvKCMhREXIJ/3wqKiRolteg4oOQO////++TlFBBx5AZitNJixyxbEcLL3Z0BizBre7dxt88g2CFvj8GRspMh6qGPDAYyziOGazHkDHNMYQjCXaf/80LELxMRrrwAyISUJ66ez5WVkAmeGc+CjRKULBYIHk////+iu4k8Npoq/vJ40nG2vStEA5woZrY2J95hXmF9RJso7ycyNncRAUEOf6ejkqVCJQWLaIOLP+32l6kd3cSdnX3I9KsDCHP/80DEPhMZ+rwAyUSYgr///6IzeXFwIUJnDSU1scp3gNGgWgp6cVAPRV7t45UD1DG4R9A/ML9vEaiA5KGbro/Ur2la7A4fEnCQANqjXRalSqorpRnMpRdZiHqouRlECYmaGv//9lq/pv/zQsRMFHHytADIiphQF3APvkWxnpuoJvHwZ7B6TFuWNLbmOBj78oG3WKzHeane6GCdERgXGMrG/5n5HehVQ4CIFICFlQjf9vdL0AnM5UvBOWUtDOCRHUA///6a/7iwUJKWzwwfcKRHi//zQMRWE7oSsADJxJitQ1ditZgVEnVBwihD+uXv9HexBzmQZaNPeCZfa/R1YOUGC4Qhckft/h/+XD8Dm4gILfkHATTZCAx5zTWPtKanJh+kTppiJqJT6WR8M8u8RX3P3/8j8sYyOq0k//NCxGIS4T64AMDEcIplDyaZ5Fn/3gWshRTMirJ2pz+tW/f/uhrKye7Nbs/a7szrNQ2qrzfL8iKmqKl1oz0IoBfAqgT1ILnX/f/7/3Mu/+pVsCh0Id1QU4pvyJasIovM0Jio0YjWEMsK//NAxHITWz7IABjEvVux+5tU/Zdf6tt9Dfm67qqPQr6oVbqyqjtaj/+n61nezGMPLCPGwiqJ+b8H8ucb8bDQ7NGNlMY1GBH2InvDB+kd6OVbo6ulDo09/e36En9r+RnSdCE59Xc4cJf/80LEfxL7NsQAEMS9QkWeLQjoRiKzqTTb/9yIQp5z0mRxiIEI4enkJJS5CHDn57khUEYQaeECXJHxYsQhm7yZIfwvd47v3RDQynpDKMp3/7Vo6Hs/3p7ZUVk+f7e7V6qxjUVKvo+hm/3/80DEjxNDYsQACES8//+xE6s7Wo7GDCpw7Rno5lRDI5UesNQAgeCAcUJQsQGKtPGh+lF3YsRTlFn/Nyrl43/nw+FVpBhU1z1ISXAxyeo0Hh15VILPaDXX3rix5voqKy3lg1f//+StXf/zQMSdEzNe1AAQxLzWWNK4KGJSApq12NRJHYyzYNorLzUAIjUY9zpIA/Luvxn3hpRlr84vv/49v//3+3Vm4KtiHGd9FU91MhGOYOwIOPGPZp/uX/////+l1lvCq+A7t77OWoWXkEty//NCxKsT6WLQAGJGlK+nlQwCEoTmdNKlZSggvW7tWreeFQR1Me91TWP//y1z//7//r//uhn/fD0OzAIMTuXhcRu4lpmY5GIHOdaLoHAaLMFh1ayl/bO+UbOt8+JCPVEscbzyCEQGtnfq//NAxLcS8ZLEAMvElDApbMGvEnjzCI2C6xhtPa/UvkksSkBoNTKMWMIn3DDDCvIef//W7//5wpecHFayAm5InnZxqAyj6KaC3KaCFE6bDxSQWZMHOMnXWal37Hm2MDUwe0qj4Iur53H/80LExhZxprwAxkyUrq2x9P+eQ5TobWuu9dBx6NsUeAkQLpJWf2gIaYajV7fBYE8F8xTbeUH+wIZEeaaIWq99Vr101kULtSJCkxaSYpApDnu2cvfDpXDuVJWeoyJ0o6FqU5YcOjD54VL/80DEyBtx+qgA1lqYq2ehMcckDkoTqeM9b6KQqiBpmpTupnCrS8peboiaVirhUEUUr/shZlV5YVMIyQVgUKajsH59y2VtzcjaGtrSrc1WHcM4ljhkRk21GFdh0v+HSyasuuxr9WGvfv/zQsS1GPF6rADT0pRf+/5NSbVGpGQoKasoJxIYFSLvsMUhJ5YkeFQCN4JoFQM4elZBumyXlQqaPIh0rMWj7lm9FmryxEQUIhI8WGRwCBjGFCkwZyZcpeMa+q7NcwonDCqsoCkeilbc///zQMStGzqqtADCRrj2vb6rb2AdRwgFYxTPXcQLvZdVVtBxVz3rkui8grWccZmM2A6mktd+7ZpCj997L9NH1e8TQWDou9almSrmErmdSw1StSIoJRh0DFaAaFTpGIhc6DIiHuetC3Gs//NCxJsUuYaAAHlGlBqUm3n8xxkIeFWeMKDK9cIVyxRFMfmmlT02Fj1/XO++47jqHUxaCUdAw9Pn3W2XMZuse16tY8Vdz1dbeV723DlRsJh4pHlJNJe4b8dRdRVtXOONGGhiT1Txq6jx//NAxKQRMD5sAVgQAJEU0MyprO92e7ZuU6mXSWJITSu9BtWy2NNWsUcfBMND7F6dTLdW//////1jeHmn/////Kjekkc/FIOgkgmnix46fFrxmmkCONJlOqIscITtJlNcDzHIPekv1nT/80LEuiVD2lgBj1gAkhyEZHa9B4/BcA8DiCqKd6mRf6hQJYOYGoTIEgA8EF1qRUv/ymOQWhLqLpupFvWySVFf/+fLh4yJQsMhyFA4PA0OeeUtK29P//tJQZBkOQJQpkoMA5oSBqS58uP/80DEgSO72nQBj2gAKdv//7f//y4iUxblAc6OTrxunFQqTTO02zsg9tusHWp3rv1g2gCg0lCz0A4IRH0G3WLiQcIqqVFToxYiiQ3kolPkseHp4uaAgIINYa5FhZ3tBHDgPIE8mtU/h//zQsRNI+N6wAGZQAArENHWvU3vukq0q1Ca6qI74/4aYfnSK/+KogXJEg6Ypz4uXmMDQ+r5SlNwmO41qr/n4nJD8UIFyP////ypJPM/icG6ys7qtJIIwGEmFDzsv6r0Wi7rupjLv/qxf//zQMQZGFlWxAHZMAD//N/////j5+2a/7+pRkvSJyWG3h1MUgidWEA1oyYIQ06KvFy4qomsYQHgAgaHkHjxYwD4WcMP6Wf//xWgKwCEhcAgsJixYnMVpN5VXaJsB6aK27j+mLYtbnHE//NCxBIYOb68AMnSlAD07igk+pQ7p9Pp/wj/4JIWYwQOVynIyyrOTXNEJlhcNjgCkPSVkiS9RqW+9+1DJTnvxLQgcLE2AAEBrnigKr///9DdrxUfeVMgMPEVsDbn/Zes+4X9LLMAmNIP//NAxA0UocLEAMCMlEvZ3YGOnTqdfT/2Np6/8U+RHArPQPKk2AjGgpV8WWiMZ/UPr39aWj2xhiF0BlJNFlcaIwZaWKtQdPhcyn///dRgbcjTXrr/qcQ5o41ZW+iEsO7E5W/77gHE4ND/80LEFRRZrtAAwhCUPz1yBSkyDISv5RESRd5hxcXF2SkMiLIGj7CouewkFbShcPHRh5vdLPVdfx9V1vtJL42mUeSKICX////9Nfu6HnTEUCJZCEqlVE9bC/HUAkC5lqqmiFdt1eKcNED/80DEHxRJoswBT0AAySdTSxxxgCIKA/EjsSaMFnrspth6itCCebLmyyFEpfdzHd8f///8/dEsusqZQsSnZ4iqYRd1wtx4SOFEpWFkSAEAIcyDySg7wfCtDUbRoTQzZ9QuAV8bZNFcLf/zQsQoF5nevAGPgABI55EhzBmzEnyuQI2MUSINUaLam3WhbLIzZgXlqUsqo+gmbm/X2kweNf0kv7bsi8zPsH/Ot7k1+oMY/Iy8f/PZLkCZBwBUjTA+AgicpZDDsPA64rcSw6ChQwBYEP/zQMQlE3EayAHPeAAoyJVqtvubWt43THxn11r51nXx/921K41ZjY4dr3oPaoNFTv6I48eJJec+UjN1J1oJVVOZ3HmE0gwQHQgqpqYpg6aIjiw1J0SW4rtSFWuGQEmo+tNbkFiIqNBT//NCxDITOSK4AMYKcMpY5rG//yeMFhFhUOjD1VmuackAencWW0wSKv3WlaMouOkgvx4KLdjOGACt7K9lnpmGzfeCyiK0OWrLhFuWT/gFgdvjw3fUx8309G5QhEthCs/9wPpOh4kHxy36//NAxEERGQa8AMYOcAusbTXDf2kEhNn2rKxiREqh7kv0e73CkBp8SB0E1mkNwel+H3UwbmcbBvr0LTHbxfoJnPOBtBA/U3v1bjepxZ6DVSUeoJylQbJFKnf////pOKE1L4mV/V2OEFj/80LEVxRRpsAAysqUodL8pOXmd6f+/Axcehz3XwgdlkdfTYpiC59eSkZlppQJx7UTdXtTSUqmnUoIRV5rV9Otc4YyQeNm2Bcu9hEo8Ylb706gxnyfR//+76HRACAz6kVf1+2v8xVrD4H/80DEYRRxosQAwsSUBYQW3sS1ej/+r3jXs9GT7E35zKsYs6NUaPISSLigDiTHOLpHC7C6o3oQXOLwTDDTRQyHgs2uFlGT+v6IIBAvl/F/J/8v/+3ogvy+X//8dT1E1f//Xxz71dQkav/zQsRqE8JO4AApSrhLRdJSUxgyNRwp1ALy0KYeZdDTKGHjBw2TbYgfLMiKnjBpQ4oaTOnSwRRM/6BS61SxVcv/////6/9P/t//sp6Xb8632PVJ3kTVOS7Gs6nMXdhqOA8HgmciKXHyQ//zQMR3EyKS5AAIULhyDG1HGspVB048XM6jxAs09GdTT7OXSUABoKfQXadC8MU4jS4jEDwtF/xaab5eXq6mLulzZMsSo/l8uifJji6T/JUxUmwXUupOvV/omKzwww8kwpAntd6JdUr///NCxIUTMrLkAUE4AIdgsw5wggAJh3gBFABGChBYjBhtAspIrOF5BAxdyRMk+p0U161UAmIBagkwXYIsF7FmGQOIuoDhJw5gIKio2dFkUa9KupaP/8HUOM0JIyHf//1JLrMf6BcXx/TN//NAxJQjw4aoAYdoAKbkBn04qI8Y23t3mP+H1/FVM37P+a7bfs+o/bX/M2ym/bLep/vprunveyKse0jBFiR5Rtnuf4496B1SKtxxBrXz3ETdvqf+Zn/k4VnyeOgdA+A7Hefkll47BsL/80LEYCSb2ogBj1gAYVmY8jeCxQCEkOkQBOH4VAkpgko9vzxs2olrYk1Nzd5Z/////5JcL1CIG3////8OncbK33AlaHAGGuaYzh7DWpeLEEPiIlDDxyzkGZQSgoHtYvaOOFhokqUZ3e//80DEKR061tABj0AACUWKFjg+euLSnZDwePGEg2oG37ByvFf/4uS27bi0r//pXFX1/vcTE9zrPHVd/P/3+nvdO9u+PbhcqUF3RsWPqPbcoGD7v4dYFf5YBccI0VSQ27sRcRCKIzRIYv/zQsQPF1HOyAHYQADgtMUqFDJI2plc/ct0c7rYhh9jQ793acsq3F0UUEQRxFEAKCOodj1o+PSzbF4lWRRYsfBxb0qUyJ//////1vLUXJxEVQKoBBJr/////rrV5vRKZ1M6hUNJOYI59//zQMQNF4oKyADGDJhygiPLn1j6ACxlm0Ci1Twu1vGfy+Zr/ugw/dT/yp+7ms88ZVbxyq3lH9nQmtGEYIjwFagsKeEEW2JbY///+/5n8Z9P25vXx5j1netdkcu8uwoq1ugbQTkeYuRD//NCxAkVigrIAHtOmCBYTFb/BAFOoB3mqyYJrTQGVZIhc/uey+eSQGpmjDMpRY9QxoMMhwzQTC85hC5qGi+ce2P9en6dOVLmoOE1lHqO8i6IT2+tV3////111eZYoJ08cq5KWW9zVM5Z//NAxA4S+ULIAMPQcGoeVu3kun6kOqPqFnXeb+MvQVrxFlxAJmQfBHYb3LNp/LRmHHDRtGQHhx7gyAxq1f3y4kBpJ+PGMKBrQ3bQ/6gM7JeQWvht+PrDt7KIS63UvT3NR7e84zcjOeX/80LEHROZTsABWEAAYgp6cVNYcVMhyAqgwWukj7ufh/vJJOlZVThyUSgIf/ZoDaJlKeHWoQ5VAsUs//R+k3UewdECCai287/DdrYnrT//3/o1aquuvdqp0VndeVuff++mlvO0X+67THT/80DEKhq72tgBi1AAZKHFBYIhfPZzDjRbYmIgLxu8zRmS9lZDENLjdDSBpMceXIkIyYfCIJBNHHHo/LsqsQO///9XOH5Of//yA8gOLEJf///////////q9KfkZk9f/l7/9st3ZqLIRf/zQsQaEltm2AHBKAAeBw+LAKCCYuOFxqqoixVGTCiBwTFZ3c5ZRIWRjIlWKcuy/7mR0VSGbc6OZzEQWLUv//////////8v//r4W9tO5+vr/fXm/ap+Fv3YbApdj6hJQ7QgRDQiDwUFRv/zQMQsEuKi3AAIULgWiClHocIAeUwocNESZD8RYD+2IMnzhQ9WL/lA/imylTf//////////6/o7G00Ux9k13NOspv7ddtVNmnFCxwjDcaHCUC0sjlB0eCYbERsUHRJKgYpUmLR4Qi0//NCxDsUUq7UAUE4AITh4udB8SjXHiRUcJRR/+l5o6bCrErVm55OKtCq3dOPzFZN6UzoXJS2ku5KKCuBa9x7kgXAixCIr7H0jUlx7F4+SX5oPc4aDiLRPhgie/rn1Hk2QTHcbLLxsmZf//NAxEUd4mqoAY9oAPVfTXTNl1KzJu9tJRxAcSbpp09NO6ajJEvPUrVlImoHUN8m9l24GmAyWO5X/ykIf7TpVZFDiiRkSwb9AGyIRjwYYgJAIYccv+XHR/i2Ltv/F+Z6qfKpJIYwmHL/80LEKBRIupQB2xgA2kK2u77gyeZZSTrKL1NQkAvjXf+tsTgZ792pgDD/SETh0Rr///3VmcYqhqbf0QbDaCwgSmUYFQHdUvo0MlSse61AJ+hTus09u3q6HSSlv/8Sze+K4vbPxXeNXvv/80DEMhQx4qgA08SZ9PpG0fdN01XXb///+11c453USYRBGAM747x3293L8ufslk2GWUkkUpq0cMI+O/QD4aZC8CBYhXCJE2tP99t+/3bm1TP7MiXFMAChiJVvxXx/82n7zc3I+bsxE//zQsQ8E9HKyADDEJXT///R7l3iu37lyBxdVlVz7W+26tWqCGDLxRiB7zdeNONWQ195oVevQo3+d03uzDH3qFbGGy2LUVE1QsNcoL2oujqiGrQ9Vs9SJIu48xlH0ZrtoVMnkPg3iWs76P/zQMRIE4Ge0AB7zpVqWVi1vftrDHA/z6BHi6QZyZX/VM99qxVU5ZmtvXc8ahhZ3UI3ceB2xTq+IUJA0dUSPvcx/Gfmw9hwMSFE95A5xzxz7EJIkpg4Ur57r959yWWq18HuF1fEpOYn//NCxFUS4U7QAJPQcdA6/8lY/rheA+f4QQcMP0gQZoBXlgpIgg4Sfbqu23P9x9ymz1/58QlqBC1WnSxOHTh+felxdymiQWSKo8ivLxfUUQVBpiVGrqSKc17lEo9yKUecfLw/3mNE6iYs//NAxGUSQUbYAHsMcGiKR0JQ4HHKG3RxkeV/RyVFo7lPviDaDjxERBUruTWuPbE7Khm9EeLur/zfyEcr9HepStf0CbSl9mcXimWsjc1tKgTZV8WjLaJy3FNYH5myXprxzXWTqO9hJpn/80LEdxOhUtQAi9BxW2XVUTFXcREgcqGEhtCs61atH5u47Q7NUSIysPfh9rY66y45LKVq1lSKJnJZa2Q1kBS6Yy+tJdjNmmhprMC3aRrUDY5YiIFagtxEOlKgeFjGTMcuVWM9SqWVFLX/80DEhBOR1tAAewqVFUiIdKUgeMYv/+yPKhnqVIiHUDwkHnJBYL435QCk2XTRAC20XsipDEC0EjyTCiUZ5axNDc+4lPk5qIqU5SGsPj2ZjTRi9EmGhSgWGCb3mSbEtU93NMqr5rZM1f/zQsSQFEHSsAFYKAHUrw1RlWxRS3mzNjVUT7qYkiTB8KgDA9h7IE2l1118T77Pba+6nysjk4EN4vJ5eJx3mg9m3/fz262zSX/9br+P3k+VD55pv6+EXwfHf0BRH+LkVbdSGF10z9e2iP/zQMSbJHsKeAGYWACSKpnYDqQ4W6ZGmKvmpzNTNjN5xn1xf+1FGzl4l31KGVNcbK093C65kmlkkM0lPUOaz9yIpnvtWZnZbVnL+fMca/e1LH7yh7KflOeuzOVreOeeGNmJ1cr12kp8//NAxGQh4dKoAZjAAKtvLDPVy/O1LtL++Zb5WCQUIpCCHMXWdbpv/////9xRn9AshecfQAIJkrfQCF4G9hLE5dWvNzi+fv5SV60spZ+MUAwkRz1Pc49REKsDFYPAcLPJP2mLv/fvuWL/80LENxO5qrQB2EAA2m+6bi6njqr4/b/5u+I7HI5Jw+hYWvggvajpP9LGREAgFe5SLZWq5NEzUsk0Hyvy8OkBZUbmqwrpHrLcudk6jxeGReaJSGsv0c328zbOIc6CZxoYjCLLc9G6L/3/80DERBcx9qwAwwqYPeylIVY0pTGQzvoxSsZxrX//////9SUwZrsFPKfDaVLXk0g5KnnoGrZ3JMyPDlLkjm+ZRHWaC2WYh8NnSzJDydrOnXSdozTqJ9DmiPByJA5RuTZzjQ7FEQJDKf/zQsRCGDGmoADL0JR0uE5qv9fjuY6/7qqmLIcXFXETYuFLXkEf//9X//+mmABQDi0VgBjcxeu7rH+h+dZxxEIqkDJNE4wKx8fcSjGwpMlX4bLGnnlrLMWVGATDue1FMEdLKrd6f7S9///zQMQ9E3GiqABjBJRIIWuSSo2/////49D3/pmQTsrpPsazMPgsGvHV6+2rk4To0aFCmaGEIJMqjpij6BsER0iB8lwaBqpTihwSGYlSwVTZoZ4lczIf/1La8/jffZm81YU5JcRM8XWr//NCxEoTKaKUAHpGlP//VXBFMw+NgND8meVtWKpUO25TQ3tFE/Wi2EmVzFRhZWFOsrC2OXnboz6vZoUWDpFa5VGMKM7Sys5pZGVu/9PK39EAhRgaPBpyAn0f6wWzzxL/0LUmQBsKVlPM//NAxFkUYaZ8AGPElOW00TphqGS8BVKV4olMdSuXYmqGIVQ/nG2H16wVarVdHi70xOVbSPrMx6rYYVdmb9oxqXxmP19tS+f/GbpBhVdx7g3/s/QVd3/yqiShXx0+EEOgdC0OBLLCCWT/80LEYhRZokwAe8aUnEkvFI7WPhhwBBgMDAgMw8yyiyzE1JScWUUfBoGQqLCQ0DIoLEjQV/+AgkLkXfrZWKizcXZ//xYXFf6moeKi1UxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVX/80DEbBPYwYQAYwxMVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsR3AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQMTTAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NCxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NAxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80LE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80DE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQMT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NCxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NAxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80LE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80DE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQMT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NCxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NAxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80LE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80DE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjk4LjJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQMT/AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NCxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuOTguMlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NAxP8AAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80LE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy45OC4yVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80DE/wAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVTlL8W0hQxRfCoDfEAGYM8dA4y2Hekk6qgJAwBMAgKw4EpS1aPE/8SysOHjhw8w9HhWarR0n/+boyI0eUyMyMj/////MjIyf7P/zQsT/AAADSAAAAACsRkMOMLR0sYjR5YqsRkaORH/kZEZOlisyjjOCYqCxkBgmGP+sVDhoyAxVCgAQCcShfzLbkMeoeqG9X2YJnNDCCA4GL6BgAAIJ2AAAQfxE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qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NCxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NAxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80LE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80DE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQsT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQMT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NCxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NAxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80LE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80DE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQsT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQMT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NCxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NAxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80LE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80DE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQsT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQMT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NAxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80LE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80DE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQsT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQMT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NCxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NAxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80LE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80DE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQsT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQMT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NCxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NAxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80LE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80DE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQsT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQMT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NCxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NAxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80LE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80DE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQsT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQMT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NCxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NAxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80LE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80DE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQsT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQMT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NCxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NAxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80LE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80DE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQsT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQMT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NCxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NAxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80LE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80DE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQsT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQMT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NCxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuOTguMqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NAxP8AAANIAAAAAKqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80LE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy45OC4yqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/80DE/wAAA0gAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjk4LjKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQsT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/zQMT/AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
	}

	return data_uri_prefix + comment64;
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