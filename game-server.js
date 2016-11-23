var sys = require('sys')
  , app = require('express')()
  , server = require('http').createServer(app)
  , io = require('socket.io').listen(server);

	
io.set('log level', 1);
	
/*
 *
 */

function Player(socket) {
	this.id = socket.id;
	this.name = 'anonymous';
	this.socket = socket;
	this.game = null;
	this.playerNum = -1;
}
	
function Game() {
	this.players = []; // [ socket_id (X), socket_id (0) ]
	this.state = Game.WAITING;
	this.id = 'game_' + Game.next_id++;
	this.board = '---------';
	this.turn = 0; // 0 = 'X', 1 = 'O'
}
Game.WAITING = 0;
Game.PLAYING = 1;
Game.OVER = 2;
Game.TERMINATED = 3;

Game.next_id = 1;

Game.prototype.maxPlayers = 2;

Game.prototype.addPlayer = function(player) {
	if (this.state != Game.WAITING) { return false; }
	
	player.game = this;
	player.playerNum = this.players.length;
	this.players.push(player);
	if (this.players.length == this.maxPlayers) {
		this.startGame();
	}
	return true;
}

Game.prototype.removePlayer = function(player) {
	var i;
	if (this.state != Game.WAITING && this.state != Game.PLAYING) { return false; }
	for (i=0; i<this.players.length; i++) {
		if (this.players[i].id == player.id) {
			this.players.splice(i,1);
			player.game = null;
			player.playerNum = -1;
			this.state = Game.WAITING;
			this.board = '---------';
			break;
		}
	}
	for (i=0; i<this.players.length; i++) {
		this.players[i].playerNum = i;
	}
}

Game.prototype.startGame = function() {
	if (this.state == Game.WAITING) {
		// Randomize X/O
		if (Math.random() > 0.5) {
			var o = this.players.shift();
			this.players.push(o);
		}
		for (var i=0; i<this.players.length; i++) {
			this.players[i].playerNum = i;
		}
		this.turn = 0;
		this.state = Game.PLAYING;
	}
}

// Make a move.   position = 0-8
Game.prototype.move = function(playerNum, position) {
	if (position < 0 || position > 8) { return false; } // invalid position!
	if (this.state != Game.PLAYING) { return false; }  // game not playing!
	if (this.turn != playerNum) { return false; }  // not your turn!
	if (this.board.charAt(position) != '-') { return false; } // space already occupied!
	
	this.board = this.board.substr(0, position) + (playerNum == 0 ? 'X' : 'O') + this.board.substr(position+1);
	this.checkWin();
	if (this.state == Game.PLAYING) {
		this.turn = this.turn == 0 ? 1 : 0;
	}
	
	return true;
}

// Remove all the players from a game that is over.
Game.prototype.terminate = function() {
	if (this.state == Game.OVER) {
		for (var i=0; i<this.players.length; i++) {
			this.players[i].game = null;
			delete this.players[i];
		}
		this.players.splice(0, this.players.length);
		this.state = Game.TERMINATED;
	}
}

Game.prototype.winningBoards = ['XXX------', '---XXX---', '------XXX', 
								'X--X--X--', '-X--X--X-', '--X--X--X',
								'X---X---X', '--X-X-X--'];
																
Game.prototype.checkWin = function(m) {
	var winner = -1, i;
	for (var w=0; w<this.winningBoards.length; w++) {
		var checkedSpots = [];
		var wb = this.winningBoards[w];
		for (i=0; i<9; i++) {
			if (wb.charAt(i) == 'X') { checkedSpots.push(this.board.charAt(i)); }
		}
		if ( (checkedSpots[0] == checkedSpots[1]) && (checkedSpots[0] == checkedSpots[2]) ) {
			winner = (checkedSpots[0] == 'X') ? 0 : ( (checkedSpots[0] == 'O') ? 1 : -1 );
		}
		if (winner >= 0) { break; }
	}
	if (winner >= 0) {
		this.state = Game.OVER;
		this.turn = winner;
	} else if (this.board.indexOf('-') == -1) {
		// draw!
		this.state = Game.OVER;
		this.turn = -1;
	}
}

// Get game state for reporting to players
Game.prototype.getState = function() {
	var players = [];
	for (var i=0; i<this.players.length; i++) {
		players.push(this.players[i].name);
	}
	return {
		id: this.id,
		state: this.state,
		players: players,
		board: this.board,
		turn: this.turn
	};
}


var games = {}; // { game_id : game }
var players = {};  // { socket_id : player }
var waiting_players = {}; // { socket_id : true }
var deciding_players = {}; // { socket_id : true }

io.sockets.on('connection', function (socket) {
	var newPlayer = new Player(socket);
	players[socket.id] = newPlayer;
	reportAll();

	// "hey there, I'm looking for a game, so here's my name,
	//  and keep me posted on what games are available to join"
	socket.on('lookingforgame', function (message) {
		deciding_players[socket.id] = true;
		players[socket.id].name = message.name;
		socket.emit('waitingplayers', waitingPlayersList());
		reportAll();
	});

	// "hey there, can I start a new game?  I'm waiting
	//  to hear back!"
	socket.on('newgame', function (message, fn) {
		var player = players[socket.id];
		// TODO limit new games
		if (player.game) {
			fn({error : true});
			return;
		}
		
		var newgame = new Game();
		games[newgame.id] = newgame;
		newgame.addPlayer(player);

		delete deciding_players[socket.id];
		waiting_players[socket.id] = true;
		broadcastWaitingPlayers();

		broadcastGame(newgame, player.playerNum, fn);
		reportAll();
	});
	
	// "hey there, can I join this game?  I'm waiting
	//  to hear back!"
	socket.on('joingame', function (message, fn) {
		var player = players[socket.id];
		var game = games[message.game];
		if (!game || game.state != Game.WAITING || player.game) {
			fn({ error: true });
			return;
		} 

		if (game.addPlayer(player) == false) {
			fn({ error: true });
			return;
		}

		delete deciding_players[socket.id];
		
		// If the game has started, take everybody off the waiting players list    
		if (game.state == Game.PLAYING) {
			for (var i=0; i<game.players.length; i++) {
				delete waiting_players[game.players[i].id];
			}
			broadcastWaitingPlayers();      
		}
		
		broadcastGame(game, player.playerNum, fn);
		reportAll();
	});

	// "Here is my move: {position: 1-9}.  I'm waiting to hear
	//  an acknowledgement"
	socket.on('move', function (message, fn) {
		var player = players[socket.id];
		if (!player || !player.game) { fn({error:true}); return; }
		
		var game = player.game;
		if (!game.move(player.playerNum, message.position - 1)) {
			fn({error:true});
			return;
		}
	
		broadcastGame(game, player.playerNum, fn);
		
		// If the game is over, remove all the players, and get rid of 
		// the game.  The broadcastAbove is the last message.
		if (game.state == Game.OVER) {
			game.terminate();
			delete games[game.id];
		}
		reportAll();
	});
	
	// "I'm bailing on the game I'm in!"
	socket.on('leavegame', function (message, fn) {
		leaveGame(socket.id);
		reportAll();
	});
	
	socket.on('disconnect', function () {
		leaveGame(socket.id);
		delete players[socket.id];
		delete deciding_players[socket.id];
		delete waiting_players[socket.id];
		reportAll();
	});

	function waitingPlayersList() {
		var list = [];
		for (var i in waiting_players) {
			var p = players[i];
			list.push({ name: p.name, game: p.game.id});
		}
		return list;
	}
	
	// Broadcast all waiting players to all deciding players
	function broadcastWaitingPlayers() {
		list = waitingPlayersList();
		for (var i in deciding_players) {
			players[i].socket.emit('waitingplayers', list);
		}
	}
	
	// Broadcast game status to all players
	// (optional) if player is defined, use the acknowledgement callback function
	// fn({error:false; game: {...}}) instead of socket.emit({...})
	function broadcastGame(game, player, fn) {    
		var gameState = game.getState();
		for (var i=0; i<game.players.length; i++) {
			gameState.you = i;
			if (player == i) {
				fn({error: false, game: gameState});
			} else {
				game.players[i].socket.emit('gameupdate', gameState);
			}
		}
	}
	
	function leaveGame(socket_id) {
		var player = players[socket_id];
		if (!player || !player.game) { return; }
		
		var game = player.game;
		delete waiting_players[socket_id];

		game.removePlayer(player);
		if (game.players.length == 0) {
			delete games[game.id];
		}
		else if (game.state == Game.WAITING) {
			broadcastGame(game);
			for (var i=0; i<game.players.length; i++) {
				waiting_players[game.players[i].id] = true;
			}
		}
		broadcastWaitingPlayers();
	}

});  

function reportAll() {
	console.log('\n');
	console.log('Players:');
	for (var i in players) {
		var player = players[i];
		var p = { name: player.name, id:player.id, game: (player.game ? player.game.id : null) };
		console.log(p);
	}
	console.log('Games:');
	for (i in games) {
		var game = games[i];
		var names = [];
		for (var i=0; i<game.players.length; i++) {
			names.push(game.players[i].name);
		}
		var gameState = {
			id: game.id,
			state: game.state,
			players: names,
			board: game.board,
			turn: game.turn
		};    
		console.log(gameState);
	}
	console.log('waiting_players: ' + JSON.stringify(waiting_players));
	console.log('deciding_players: ' + JSON.stringify(deciding_players));
	console.log('-------------------------------------------------');
	
}


server.listen(8124);

