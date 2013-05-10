var util   = require('util')
   ,cp     = require('child_process')
   ,events = require('events');
   
var cpool = {
  
};

var CProc = function() {
  "use strict";
  if (!(this instanceof CProc)) {
    return new CProc();
  }

  // inherit from EventEmitter
  events.EventEmitter.call(this);
    
  this.busy = false;
  this.child = null;
  
  this.fork = function(modulePath,args) {
    var self = this;
    // spawn the child
    this.child = cp.fork(modulePath,args);

    this.child.on('message',function(msg) {
      // when the process sends, alert the pool handler
      // with the message and the reference to this child
      // so it can be added back to the ready list
      self.emit('message',{message:msg,child:self});
      self.busy = false;
    });
    
    return this;
  };
  
  this.send = function(msg) {
    this.child.send(msg);
    this.busy = true;
  };
  
  this.kill = function() {
    this.child.kill();
  };
};
util.inherits(CProc,events.EventEmitter);

var CPool = function(childCount,maxPendQueue) {
  "use strict";
  var i
     ,p 
     ,m_ready_queue   = [] 
     ,m_pend_queue     = [] 
     ,m_max_pendq 
     ,m_modulePath 
     ,m_moduleArgs  
     ,m_moduleOpts
     ,m_count
     ,m_kill;

  // all parameters are required
  if ((childCount === undefined)||(childCount <= 0)) {
    throw new Error('childCount > 0 is required');
  }
  if (maxPendQueue === undefined) {
    throw new Error('maxPendQueue is required');
  }

  m_kill = false;     
  m_count = childCount;
  m_max_pendq = maxPendQueue;
  
  if (!(this instanceof CPool)) {
    return new CPool();
  }
  
  // inherit event emitter
  events.EventEmitter.call(this);
  
  this.getReadyQueueLength = function() {
    return m_ready_queue.length;
  };
  
  this.getPendQueueLength = function() {
    return m_pend_queue.length;
  };
  
  // client send function
  this.send = function(msg) {
    var p;
    // if any of the children are ready to run
    if (m_ready_queue.length > 0) {
      // dispatch the message      = 0
      p = m_ready_queue.shift();
      p.send(msg);
    }
    else if (m_pend_queue.length < m_max_pendq) {
      // no ready processes
      m_pend_queue.push(msg);
    }
    else {
      // no room in message buffer queue
      return false;
    }
    // succeeded
    return true;
  };
  
  // kill()
  // kill all threads when they are done
  // DH Not sure if this works in all cases
  this.kill = function()  {
    var p;
    
    // kill any ready children
    while(m_ready_queue.length > 0) {
      p = m_ready_queue.shift();
      p.kill();
      m_count--;
    }
    
    // if that is all the children, emit the killed message and return
    if (m_count === 0) {
      this.emit('exit');
    }
    else {
      // some children are still busy
      // signal remaining busy threads to die when finished
      m_kill = true;
    }
  };
  
  // 
  this.fork = function(modulePath,args,options) {
    var self
       ,p
       ,onMessage;
       
    // for closures 
    self = this;
    
    if (modulePath === undefined) {
      throw new Error('modulePath is required');
    }
    
    // get remaining arguments if any
    args = Array.prototype.slice.call(arguments,2);

    // record input parameters
    m_max_pendq  = maxPendQueue;
    m_modulePath = modulePath;
    m_count      = childCount;
    m_moduleArgs = args;
    m_moduleOpts = options;

    // incoming message handler
    onMessage = function(msg) {
      var m;
      // forward the message piece to the client
      self.emit('message',msg.message);

      // handle the now idle child process
      if (m_kill) {
        // a kill command was issued, so kill the child
        msg.child.kill();
        m_count--;
        if (m_count === 0) {
          // all children are killed, emit the exit event
          self.emit('exit');
        }
      }
      else if (m_pend_queue.length > 0) {
        // message is in the pend queue, dispatch it
        m = m_pend_queue.shift();
        msg.child.send(m);  
      }
      else {
        // nothing pending, put child on ready queue
        m_ready_queue.push(msg.child);
      }
    };
        
    // spawn the child processes
    for(i=0;i<m_count;++i) {
      // create the proxy child
      p = new CProc();
      
      // fork the child process
      p.fork(modulePath,m_moduleArgs,m_moduleOpts);
      
      // add to list of runnable children
      m_ready_queue.push(p);
      
      // receive return messages from child process
      p.on('message',onMessage);
    }
    
    return true;
  };
};
util.inherits(CPool,events.EventEmitter);

// client creates pools with this function
cpool.createPool = function(childCount,maxPendQueue) {
  "use strict";
  return new CPool(childCount,maxPendQueue);
};

module.exports = cpool;
