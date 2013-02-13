# Det Er Os Der Snakker

Will fetch comments from Ekstra Bladets nationen, and read them out loud. In other words: A multi-billion $ project in the making.

## How to use it

Ehm... don't!(?)

If you really need to, you could try to clone it, then run

      npm install 

(I guess it goes without saying that Node.js is a dependency for running this.)

When you've done npm install then run

	  node app

and point your browser to http://localhost:3000


Right now everything is work in progress, so don't expect anything to work yet.

## Working on...

Right now I'm working on fetching base64-encoded responses from Google Text-To-Speech service on Node.js server, and passing them on to the front-end through socket.io, when they return.

---
Wasting time since 1981