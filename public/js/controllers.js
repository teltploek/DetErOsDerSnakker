'use strict';

/* Controllers */

function AppCtrl($scope, socket) {
  $scope.begun = false;

  // Socket listeners (broadcasts)
  // ================

  // notify other players that a player is about to connect
  socket.on('post:fetched', function (comment) {
    console.log(comment.body);

    var snd = new Audio(comment.bodySoundbite);
    snd.play();
  });

  socket.on('message:incoming', function (comments) {
    $scope.comments = comments;

    console.log(comments);

    var snd = new Audio(comments[0].bodySoundbite);
    snd.play();
  });

  socket.on('new:status', function(statusMsg){
    $scope.messages.push({ text : statusMsg });
  });

  // ---

  $scope.messages = [];
  $scope.comments = [];

  $scope.pushButton = function () {
    $scope.begun = true;
    // TODO: do nice countdown modal
  	
    socket.emit('app:begin'); // TODO: apply localStorage to prevent already shown messages to appear
  };
}