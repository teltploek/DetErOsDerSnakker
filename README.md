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

(I guess it goes without saying that Node.js is a dependency for running this. You also need to have a local MongoDB instance running on your system)

When you've done npm install then run

	  node app

and point your browser to http://localhost:3000

Right now everything is work in progress, so don't expect anything to work yet.

## TODOs

  * We might need to make request a child_process
  * Fix dev database connection crash.
  * Google Analytics
  * Show direct link to article feed with share-button to facebook/twitter/google plus
  * Add Jekyll blog with bookmarklet instructions

## Known issues

  * App isn't restarting when feed is done.

## Nice to have

  * Make ps1-script more generic using relative dirs

---
Wasting time since 1981