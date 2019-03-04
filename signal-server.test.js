const test = require('ava')
const fixture = require('./signal-server.fixture')(test)
const io = require('socket.io-client')
const { poll } = require('./util')

test('connects two clients', async t => {
  const [A, B] = await Promise.all([getClientAsync('A'), getClientAsync('B')])
  t.truthy(A.connected)
  t.truthy(B.connected)
})

test('invalid peerId', async t => {
  try {
    await getClientAsync('%')
    t.fail('should throw')
  } catch (e) {
    t.truthy(/^invalid peerId/.test(e))
  }
})

test('already connected peer', async t => {
  try {
    await getClientAsync('A')
    await getClientAsync('A')
    t.fail('should throw')
  } catch (e) {
    t.is(e, "peer with id 'A' already connected")
  }
})

test('proxies signal', async t => {
  let received, err
  const [A, B] = await Promise.all([getClientAsync('A'), getClientAsync('B')])
  B.on('signal', data => {
    received = data
  })
  A.emit('signal', { to: 'B', signal: 'foo' }, e => {
    err = e
  })
  await poll(() => !!received)
  t.deepEqual(received, { from: 'A', signal: 'foo' })
  t.falsy(err)
})

test('unknown signal receiver', async t => {
  let err
  const A = await getClientAsync('A')
  A.emit('signal', { to: 'B', signal: 'foo' }, e => {
    err = e
  })
  await poll(() => !!err)
  t.is(err, 'unknown receiver')
})

function getClientAsync (peerId) {
  const socket = io(fixture.getServerUrl(), { query: { peerId } })
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket))
    socket.on('error', reject)
  })
}
