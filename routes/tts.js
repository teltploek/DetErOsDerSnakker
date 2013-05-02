var request = require('request'),
	BufferList = require('bufferlist').BufferList;

googleTextToSpeech = function(url, callback){
	request({ url : url, headers : { 'Referer' : '' }, encoding: 'binary' }, callback);
};

converCommentsToAudio = function(commentObj, googleFriendlyCommentArr){
	var me = this,
		length = googleFriendlyCommentArr.length,
	    conversionQueue = length,
	    i;

	for (i = 0; i < length; ++i){
	  var idx = i,
	      commentPart = googleFriendlyCommentArr[i];

	  googleTextToSpeech('http://translate.google.com/translate_tts?deods='+idx+'&ie=utf-8&tl=da&q='+ commentPart, function(error, response, body){
	    //if (error) return errorLogger.log('error', error);

	    var comment64 = convertTTSResponseToBase64(response, body);

	    // FIXME: Major hack to have soundbites arranged in correct order:
	    //        We're passing along the original index in the uri. When the call returns we parse out the uri query in the response to refetch our index
	    // 		  ... we need to rethink this - but right now, we want it working.
	    // "First do it, then do it right, then do it better" - quote: Addy Osmani
	    var soundBiteIdx = response.request.uri.query.split('&')[0].split('=')[1];

	    commentObj.sound[soundBiteIdx] = comment64;

	    conversionQueue = conversionQueue - 1;

	    if (conversionQueue == 0){
	      // me.events.emit('tts:done:' + commentObj.id, commentObj);
	      process.send({ message: 'tts:done:' + commentObj.id, commentObj : commentObj });
	    }
	  });
	}
};

convertTTSResponseToBase64 = function(response, body){
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

process.on('message', function(o) {
  converCommentsToAudio(o.commentObj, o.googleTTSFriendlyComment);
});