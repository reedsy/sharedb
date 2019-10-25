var emitter = require('../../emitter');

module.exports = RemotePresence;
function RemotePresence(connection, presenceId, collection, id) {
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
  this._pending = null;
  this._opCache = null;

  this._opHandler = this._handleOp.bind(this);
  this._registerWithDoc();
}
emitter.mixin(RemotePresence);

RemotePresence.prototype.remove = function() {
  this._doc.off('op', this._opHandler);
};

RemotePresence.prototype._receiveUpdate = function(error, presence) {
  if (error) return this.emit('error', error);
  // TODO: Check seq of presence vs seq of pending
  this._pending = presence;
  this._setPendingPresence();
};

RemotePresence.prototype._setPendingPresence = function() {
  if (!this._pending) return;

  if (this._pending.v > this._doc.version) {
    return this._doc.fetch();
  }

  if (!this._catchUpOldPresence()) return;

  this.value = this._pending.p;
  this._pending = null;
  this._setPresenceOnDoc();
};

RemotePresence.prototype._setPresenceOnDoc = function() {
  if (this.value == null) {
    delete this._doc.remotePresences[this.presenceId];
  } else {
    this._doc.remotePresences[this.presenceId] = this.value;
  }

  this._doc.emit('presence', this.presenceId, this.value);
};

RemotePresence.prototype._registerWithDoc = function() {
  // TODO: Check type supports presence
  this._doc.on('op', this._opHandler);
};

RemotePresence.prototype._handleOp = function(op, source) {
  this._transformAgainstOp(op, source);
  this._cacheOp(op, source);
  this._setPendingPresence();
};

RemotePresence.prototype._transformAgainstOp = function(op, source) {
  if (!this.value) return;

  try {
    this.value = this._doc.type.transformPresence(this.value, op, source);
  } catch (error) {
    this.emit('error', error);
  }
  this._setPresenceOnDoc();
};

RemotePresence.prototype._catchUpOldPresence = function() {
  if (this._pending.v >= this._doc.version) return true;

  if (!this._opCache) {
    this._startCachingOps();
    this._doc.fetch();
    // TODO: A bit weird to create a "dummy" presence to trigger an update?
    this.connection.createPresence(this.collection, this.id, null, function(error) {
      // TODO: Handle this better?
      if (error) this.emit('error', error);
    }.bind(this));
    return false;
  }

  while (this._opCache[this._pending.v]) {
    var item = this._opCache[this._pending.v];
    var op = item.op;
    var source = item.source;
    // TODO: Handle create and delete. Can we combine with the ot.js method?
    this._pending.p = this._doc.type.transformPresence(this._pending.p, op, source);
    this._pending.v++;
  }

  var hasCaughtUp = this._pending.v >= this._doc.version;
  if (hasCaughtUp) {
    this._stopCachingOps();
  }

  return hasCaughtUp;
};

RemotePresence.prototype._startCachingOps = function() {
  this._opCache = [];
};

RemotePresence.prototype._stopCachingOps = function() {
  this._opCache = null;
};

RemotePresence.prototype._cacheOp = function(op, source) {
  if (this._opCache) {
    // Subtract 1 from the current doc version, because an op with v3
    // should be read as the op that takes a doc from v3 -> v4
    this._opCache[this._doc.version - 1] = {op: op, source: source};
  }
};
