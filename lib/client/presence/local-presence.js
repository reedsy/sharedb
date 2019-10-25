var emitter = require('../../emitter');

module.exports = LocalPresence;
function LocalPresence(connection, presenceId, collection, id) {
  emitter.EventEmitter.call(this);

  this.connection = connection;
  this.id = id;
  this.collection = collection;

  this.presenceId = presenceId;
  this.value = null;

  this._sent = false;
  this._doc = this.connection.get(collection, id);
  this._callbacksBySeq = {};
  this._seq = null;

  this._registerWithDoc();
}
emitter.mixin(LocalPresence);

// TODO: Handle the case of multiple updates called before send?
LocalPresence.prototype.update = function(value, options, callback) {
  this.value = value;
  this.send(options, callback);
};

LocalPresence.prototype.send = function(options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = null;
  }

  this._sent = false;

  if (!this.connection.canSend) {
    // TODO: Handle connection state changed and resend
    return;
  }

  // TODO: What to do in the case that an op is rejected? (ie rollback)
  this._doc.whenNothingPending(function() {
    var message = this._message(options);
    this._callbacksBySeq[message.seq] = callback;
    this.connection.send(message);
    this._sent = true;
  }.bind(this));
};

LocalPresence.prototype._ack = function(error, seq) {
  var callback = this._callbacksBySeq[seq];
  callback && callback(error, this);
};

LocalPresence.prototype._registerWithDoc = function() {
  // TODO: Check type supports presence
  this._doc.on('op', this._transformAgainstOp.bind(this));
};

LocalPresence.prototype._message = function(options) {
  options = options || {};
  // TODO: Probably need to send snapshot version for comparison
  this._seq = this.connection.seq++;
  return {
    a: 'p',
    id: this.presenceId,
    c: this.collection,
    d: this.id,
    v: this._doc.version,
    p: this.value,
    t: this._doc.type.uri,
    r: !!options.requestPresence,
    seq: this._seq
  };
};

LocalPresence.prototype._transformAgainstOp = function(op, source) {
  if (this.sent) return;

  try {
    this.value = this._doc.type.transformPresence(this.value, op, source);
  } catch (error) {
    this.emit('error', error);
  }
};
