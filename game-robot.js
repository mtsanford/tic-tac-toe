var sys = require('sys')
  , io = require('socket.io-client');

var MIN_ROBOTS = 2  
  
var robotNames = ['H.A.L.', 'Data', 'H.E.R.B.I.E.', 'Rusty', 'ED-209', 'C-3PO', 'R2-D2', 'Bishop', 'T-800', 'David', 'GERTY 3000'];
var nextName = 0;

function fireUpRobot() {

	var socket = io.connect('http://localhost:8124', {'force new connection': true}),
	gameStarted = false,
	name = robotNames[nextName];

	nextName = (nextName == robotNames.length-1) ? 0 : nextName+1;

	socket.on('connect', function() {
		console.log(name + ' connected');
		socket.emit('lookingforgame', { name : name });
		socket.emit('newgame', '', function(m) {
			if (m.error) {
				socket.disconnect();
				setTimeout(fireUpRobot, 5000);
				console.log('new game failed');
				return;
			}
		});
	});

	socket.on('gameupdate', function(newGame) {

		// If player leaves the game after joining, disconnect
		if (newGame.state == 0 && gameStarted) {
			socket.disconnect();
		}
		
		else if (newGame.state == 1) {
			// One user has joined a game, fire up another robot
			if (!gameStarted) {
				gameStarted = true;
				fireUpRobot();
			}
			if (newGame.you == newGame.turn) {
			  	setTimeout(function() {
			  		// Our AI is not very sophisticated.  Just pick a random square.
			  		var empty = [];
			  		for (var i=0; i<9; i++) {
			  			if (newGame.board.charAt(i) == '-') {
			  				empty.push(i);
			  			}
			  		}
			  		var position = empty[randomFromTo(0,empty.length-1)] + 1;

			  		socket.emit('move', {position : position}, function(m) {
			  			if (m.error) {
							// should not happen
							console.log('bad move');
							socket.disconnect();
							return;
						}
						if (m.game.state == 2) {
							socket.disconnect();
						}
					});
		  		}, 1000 + Math.random() * 2000);
			}
		}
		
		else if (newGame.state == 2) {
			socket.disconnect();
		}
	});

}

for (var i=0; i<MIN_ROBOTS; i++) {
	fireUpRobot();
}

function randomFromTo(from, to) {
	return Math.floor(Math.random() * (to - from + 1) + from);
}
