"use strict";

var EventEmitter = require('events').EventEmitter
  , net = require('net')
  , Utils = require('./utils')
  , domain = require('domain');

exports.IssueLog = IssueLog;         // connection issue handling
exports.Available = ping;            // connection availablity

function ping (host, port, callback) {
  var socket = net.connect(port, host, function connected() {
    socket.end();
    callback();
  });

  socket.on('error', function onError(err) {
    callback(err);
  });
}

function IssueLog (args) {
  this.config = args;
  this.messages = [];
  this.failed = false;

  this.totalRetries = 0;
  this.retry = 0;
  this.totalReconnectsAttempted = 0;
  this.totalReconnectsSuccess = 0;

  Utils.merge(this, args);
  EventEmitter.call(this);
}

var issues = IssueLog.prototype = new EventEmitter;

issues.log = function log (message) {
  var issue = this;

  this.failed = true;
  this.messages.push(message || 'No message specified');

  if (this.retries) {
    var retryTimer = setTimeout(issue.attemptRetry.bind(issue), this.retry);
    if (domain.active) {
      domain.active.remove(retryTimer);
    }
    return this.emit('issue', this.details);
  }

  if (this.remove) {
    this.emit('remove', this.details);
  }

  var reconnectTimer = setTimeout(issue.attemptReconnect.bind(issue), this.reconnect);
  if (domain.active) {
    domain.active.remove(reconnectTimer);
  }
};

Object.defineProperty(issues, 'details', {
  get: function getDetails () {
    var res = {};

    res.server = this.serverAddress;
    res.tokens = this.tokens;
    res.messages = this.messages;

    if (this.retries) {
      res.retries = this.retries;
      res.totalRetries = this.totalRetries;
    } else {
      res.totalReconnectsAttempted = this.totalReconnectsAttempted;
      res.totalReconnectsSuccess = this.totalReconnectsSuccess;
      res.totalReconnectsFailed = this.totalReconnectsAttempted - this.totalReconnectsSuccess;
      res.totalDownTime = (res.totalReconnectsFailed * this.reconnect) + (this.totalRetries * this.retry);
    }

    return res;
  }
});

issues.attemptRetry = function attemptRetry () {
  this.totalRetries++;
  this.retries--;
  this.failed = false;
};

issues.attemptReconnect = function attemptReconnect () {
  var issue = this;
  this.totalReconnectsAttempted++;
  this.emit('reconnecting', this.details);

  // Ping the server
  ping(this.tokens[1], this.tokens[0], function pingpong (err) {
    // still no access to the server
    if (err) {
      issue.messages.push(err.message || 'No message specified');
      return setTimeout(issue.attemptReconnect.bind(issue), issue.reconnect);
    }

    issue.emit('reconnected', issue.details);

    issue.totalReconnectsSuccess++;
    issue.messages = [];
    issue.failed = false;

    // we connected again, so we are going through the whole cycle again
    Utils.merge(issue, JSON.parse(JSON.stringify(issue.config)));
  });
};
