# Det Er Os Der Snakker

Will fetch comments from Ekstra Bladets nationen, and read them out loud. In other words: A multi-billion $ project in the making.

## Why?

Well for one; it's fun! Every person I've mentioned this for has initially laughed, and then shown interest in the project.

Secondly it's a major learning experience. A great opportunity to work on a Node.js Express application. Trying out the (genius!) node package manager. And hopefully learning how to deploy the thing in the end! Really really interesting.

Thirdly it's a short way to fortune and fame.

## How to use it

Ehm... don't!(?)

If you really need to, you could try to clone it, then run

      npm install 

(I guess it goes without saying that Node.js is a dependency for running this.)

When you've done npm install then run

	  node app

and point your browser to http://localhost:3000

Right now everything is work in progress, so don't expect anything to work yet.

## Updates

March 28-29

Working on rewriting Nationen module, so it'll have a dedicated socket-room per client - previously socket communication were mixed and matched across connected clients. This is probably solved now, but needs more testing...

March 23

Putting things together - it's starting to look promising...

March 17

Major break-through! Managed to translate stringified unicode characters from comment-feed to readable characters. This pretty much completes the POC, and ignites the next level - completing the app for a public audience!

## Working on...

 * ~~Getting socket to communicate with the user per request rather than globally across all connections~~ Probably done... needs more testing.
 * ~~Getting weird unicode from comment feed translated to readable characters~~ Done!!
 * ~~Slicing up strings in 100 character bulks, sending to Google TTS and stiching up again afterwards~~ Done!!

## TODOs

 ## Must haves
  * Find a way to skip the narrating of web-addresses, smileys etc.
  * Handle errors, eb downtime etc.

 ## Nice to haves
  * Make ps1-script more generic using relative dirs
  * Put current version in footer of page (read package.json and render in frontend)

---
Wasting time since 1981