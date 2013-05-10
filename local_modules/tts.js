var request = require('request'),
	BufferList = require('bufferlist').BufferList;

// singleton to handle conversion queue and storing for this particular comment
var QueueHandler = (function(){
    function QueueHandler() {
    	this.queue = null;
    	this.commentObj = null;
    };

    QueueHandler.prototype.init = function(queue, commentObj){
    	this.queue = queue;
    	this.commentObj = commentObj;	
    };

    QueueHandler.prototype.setSoundbite = function(idx, sound){
    	this.commentObj.sound[idx] = sound;
    };

    QueueHandler.prototype.getQueue = function(){
    	return this.queue;
    };

    QueueHandler.prototype.subtract = function(){
    	this.queue = this.queue - 1;
    };

    var instance;

    return {
        getInstance: function(){
            if (instance == null) {
                instance = new QueueHandler();
                
                instance.constructor = null; // Hide the constructor so the returned objected can't be new'd...
            }
            return instance;
        }
   };
})();

// class to handle comment part processing
function CommentPartProcessor(idx){
	this.biteIdx 			= idx;
	this.QueueHandler 		= QueueHandler.getInstance();
};

CommentPartProcessor.prototype.conversionCallback = function(error, response, body){
	var comment64 = convertTTSResponseToBase64(response, body);

	this.QueueHandler.setSoundbite(this.biteIdx, comment64);

	this.QueueHandler.subtract();

	if (this.QueueHandler.getQueue() == 0){
        this.QueueHandler.subtract();
        process.send({ message: 'tts:done:' + this.QueueHandler.commentObj.id, commentObj : this.QueueHandler.commentObj });
    };
};


/**
 * Executing the actual Google TTS request
 *
 * @param {String} The Google TTS url with params to call
 * @param {Object} CommentPartProcessor
 */

googleTextToSpeech = function(url, cpp){
	request({ url : url, headers : { 'Referer' : '' }, encoding: 'binary' }, function(error, response, body){
		cpp.conversionCallback(error, response, body);
	});
};

/**
 * Transporting and keeping track of audio conversion
 *
 * @param {Object} The comment object in the form of the Article schema
 * @param {Array} The array holding Google TTS friendly comments
 */

convertCommentsToAudio = function(commentObj, googleFriendlyCommentArr){
	var me = this,
		length = googleFriendlyCommentArr.length,
	    i;

    QueueHandler.getInstance().init(length, commentObj);

	for (i = 0; i < length; ++i){
		var commentPart = googleFriendlyCommentArr[i];

		var cpp = new CommentPartProcessor(i);

		googleTextToSpeech('http://translate.google.com/translate_tts?ie=utf-8&tl=da&q='+ commentPart, cpp);
	}
};

/**
 * Converting audio data to base64 string, or die trying
 *
 * @param {Object} The response object from the request
 * @param {String} The body retrieved by a http request
 */

convertTTSResponseToBase64 = function(response, body){
	// try to handle response, or fail gracefully...
	try{
        // if we get html return from google we're being blocked because of unusual traffic...
        if (response.headers['content-type'] == 'text/html'){
            var data_uri_prefix = 'data:' + response.headers['content-type'] + ';base64,';
            var comment64 = new Buffer(body.toString(), 'binary').toString('base64');
        }else{
            var data_uri_prefix = 'data:audio/mpeg;base64,';
            var comment64 = '/+MYxAAAAANIAUAAAASEEB/jwOFM/0MM/90b/+RhST//w4NFwOjf///PZu////9lns5GFDv//l9GlUIEEIAAAgIg8Ir/JGq3/+MYxDsLIj5QMYcoAP0dv9HIjUcH//yYSg';    
        }
	}
	catch(e){ // ...by adding empty sound to base64 string
		var data_uri_prefix = 'data:audio/mpeg;base64,';
		var comment64 = '/+MYxAAAAANIAUAAAASEEB/jwOFM/0MM/90b/+RhST//w4NFwOjf///PZu////9lns5GFDv//l9GlUIEEIAAAgIg8Ir/JGq3/+MYxDsLIj5QMYcoAP0dv9HIjUcH//yYSg';
	}

	return data_uri_prefix + comment64;
};

process.on('message', function(o) {
  convertCommentsToAudio(o.commentObj, o.googleTTSFriendlyComment);
});