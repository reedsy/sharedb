var Backend = require('../../lib/backend');
var expect = require('expect.js');
var async = require('async');
var types = require('../../lib/types');
var presenceTestType = require('./presence-test-type');
var errorHandler = require('../util').errorHandler;
types.register(presenceTestType.type);

describe.only('Presence', function() {
  var backend;
  var connection1;
  var connection2;
  var doc1;
  var doc2;
  var shouldPausePresenceBroadcasts;
  var pausedPresenceCallback;
  var pendingPresenceBroadcasts;

  beforeEach(function(done) {
    shouldPausePresenceBroadcasts = false;
    pausedPresenceCallback = null;
    pendingPresenceBroadcasts = [];

    backend = new Backend();
    connection1 = backend.connect();
    connection2 = backend.connect();

    backend.use(backend.MIDDLEWARE_ACTIONS.sendPresence, function(request, callback) {
      if (!shouldPausePresenceBroadcasts) return callback();
      pendingPresenceBroadcasts.push(callback);
      if (pausedPresenceCallback) pausedPresenceCallback(request);
    });

    doc1 = connection1.get('books', 'northern-lights');
    doc2 = connection2.get('books', 'northern-lights');

    async.series([
      doc1.create.bind(doc1, 'North Lights', presenceTestType.type.name),
      doc1.subscribe.bind(doc1),
      doc2.subscribe.bind(doc2)
    ], done);
  });

  afterEach(function(done) {
    backend.close(done);
  });

  it('emits a presence event when creating presence from another connection', function(done) {
    async.series([
      connection1.createPresence.bind(connection1, 'books', 'northern-lights', {index: 1}),
      function(next) {
        doc1.once('presence', function(id, presence) {
          expect(presence).to.eql({index: 1});
          expect(Object.keys(doc1.remotePresences)).to.have.length(1);
          expect(doc1.remotePresences[id]).to.eql({index: 1});
          next();
        });

        connection2.createPresence('books', 'northern-lights', {index: 1}, errorHandler(done));
      }
    ], done);
  });

  it('transforms existing presence when a new local op is applied', function(done) {
    async.series([
      connection1.createPresence.bind(connection1, 'books', 'northern-lights', {index: 1}),
      function(next) {
        doc1.once('presence', function(id, presence) {
          expect(presence).to.eql({index: 7});
          next();
        });

        connection2.createPresence('books', 'northern-lights', {index: 7}, errorHandler(done));
      },
      function(next) {
        doc1.once('presence', function(id, presence) {
          expect(doc1.data).to.eql('Northern Lights');
          expect(presence).to.eql({index: 10});
          expect(Object.keys(doc1.remotePresences)).to.have.length(1);
          expect(doc1.remotePresences[id]).to.eql({index: 10});
          next();
        });

        doc1.submitOp({index: 5, value: 'ern'});
      }
    ], done);
  });

  it('progresses another client\'s index when inserting my own op at their index', function(done) {
    async.series([
      connection1.createPresence.bind(connection1, 'books', 'northern-lights', {index: 1}),
      function(next) {
        doc1.once('presence', function() {
          next();
        });

        connection2.createPresence('books', 'northern-lights', {index: 5}, errorHandler(done));
      },
      function(next) {
        doc1.once('presence', function(id, presence) {
          expect(presence).to.eql({index: 8});
          next();
        });

        doc1.submitOp({index: 5, value: 'ern'});
      }
    ], done);
  });

  it('does not progress another client\'s index when inserting their op at their index', function(done) {
    async.series([
      connection1.createPresence.bind(connection1, 'books', 'northern-lights', {index: 1}),
      connection2.createPresence.bind(connection2, 'books', 'northern-lights', {index: 5}),
      function(next) {
        doc1.once('presence', function(id, presence) {
          expect(presence).to.eql({index: 5});
          next();
        });

        doc2.submitOp({index: 5, value: 'ern'});
      }
    ], done);
  });

  it('waits for pending ops before submitting presence', function(done) {
    async.series([
      connection2.createPresence.bind(connection2, 'books', 'northern-lights', {index: 1}),
      function(next) {
        doc2.once('presence', function() {
          expect(doc2.version).to.be(2);
          next();
        });

        doc1.submitOp({index: 12, value: ': His Dark Materials'}, errorHandler(done));
        connection1.createPresence('books', 'northern-lights', {index: 20}, errorHandler(done));
      }
    ], done);
  });

  it('transforms pending presence by another op submitted before a flush', function(done) {
    async.series([
      connection2.createPresence.bind(connection2, 'books', 'northern-lights', {index: 1}),
      function(next) {
        doc2.once('presence', function(id, presence) {
          expect(doc2.version).to.be(3);
          expect(doc2.data).to.be('Northern Lights: His Dark Materials');
          expect(presence).to.eql({index: 23});
          next();
        });

        doc1.submitOp({index: 12, value: ': His Dark Materials'}, errorHandler(done));
        connection1.createPresence('books', 'northern-lights', {index: 20}, errorHandler(done));
        doc1.submitOp({index: 5, value: 'ern'}, errorHandler(done));
      }
    ], done);
  });

  it('requests other client\'s presence when initialising', function(done) {
    var presence1;
    async.series([
      function(next) {
        connection1.createPresence('books', 'northern-lights', {index: 3}, function(error, presence) {
          if (error) return done(error);
          presence1 = presence;
          next();
        });
      },
      function(next) {
        doc2.once('presence', function(id, presence) {
          expect(id).to.be(presence1.presenceId);
          expect(presence).to.eql({index: 3});
          next();
        });

        connection2.createPresence('books', 'northern-lights', {index: 5}, errorHandler(done));
      }
    ], done);
  });

  it('updates the document when the presence version is ahead', function(done) {
    async.series([
      connection1.createPresence.bind(connection1, 'books', 'northern-lights', {index: 1}),
      doc1.unsubscribe.bind(doc1),
      doc2.submitOp.bind(doc2, {index: 5, value: 'ern'}),
      function(next) {
        expect(doc1.version).to.be(1);
        expect(doc2.version).to.be(2);

        doc1.once('presence', function(id, presence) {
          expect(doc1.version).to.be(2);
          expect(presence).to.eql({index: 12});
          next();
        });

        connection2.createPresence('books', 'northern-lights', {index: 12}, errorHandler(done));
      }
    ], done);
  });

  it('clears presence from a remote client when setting it to null', function(done) {
    var presence1;
    async.series([
      connection2.createPresence.bind(connection2, 'books', 'northern-lights', {index: 2}),
      function(next) {
        doc2.once('presence', function() {
          next();
        });

        connection1.createPresence('books', 'northern-lights', {index: 1}, function(error, presence) {
          if (error) return done(error);
          presence1 = presence;
        });
      },
      function(next) {
        expect(doc2.remotePresences[presence1.presenceId]).to.eql({index: 1});

        doc2.once('presence', function(id, presence) {
          expect(id).to.be(presence1.presenceId);
          expect(presence).to.be(null);
          expect(Object.keys(doc2.remotePresences)).to.have.length(0);
          next();
        });

        presence1.update(null, errorHandler(done));
      }
    ], done);
  });

  it('transforms old presence when its version is behind the doc', function(done) {
    async.series([
      connection2.createPresence.bind(connection2, 'books', 'northern-lights', {index: 1}),
      doc1.unsubscribe.bind(doc1),
      doc2.submitOp.bind(doc2, {index: 5, value: 'ern'}),
      function(next) {
        expect(doc1.version).to.be(1);
        expect(doc2.version).to.be(2);

        doc2.once('presence', function(id, presence) {
          expect(doc2.version).to.be(2);
          expect(presence).to.eql({index: 15});
          next();
        });

        connection1.createPresence('books', 'northern-lights', {index: 12}, errorHandler(done));
      }
    ], done);
  });

  it('transforms old presence when it arrives later than a new op', function(done) {
    async.series([
      connection2.createPresence.bind(connection2, 'books', 'northern-lights', {index: 1}),
      function(next) {
        pausePresenceBroadcasts(function() {
          next();
        });
        connection1.createPresence('books', 'northern-lights', {index: 12}, errorHandler(done));
      },
      function(next) {
        doc2.once('op', resumePresenceBroadcasts);

        doc2.once('presence', function(id, presence) {
          expect(doc2.version).to.be(2);
          expect(presence).to.eql({index: 15});
          next();
        });

        doc1.submitOp({index: 5, value: 'ern'}, errorHandler(done));
      }
    ], done);
  });

  // This test case attempts to force us into a tight race condition corner case:
  // 1. doc1 sends presence, as well as submits an op
  // 2. doc2 receives the op first, followed by the presence, which is now out-of-date
  // 3. doc2 re-requests doc1's presence again
  // 4. doc1 sends *another* op, which *again* beats the presence update (this could
  //    in theory happen many times)
  it('transforms old presence when new ops keep beating the presence responses', function(done) {
    async.series([
      connection2.createPresence.bind(connection2, 'books', 'northern-lights', {index: 1}),
      function(next) {
        // Pause presence just before sending it back to the clients. It's already been
        // transformed by the server to what the server knows as the latest version
        pausePresenceBroadcasts(function() {
          next();
        });

        connection1.createPresence('books', 'northern-lights', {index: 12}, errorHandler(done));
      },
      function(next) {
        // Now we submit another op, while the presence is still paused. We wait until
        // doc2 has received this op, so we know that when we finally receive our
        // presence, it will be stale
        doc1.submitOp({index: 5, value: 'ern'}, errorHandler(done));
        doc2.once('op', function() {
          next();
        });
      },
      function(next) {
        // At this point in the test, both docs are up-to-date on v2, but doc2 still
        // hasn't received doc1's v1 presence
        expect(doc1.version).to.be(2);
        expect(doc2.version).to.be(2);

        // Resume the presence, so that doc2 receives doc1's v1 presence
        resumePresenceBroadcasts();

        // When doc2 receives the out-of-date presence, it will send another request
        // to doc1 for presence. Let's listen for that request.
        doc1.once('presence', function(id, presence) {
          // Check for null presence so we know we have our dummy ping
          expect(presence).to.be(null);

          // Immediately pause broadcasts again - we want to catch doc1's reply
          // again, so that we can make it stale again
          pausePresenceBroadcasts(function() {
            // Submit more ops while presence is still paused. This will make the
            // presence data stale yet again. Let's submit multiple ops, just to
            // flex the cache a bit.
            doc1.submitOp({index: 0, value: 'The'}, function(error) {
              if (error) return done(error);
              doc1.submitOp({index: 3, value: ' '}, errorHandler(done));
              doc2.on('op', function() {
                // This will get fired for v3 and then v4, so check for the later one
                if (doc1.version === 4 && doc2.version === 4) {
                  // Only once doc2 has received the ops, should we resume our
                  // broadcasts, ensuring that the update is stale again.
                  resumePresenceBroadcasts();
                }
              });
            });
          });
        });

        // Despite the second reply being stale, we expect to have transformed it
        // up to the current version.
        doc2.once('presence', function(id, presence) {
          expect(doc2.version).to.be(4);
          expect(presence).to.eql({index: 19});
          next();
        });
      }
    ], done);
  });

  function pausePresenceBroadcasts(callback) {
    shouldPausePresenceBroadcasts = true;
    // Call the callback only on the first paused presence
    pausedPresenceCallback = function(request) {
      if (callback) callback(request);
      pausedPresenceCallback = null;
    };
  }

  function resumePresenceBroadcasts() {
    shouldPausePresenceBroadcasts = false;
    pendingPresenceBroadcasts.forEach(function(callback) {
      callback();
    });
    pendingPresenceBroadcasts = [];
  }
});
