const test = require('ava')
const fixture = require('./signal-server.fixture')(test)
const io = require('socket.io-client')

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

function getClientAsync (peerId) {
  const socket = io(fixture.getServerUrl(), { query: { peerId } })
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket))
    socket.on('error', reject)
  })
}
