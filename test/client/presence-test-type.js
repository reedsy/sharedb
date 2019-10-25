exports.type = {
  name: 'presence-test-type',
  uri: 'http://sharejs.org/types/presence-test-type',
  create: create,
  apply: apply,
  transform: transform,
  transformPresence: transformPresence
};

function create(data) {
  return typeof data === 'string' ? data : '';
}

function apply(snapshot, op) {
  return snapshot.substring(0, op.index) + op.value + snapshot.substring(op.index);
}

function transform(op1, op2, side) {
  return op1.index < op2.index || (op1.index === op2.index && side === 'left')
    ? op1
    : {index: op1.index + op1.length, value: op1.value};
}

function transformPresence(presence, op, isOwnOperation) {
  return !presence || presence.index < op.index || (presence.index === op.index && !isOwnOperation)
    ? presence
    : {index: presence.index + op.value.length};
}
