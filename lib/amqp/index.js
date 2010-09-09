var sys = require('sys');
var net = require('net');
var Frame  = require("./frame");
var Method = require("./method");
var Queue  = require('./queue');
var C = require('./constants');
var S11n = require('./serialization');

exports.createConnection = function(opts) {
  return new exports.Connection(opts);
}
exports.defaultOptions = {
  host: 'localhost',
  port: 5672,
  vhost: '/',
  login: 'guest',
  password: 'guest'
}

exports.Connection = function(options) {
  process.EventEmitter.call(this);

  this.init(options);
}
sys.inherits(exports.Connection, process.EventEmitter);

var proto = exports.Connection.prototype;

proto.init = function(options) {
  var self = this;
  var opts = {};
  var buffer = '';
  process.mixin(opts, exports.defaultOptions, options);

  function matchMethod(message, method) {
    return message.method && (message.method[0] == method[0] && message.method[1] == method[1]);
  }

  var conn = net.createConnection(opts.port, opts.host);
  conn.sendDebug = function(data) {
    conn.send(data);
  }
  conn.addListener("connect", function() {
    conn.send("AMQP" + String.fromCharCode(1,1,8,0));
  });

  conn.addListener("receive", function(data) {
    buffer = Frame.deserialize(buffer + data, function(message) {
      message.matchMethod = function(method) {
        return matchMethod(message, method);
      }
      message.matchContentHeader = function(method) {
        return message.contentHeader;
      }
      message.matchContent = function(method) {
        return message.content;
      }

      conn.emit('message', message);
    });
  });

  var handshakeListener = function(message) {
    if (message.matchMethod(C.Connection.Start)) {
      conn.send(Method.serialize(C.Connection.StartOk, C.Channel.All, {
          version: '0.0.1',
          platform: 'node',
          information: 'no',
          product: 'node-amqp' },
        'AMQPLAIN',
        S11n.format({LOGIN: opts.login, PASSWORD: opts.password}, 'tableNoHeader'),
        'en_US'
      ));
    } else if (message.matchMethod(C.Connection.Tune)) {
      conn.send(Method.serialize(C.Connection.TuneOk, C.Channel.All, 0, 131072, 0));
      conn.send(Method.serialize(C.Connection.Open, C.Channel.All, opts.vhost, '', ''));
    } else if (message.matchMethod(C.Connection.OpenOk)) {
      conn.send(Method.serialize(C.Channel.Open, 1, ''));
    } else if (message.matchMethod(C.Channel.OpenOk)) {
      self.conn = conn;
      self.emit('connect');
      conn.removeListener(handshakeListener);
    }
  }
  conn.addListener("message", handshakeListener);
}

proto.queue = function(name) {
  return new Queue.Queue(this.conn, {name: name});
}
