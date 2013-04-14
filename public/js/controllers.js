'use strict';

/* Controllers */
function AppCtrl($scope, socket) {
  $scope.begun = false;

  $scope.articleData = {};
  $scope.numberOfComments = 0;

  $scope.progress = 0;
  $scope.progressText = '';

  $scope.commentsHtml = [];
  $scope.commentVisible = false;

  $scope.messages = [];
  $scope.comments = [];

  socket.on('post:fetched', function (allCommentsArr) {    
    $scope.comments = allCommentsArr;

    $scope.messages.push({ text : 'All comments for article received by front-end - getting ready to play...' });   

    setTimeout(function(){
      $('.progress-modal').modal('hide');
      initializeComment(0);
    }, 1000);
  });

  socket.on('new:status', function(statusMsg){
    $scope.messages.push({ text : statusMsg });
  });

  // this event will handle all progress indication to the client - including the conversion progress
  socket.on('progress:update', function(status){
    if ($scope.progress == 0){
      $('.progress-modal').modal('show');
    }

    var newProgress = ($scope.numberOfComments - status) / $scope.numberOfComments * 100,
        newProgressText = ($scope.numberOfComments - status) + ' / ' + $scope.numberOfComments;

    setTimeout(function () {
        $scope.$apply(function () {
          $scope.progress = newProgress;
          $scope.progressText = newProgressText;
        });

        if (status - $scope.numberOfComments == 0){
          $('.progress-modal .progress').removeClass('active');
        }
    }, 1);
  });

  // when article has been found, we can show the title
  socket.on('article:found', function(articleData){
    setTimeout(function () {
        $scope.$apply(function () {
          $scope.articleData = articleData;
          });
    }, 1);
  });

  // when comments has been found, we can show the number of comments
  socket.on('article:comments', function(comments){
    setTimeout(function () {
        $scope.$apply(function () {
          $scope.numberOfComments = comments;
          });
    }, 1);
  });

  var initializeComment = function(commentIdx){
    var comments = $scope.comments;

    if (!comments[commentIdx]){
      $scope.$apply(function () {
        $scope.begun = false;
      });

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

    snd.addEventListener('ended', function() { 
      playSoundbite(commentIdx, 1+biteIdx);
    }, true);   
    
    snd.play();
  };

  $scope.pushButton = function () {
    $scope.articleData = {};
    $scope.numberOfComments = 0;

    $scope.progress = 0;
    $scope.progressText = '';

    $scope.commentsHtml = [];
    $scope.commentVisible = false;

    $scope.messages = [];
    $scope.comments = [];

    $scope.begun = true;
  	
    socket.emit('app:begin');
  };
}