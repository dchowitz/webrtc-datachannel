const test = require('ava')
const wrtc = require('wrtc')
const fixture = require('./signal-server.fixture')(test)
const dataChannel = require('./dataChannel')

test('creates datachannel', async t => {
  await Promise.all([dataChannel('A', config()), dataChannel('A', config())])
  t.pass()
})

test('requires channelId', t => {
  const error = t.throws(() => dataChannel())
  t.is(error.message, 'channelId required')
})

test('alphanumeric channelId', t => {
  const error = t.throws(() => dataChannel('#'))
  t.is(error.message, 'channelId must be alphanumeric')
})

test('requires config.wrtc', t => {
  const error = t.throws(() =>
    dataChannel('A', { signalServerUrl: fixture.getServerUrl() })
  )
  t.is(error.message, 'config.wrtc required')
})

test('requires config.signalServerUrl', t => {
  const error = t.throws(() => dataChannel('A', { wrtc }))
  t.is(error.message, 'config.signalServerUrl required')
})

function config () {
  return { wrtc, signalServerUrl: fixture.getServerUrl() }
}
