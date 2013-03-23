'use strict';

/* Controllers */

function AppCtrl($scope, socket) {
  $scope.begun = false;

  $scope.articleData = {};

  $scope.commentsHtml = [];
  $scope.commentVisible = false;

  $scope.messages = [];
  $scope.comments = [];

  socket.on('post:fetched', function (allCommentsArr) {
    $scope.comments = allCommentsArr;

    $scope.messages.push({ text : 'All comments for article received by front-end - getting ready to play...' });

    initializeComment(0);
  });

  socket.on('new:status', function(statusMsg){
    $scope.messages.push({ text : statusMsg });
  });

  socket.on('article:found', function(articleData){
    console.log(articleData);

    setTimeout(function () {
        $scope.$apply(function () {
          $scope.articleData = articleData;
          });
    }, 1);
  });

  var initializeComment = function(commentIdx){
    var comments = $scope.comments;

    if (!comments[commentIdx]){
      $scope.begun = false;

      return;
    }

    setTimeout(function () {
        $scope.$apply(function () {
            $scope.commentsHtml.push(comments[commentIdx]);
        });
    }, 1);

    playSoundbite(commentIdx, 0);
  };

  var playSoundbite = function(commentIdx, biteIdx){
    var soundBites = $scope.comments[commentIdx].bodySoundbites;

    if (!soundBites[biteIdx]){
      initializeComment(1+commentIdx);
    }

    var soundBite = soundBites[biteIdx];

    var snd = new Audio(soundBite);

    snd.addEventListener('play', function() {
      $scope.messages.push({ text : 'Playing soundbite ' + (1+biteIdx) + ' of ' + soundBites.length });
    }, true);    

    snd.addEventListener('ended', function() { 
      playSoundbite(commentIdx, 1+biteIdx);
    }, true);   
    
    snd.play();
  };

  $scope.pushButton = function () {
    $scope.begun = true;
  	
    socket.emit('app:begin');
  };
}