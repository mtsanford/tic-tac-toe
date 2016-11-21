(function() {

  var socket = null;
  var game = null;

  /**
   * Bind to user interface & jQuery Mobile events
   **/

  /**
   * #namepage - Name entry page
   **/
  
  $(document).on('pageshow', '#namepage', function() {
    console.log('#namepage pageshow');
    
    $('#nameinput').keyup(function(e) {
      console.log('keyup ' + e.keyCode);
      showGo();
      if (e.keyCode == 13) {
        if ($('#nameinput').val().length > 2) {
          document.activeElement.blur();
          $('#gobutton').trigger('click');
        }
      }
    });
    
    function showGo() {
      // TODO Is this really the correct way to disable buttons?  It seems to work, but odd
      // that we're only changing the css class
      if ($.trim($('#nameinput').val()).length > 2) {
        $('#gobutton').removeClass('ui-disabled');
      } else {
        $('#gobutton').addClass('ui-disabled');
      }
    }
    
    var name = localStorage.getItem('playerName');
    if (!name || name.length < 3) {
      $('#nameinput').focus();
      if (window.Keyboard) window.Keyboard.show();
    }
    $('#nameinput').val(name);
    showGo();
  }).on('click', '#gobutton', function() {
    document.activeElement.blur();
    localStorage.setItem('playerName', $.trim($('#nameinput').val()));
    $.mobile.changePage('#gameselect');
  });

  /*
   * #gameselect - Game selection page
   */

  $(document).on('pageshow', '#gameselect', function(e) {
    console.log('#gameselect pageshow');
    socket.emit('lookingforgame', { name : localStorage.getItem('playerName') });
  }).on('pagebeforeshow', '#gameselect', function(e) {
    console.log('#gameselect pagebeforeshow');
    $('#waitingplayers').html('');
  }).on('pagehide', '#gameselect', function(e) {
    console.log('#gameselect pagehide');
    
    // If the user has tried to start or join a game, but there
    // has not been a response yet.  Make sure we ignore the response.
    if (CWS.pending()) {
      socket.emit('leavegame', null);
      game = null;
      CWS.cancel();
    }
  });
   
  $(document).on('click', '#newgame', function(e) {
    CWS.call(socket, 'newgame', '', function(m) {
      if (m.error) {
        console.log('new game failed');
        return;
      }
      game = m.game;
      updateBoard();
      $.mobile.changePage('#gameboard');
    });
  }).on('click', '.playergame', function(e) {
    CWS.call(socket, 'joingame', { game: $(this).attr('data-game-id') }, function(m) {
      if (m.error) {
        console.log('join game failed');
        return;
      }
      game = m.game;
      updateBoard();
      $.mobile.changePage('#gameboard');
    });
  });

  /**
   * #gameboard - Game board page
   **/

  $(document).on('pageshow', '#gameboard', function(e) {
    console.log('#gameboard pageshow');
    updateBoard();
  }).on('pagehide', '#gameboard', function(e) {
    console.log('#gameboard pagehide');
    socket.emit('leavegame', null);
    CWS.cancel();
    game = null;
    updateBoard();
  }).on('click', '.cell', function(e) {
    var cell = parseInt($(this).attr('data-cell'));
    if (CWS.pending() || !game || (game.state != 1) || (game.turn != game.you) || (game.board.charAt(cell-1) != '-') ) return;
    CWS.call(socket, 'move', { position: cell }, function(m) {
      if (m.error) {
        console.log('move failed');
        return;
      }
      game = m.game;
      updateBoard();
    });
  });

  function updateBoard() {
    var noGame = (!game || !game.id);

    // Cells
    for (var i=0; i<9; i++) {
      $('[data-cell="' + (i+1) + '"]').html( (noGame || game.board.charAt(i) == '-') ? '&nbsp;' : game.board.charAt(i));
    }
      
    // Game Message
    var gameMessage;
    if (noGame) {
      gameMessage = 'no game';
    } else if (game.state == 0) {
      gameMessage = "waiting for another<br/>player to join...";
    } else if (game.state == 1) {
      gameMessage = game.you == game.turn ? 'Your turn' : game.players[game.turn] + '\'s turn';
    } else if (game.state == 2) {
      gameMessage = (game.turn == -1) ? 'Draw!' : (game.you == game.turn ? 'You won!' : game.players[game.turn] + ' won!');
    }
    $('#game-message').html(gameMessage);
      
    // Players
    $('#games-player-1').html((noGame || game.state == 0) ? '' : game.players[0] + '<br/>X');
    $('#games-player-2').html((noGame || game.state == 0) ? '' : game.players[1] + '<br/>O');
  }


  /**
   * Connect to server and bind to events
   **/

  // game server is at the same host, at port 8124
  socket = io.connect(window.location.host + ':8124');
  
  socket.on('connect', function() {
    console.log('connected');
  });

  socket.on('disconnect', function() {
    CWS.cancel();
    game = null;
    updateBoard();
  });
  
  socket.on('waitingplayers', function(games) {
    var html = '<p>There are no waiting players.</p>';
    if (games.length > 0) {
      html = '';
      for (var i in games) {
        html += '<div><a href="#" class="playergame" data-role="button" data-game-id="' + games[i].game + '" data-inline="true">' + games[i].name + '</a></div>';
      }
    }
    // Trigger 'create' event after injecting elements so that jQuery mobile can do it's magic
    $('#waitingplayers').html(html).trigger('create');
  });
    
  socket.on('gameupdate', function(newGame) {
    // if we've left the game, ignore any stray delayed updates
    if (game && game.id == newGame.id) {
      game = newGame;
      updateBoard();
    }
  });

  /**
   * CWS - Call With Spinner
   * For emits that require a response from the server before
   * any other action is allowed.
   * Put up a spinner if the response is taking too long
   * - Only allow one of these at a time.
   * - Canceling means the ack callback will not be called
   * TODO - need to number the requests, because they may
   * get responses at any time in the future
   */

  var CWS = (function() {
  
    var pendingRequest = false;

    return {
    
      call: function(socket, event, message, callback) {
        if (pendingRequest) return false;
        pendingRequest = true;
        setTimeout(function() {
          if (pendingRequest) {
            $.mobile.loading('show');
          }
        }, CWS.wait);
        socket.emit(event, message, function(e) {
          $.mobile.loading('hide');
          if (pendingRequest) callback(e);
          console.log('got response for ' + event + ' - ' + (pendingRequest ? '' : 'not') + ' doing callback'); 
          pendingRequest = false;
        });
        return true;
      },
      
      pending: function() {
        return pendingRequest;
      },
      
      cancel: function() {
        pendingRequest = false;
        $.mobile.loading('hide');
      },
      
      wait: 500
      
    };
    
  })();
  
  // For Android, the soft keyboard does not go away on an input
  // blur. Our phonegap android app provides a call to force it to 
  // go away.
  if (window.Keyboard) {
    HTMLElement.prototype.defaultblur = HTMLElement.prototype.blur; 
      HTMLElement.prototype.blur = function(){ 
      this.defaultblur(); 
      window.Keyboard.hide(); 
    }; 
  }
    
  
})();
