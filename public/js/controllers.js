'use strict';

/* Controllers */
function AppCtrl($scope, socket) {
  $scope.state = 'waiting';

  $scope.articleData = {};
  $scope.numberOfComments = 0;

  $scope.progress = 0;
  $scope.progressText = '';

  $scope.commentsHtml = [];
  $scope.commentVisible = false;

  $scope.messages = [];
  $scope.stateMessage = '';
  $scope.comments = [];

  socket.on('post:fetched', function (allCommentsArr) {    
    $scope.comments = allCommentsArr;

    $scope.messages.push({ text : 'Alle kommentarer til artiklen er færdigbehandlet - gør klar til højtlæsning...' });   

    setTimeout(function(){
      $scope.state = 'reading';

      $('.progress-wrapper').hide();

      initializeComment(0);
    }, 1000);
  });

  socket.on('new:status', function(statusMsg){
    $scope.stateMessage = statusMsg;

    $scope.messages.push({ text : statusMsg });
  });

  // this event will handle all progress indication to the client - including the conversion progress
  socket.on('progress:update', function(status){
    if ($scope.progress == 0){
      $('.progress-wrapper').show();
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
    var soundBites = $scope.comments[commentIdx].sound;

    if (!soundBites[biteIdx]){
      initializeComment(1+commentIdx);
    }

    var soundBite = soundBites[biteIdx];

    var snd = new buzz.sound(soundBite);

    snd.bind('ended', function(e) {
      playSoundbite(commentIdx, 1+biteIdx);
    });
    
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

    $scope.state = 'preparing';
  	
    socket.emit('app:begin');
  };
}