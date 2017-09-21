var EventEmitter = require('events').EventEmitter;
var debug = require('debug')('localtunnel:client');
var net = require('net');

var HeaderHostTransformer = require('./HeaderHostTransformer');

// manages groups of tunnels
var TunnelCluster = function(opt) {
    if (!(this instanceof TunnelCluster)) {
        return new TunnelCluster(opt);
    }

    var self = this;
    self._opt = opt;

    EventEmitter.call(self);
};

TunnelCluster.prototype.__proto__ = EventEmitter.prototype;

// establish a new tunnel
TunnelCluster.prototype.open = function() {
    var self = this;

    var opt = self._opt || {};

    var remote_host = opt.remote_host;
    var remote_port = opt.remote_port;

    var local_host = opt.local_host || 'localhost';
    var local_port = opt.local_port;

    debug('establishing tunnel %s:%s <> %s:%s', local_host, local_port, remote_host, remote_port);

    // connection to localtunnel server
    var remote = net.connect({
        host: remote_host,
        port: remote_port
    });

    remote.setKeepAlive(true);

    remote.on('error', function(err) {
        // emit connection refused errors immediately, because they
        // indicate that the tunnel can't be established.
        if (err.code === 'ECONNREFUSED') {
            self.emit('error', new Error('connection refused: ' + remote_host + ':' + remote_port + ' (check your firewall settings)'));
        }

        remote.end();
    });

    function conn_local() {
        if (remote.destroyed) {
            debug('remote destroyed');
            self.emit('dead');
            return;
        }

        debug('connecting locally to %s:%d', local_host, local_port);
        remote.pause();

        // connection to local http server
        var local = net.connect({
            host: local_host,
            port: local_port
        });

        function remote_close() {
            debug('remote close');
            self.emit('dead');
            local.end();
        };

        remote.once('close', remote_close);

        // TODO some languages have single threaded servers which makes opening up
        // multiple local connections impossible. We need a smarter way to scale
        // and adjust for such instances to avoid beating on the door of the server
        local.once('error', function(err) {
            debug('local error %s', err.message);
            local.end();

            remote.removeListener('close', remote_close);

            if (err.code !== 'ECONNREFUSED') {
                return remote.end();
            }

            // retrying connection to local server
            setTimeout(conn_local, 1000);
        });

        local.once('connect', function() {
            debug('connected locally');
            remote.resume();

            var stream = remote;

            // if user requested specific local host
            // then we use host header transform to replace the host header
            if (opt.local_host) {
                debug('transform Host header to %s', opt.local_host);
                stream = remote.pipe(HeaderHostTransformer({ host: opt.local_host }));
            }

            var compData = new CompressData()

            stream.pipe(local).pipe(compData).pipe(remote);
            

            // when local closes, also get a new remote
            local.once('close', function(had_error) {
                debug('local connection closed [%s]', had_error);
            });
        });
        
    }

    // tunnel is considered open when remote connects
    remote.once('connect', function() {
        self.emit('open', remote);
        conn_local();
    });
};


var stream = require('stream')
var util = require('util')
var bindexOf = require('buffer-indexof')
var replace = require('buffer-replace')
var fs = require('fs')
var Transform = stream.Transform

function CompressData(options) {
  // allow use without new
  if (!(this instanceof CompressData)) {
    return new CompressData(options)
  }

  // init Transform
  Transform.call(this, options)
}
util.inherits(CompressData, Transform)

var BLOBCACHE = {}

CompressData.prototype._transform = function (chunk, enc, cb) {
  var binChunk = chunk.toString("binary")
  // check if has blob. (starts with ".blob,", ends with ".end")
  var blobs = binChunk.match(/.blob,[\s\S]*?.end/g)
  for (var i in blobs){
      var b = blobs[i]
      var bBuf = Buffer.from(b, 'binary')
      // check cache
      if (BLOBCACHE[b.hashCode()]){
          replacementBuf = Buffer.from("<BC:"+b.hashCode()+">").toString("binary")
          //binChunk = replace(b, )
          //console.log("found?",bindexOf(chunk, bBuf))
          //fs.writeFileSync("a.txt", chunk)
          chunk = replace(chunk, bBuf, replacementBuf)
          //fs.writeFileSync("b.txt", replace(chunk, bBuf, replacementBuf))
          //console.log(chunk.toString("binary"))
      }


      BLOBCACHE[b.hashCode()] = bBuf
  }
  console.log(chunk.toString("binary"))
  this.push(chunk)
  
  cb()
}

String.prototype.hashCode = function(){
	var hash = 0
	if (this.length == 0) return hash
	for (i = 0; i < this.length; i++) {
		char = this.charCodeAt(i)
		hash = ((hash<<5)-hash)+char
		hash = hash & hash // Convert to 32bit integer
	}
	return hash;
}

module.exports = TunnelCluster;
