'use strict';

/* Controllers */

function AppCtrl($scope, socket) {
  $scope.begun = false;

  // Socket listeners (broadcasts)
  // ================

  // notify other players that a player is about to connect
  socket.on('post:fetched', function (commentObj) {
    $scope.messages.push({ text : 'Soundbites retrieved by frontend - ' + commentObj.bodySoundbites.length + ' in total' });

    console.log(commentObj);

    playSoundbite(0, commentObj.bodySoundbites);
  });

  socket.on('new:status', function(statusMsg){
    $scope.messages.push({ text : statusMsg });
  });

  // ---

  $scope.messages = [];
  $scope.comments = [];

  var playSoundbite = function(idx, soundBites){
    if (!soundBites[idx]) return;

    var soundBite = soundBites[idx];

    var snd = new Audio(soundBite);

    snd.addEventListener('play', function() { 
      $scope.messages.push({ text : 'Playing soundbite ' + (1+idx) + ' of ' + soundBites.length });
    }, true);    

    snd.addEventListener('ended', function() { 
      playSoundbite(1+idx, soundBites);
    }, true);   
    
    snd.play();
  };

  $scope.pushButton = function () {
    $scope.begun = true;
    // TODO: do nice countdown modal
  	
    socket.emit('app:begin'); // TODO: apply localStorage to prevent already shown messages to appear
  };
}