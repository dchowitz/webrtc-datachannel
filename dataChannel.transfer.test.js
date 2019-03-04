const test = require('ava')
const wrtc = require('wrtc')
const fixture = require('./signal-server.fixture')(test)
const dataChannel = require('./dataChannel')
const { poll } = require('./util')

// TODO a.connect('unknown peerId') does not fail

test('short string', async t => {
  let msg
  const a = await dataChannel('a', config())
  await dataChannel('b', config(), data => {
    msg = data
  })
  await a.connect('b')
  await a.sendAsync('hi from a')
  await poll(() => !!msg)
  t.is(msg, 'hi from a')
})

test('max size string', async t => {
  const expectedMsg = 'x'.repeat(65536)
  let actualMsg
  const a = await dataChannel('a', config())
  await dataChannel('b', config(), data => {
    actualMsg = data
  })
  await a.connect('b')
  await a.sendAsync(expectedMsg)
  await poll(() => !!actualMsg)
  t.is(actualMsg, expectedMsg)
})

test('rejects string > 64 Kb', async t => {
  const a = await dataChannel('a', config())
  await dataChannel('b', config())
  await a.connect('b')
  const error = await t.throwsAsync(async () => a.sendAsync('x'.repeat(65537)))
  t.is(
    error.message,
    'message too big, allowed are 65536 bytes, but message has 65537 bytes'
  )
})

test('send Buffer', async t => {
  const buffer = getBuffer(65536, 42)
  let received
  const a = await dataChannel('a', config())
  await dataChannel('b', config(), data => {
    received = data
  })
  await a.connect('b')
  await a.sendAsync(buffer)
  await poll(() => !!received)
  t.true(received instanceof ArrayBuffer)
  t.is(received.byteLength, 65536)
  t.is(new Uint8Array(received)[0], 42)
})

test('send typed array', async t => {
  const array = new Uint8Array(65536)
  array.fill(42)
  let received
  const a = await dataChannel('a', config())
  await dataChannel('b', config(), data => {
    received = data
  })
  await a.connect('b')
  await a.sendAsync(array)
  await poll(() => !!received)
  t.true(received instanceof ArrayBuffer)
  t.is(received.byteLength, 65536)
  t.is(new Uint8Array(received)[0], 42)
})

test('rejects buffer > 64 Kb', async t => {
  const a = await dataChannel('a', config())
  await dataChannel('b', config())
  await a.connect('b')
  const error = await t.throwsAsync(async () =>
    a.sendAsync(getBuffer(65537, 42))
  )
  t.is(
    error.message,
    'message too big, allowed are 65536 bytes, but message has 65537 bytes'
  )
})

function config () {
  return { wrtc, signalServer: fixture.getServerUrl() }
}

function getBuffer (size, byte) {
  const data = new Uint8Array(size)
  data.fill(byte)
  return Buffer.from(data)
}
