# Det Er Os Der Snakker [![Nodejitsu Deploy Status Badges](https://webhooks.nodejitsu.com/teltploek/DetErOsDerSnakker.png)](https://webops.nodejitsu.com#teltploek/webhooks)

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

## Working on...

 * ~~Getting socket to communicate with the user per request rather than globally across all connections~~ Probably done... needs more testing.
 * ~~Getting weird unicode from comment feed translated to readable characters~~ Done!!
 * ~~Slicing up strings in 100 character bulks, sending to Google TTS and stiching up again afterwards~~ Done!!

## TODOs

  * Hook op progress to show earlier actions up to TTS-conversion.
  * Check out AngularJS animations in new version.
  * Remember beta-badge.
  * Remember github url in footer.
  * Remember author information in footer.
  * ~~Skip the narrating of web-addresses, smileys etc.~~ Done!!
  * ~~Cleaning up after article narration so we're able to read out the next one. Right now comments are mixed and matched.~~ Done !!
  * ~~Convert names to remove stringified unicode chars.~~ Done!!
  * ~~Some times the TTS conversion fails - find out why, and fix it.~~ Done!!
  * ~~Max '...'-conversion.~~ Done!!
  * Handle errors, eb downtime etc.
  * Make ps1-script more generic using relative dirs
  * Put current version in footer of page (read package.json and render in frontend)
  * Google Analytics

---
Wasting time since 1981