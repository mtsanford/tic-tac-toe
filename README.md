tic-tac-toe
===========

My first experiment with node.js, socket.io, and jquery-mobile to create a cross browser tic-tic-toe game.
Not really the best code, but it works well enough.

This is just the game server (game-server.js), which exposes a socket to interact with the game logic and other players.
The client code is in a separate project.

There is also a robot script (game-robots.js), which interacts with the game server exactly as a web client would.
game-robots.js ensures that there are always 2 robot players availabe with which to test one's tic-tac-toe mettle.


