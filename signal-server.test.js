const test = require('ava')
const getPort = require('get-port')
let server = require('http').createServer()
server = require('http-shutdown')(server)
const io = require('socket.io-client')
require('./signal-server')(server)

let serverUrl

test.beforeEach(openServerAsync)
test.afterEach(closeServerAsync)

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

async function openServerAsync () {
  const port = await getPort()
  await new Promise((resolve, reject) => {
    server.listen(port, err => {
      if (err) reject(err)
      else {
        resolve()
      }
    })
  })
  serverUrl = 'http://localhost:' + port
}

function closeServerAsync () {
  return new Promise(resolve => server.shutdown(resolve))
}

function getClientAsync (peerId) {
  const socket = io(serverUrl, { query: { peerId } })
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket))
    socket.on('error', reject)
  })
}
