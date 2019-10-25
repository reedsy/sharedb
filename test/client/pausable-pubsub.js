var MemoryPubSub = require('../../lib/pubsub/memory');

module.exports = PausablePubSub;
function PausablePubSub(options) {
  if (!(this instanceof PausablePubSub)) return new PausablePubSub(options);
  MemoryPubSub.call(this, options);
  this.paused = false;
  this.conditionalPause = null;
  this.queue = [];
}
PausablePubSub.prototype = Object.create(MemoryPubSub.prototype);

PausablePubSub.prototype.pause = function() {
  this.paused = true;
};

PausablePubSub.prototype.resume = function() {
  this.paused = false;
  this.conditionalPause = null;

  var pubsub = this;
  this.queue.forEach(function(args) {
    pubsub._publish(args[0], args[1], args[2]);
  });
};

PausablePubSub.prototype.pauseIf = function(condition) {
  this.conditionalPause = condition;
};

PausablePubSub.prototype._publish = function(channels, data, callback) {
  if (this._isPaused(channels, data)) {
    return this.queue.push([channels, data, callback]);
  }

  MemoryPubSub.prototype._publish.call(this, channels, data, callback);
};

PausablePubSub.prototype._isPaused = function(channels, data) {
  if (this.paused) {
    return true;
  }

  return !!(this.conditionalPause && this.conditionalPause(channels, data));
};
