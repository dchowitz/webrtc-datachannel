const test = require('ava')
const wrtc = require('wrtc')
const fixture = require('./signal-server.fixture')(test)
const dataChannel = require('./dataChannel')
const { poll } = require('./util')

test('short string', async t => {
  let msg
  await (await Promise.all([
    dataChannel('A', config()),
    dataChannel('A', config(), data => {
      msg = data
    })
  ]))[0].sendAsync('hi')
  await poll(() => !!msg)
  t.is(msg, 'hi')
})

test('max size string', async t => {
  const expectedMsg = 'x'.repeat(65536)
  let actualMsg
  await (await Promise.all([
    dataChannel('A', config()),
    dataChannel('A', config(), data => {
      actualMsg = data
    })
  ]))[0].sendAsync(expectedMsg)
  await poll(() => !!actualMsg)
  t.is(actualMsg, expectedMsg)
})

test('rejects string > 64 Kb', async t => {
  const client = (await Promise.all([
    dataChannel('A', config()),
    dataChannel('A', config())
  ]))[0]
  const error = await t.throwsAsync(async () =>
    client.sendAsync('x'.repeat(65537))
  )
  t.is(
    error.message,
    'message too big, allowed are 65536 bytes, but message has 65537 bytes'
  )
})

test('send Buffer', async t => {
  const buffer = getBuffer(65536, 42)
  let received
  const client = (await Promise.all([
    dataChannel('A', config()),
    dataChannel('A', config(), data => {
      received = data
    })
  ]))[0]
  await client.sendAsync(buffer)
  await poll(() => !!received)
  t.true(received instanceof ArrayBuffer)
  t.is(received.byteLength, 65536)
  t.is(new Uint8Array(received)[0], 42)
})

test('send typed array', async t => {
  const array = new Uint8Array(65536)
  array.fill(42)
  let received
  const client = (await Promise.all([
    dataChannel('A', config()),
    dataChannel('A', config(), data => {
      received = data
    })
  ]))[0]
  await client.sendAsync(array)
  await poll(() => !!received)
  t.true(received instanceof ArrayBuffer)
  t.is(received.byteLength, 65536)
  t.is(new Uint8Array(received)[0], 42)
})

test('rejects buffer > 64 Kb', async t => {
  const client = (await Promise.all([
    dataChannel('A', config()),
    dataChannel('A', config())
  ]))[0]

  const error = await t.throwsAsync(async () =>
    client.sendAsync(getBuffer(65537, 42))
  )
  t.is(
    error.message,
    'message too big, allowed are 65536 bytes, but message has 65537 bytes'
  )
})

function config () {
  return { wrtc, signalServerUrl: fixture.getServerUrl() }
}

function getBuffer (size, byte) {
  const data = new Uint8Array(size)
  data.fill(byte)
  return Buffer.from(data)
}
