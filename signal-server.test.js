const test = require('ava')
const fixture = require('./signal-server.fixture')(test)
const io = require('socket.io-client')
const { poll } = require('./util')

test('initiate when two clients in same channel', async t => {
  let gotInitiate
  const [a1, a2] = await Promise.all([getClientAsync(), getClientAsync()])
  a1.on('initiate', () => {
    gotInitiate = true
  })
  await emitAsync(a1, 'channel', 'A')
  await emitAsync(a2, 'channel', 'A')
  await poll(() => gotInitiate)
  t.pass('got initiate')
})

test('invalid channelId', async t => {
  const a1 = await getClientAsync()
  const error = await t.throwsAsync(() => emitAsync(a1, 'channel', '%'))
  t.truthy(/^invalid channel/.test(error.message))
})

test('max two clients per channel', async t => {
  const [a1, a2, a3] = await Promise.all([
    getClientAsync(),
    getClientAsync(),
    getClientAsync()
  ])
  await emitAsync(a1, 'channel', 'A')
  await emitAsync(a2, 'channel', 'A')
  const error = await t.throwsAsync(() => emitAsync(a3, 'channel', 'A'))
  t.is(error.message, 'max clients reached for channel A')
})

test('proxies signals', async t => {
  let gotInitiate
  const [a1, a2] = await Promise.all([getClientAsync(), getClientAsync()])
  a1.on('initiate', channelId => {
    gotInitiate = channelId === 'A'
  })
  await emitAsync(a1, 'channel', 'A')
  await emitAsync(a2, 'channel', 'A')
  await poll(() => gotInitiate)

  let received
  a2.on('signal', ({ channelId, data }) => {
    a2.emit('signal', { channelId, data: data + 'bar' })
  })
  a1.on('signal', ({ channelId, data }) => {
    received = data
  })
  a1.emit('signal', { channelId: 'A', data: 'foo' })
  await poll(() => !!received)

  t.is(received, 'foobar')
})

test('multiple channels', async t => {
  let gotInitiateA, gotInitiateB
  const [ab1, a2, b2] = await Promise.all([
    getClientAsync(),
    getClientAsync(),
    getClientAsync()
  ])
  ab1.on('initiate', channelId => {
    if (channelId === 'A') gotInitiateA = true
    if (channelId === 'B') gotInitiateB = true
  })
  await emitAsync(ab1, 'channel', 'A')
  await emitAsync(ab1, 'channel', 'B')
  await emitAsync(a2, 'channel', 'A')
  await emitAsync(b2, 'channel', 'B')
  await poll(() => gotInitiateA && gotInitiateB)

  let signalA, signalB
  a2.on('signal', x => {
    signalA = x.channelId === 'A' && x.data
  })
  b2.on('signal', x => {
    signalB = x.channelId === 'B' && x.data
  })
  ab1.emit('signal', { channelId: 'A', data: 'sigA' })
  ab1.emit('signal', { channelId: 'B', data: 'sigB' })
  await poll(() => signalA && signalB)
  t.is(signalA, 'sigA')
  t.is(signalB, 'sigB')
})

function getClientAsync () {
  const socket = io(fixture.getServerUrl())
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket))
    socket.on('error', e => reject(new Error(e)))
  })
}

function emitAsync (client, event, data) {
  return new Promise((resolve, reject) => {
    client.emit(event, data, err => {
      if (err) reject(new Error(err))
      else resolve()
    })
  })
}
