const test = require('ava')
const wrtc = require('wrtc')
const fixture = require('./signal-server.fixture')(test)
const dataChannel = require('./dataChannel')

test('creates datachannel', async t => {
  const dc = await dataChannel('A', config())
  t.truthy(dc)
})

test('requires peerId', async t => {
  const error = await t.throwsAsync(dataChannel())
  t.is(error.message, 'peerId required')
})

test('alphanumeric peerId', async t => {
  const error = await t.throwsAsync(dataChannel('#'))
  t.is(error.message, 'peerId must be alphanumeric')
})

test('requires config.wrtc', async t => {
  const error = await t.throwsAsync(
    dataChannel('A', { signalServer: fixture.getServerUrl() })
  )
  t.is(error.message, 'config.wrtc required')
})

test('requires config.signalServer', async t => {
  const error = await t.throwsAsync(dataChannel('A', { wrtc }))
  t.is(error.message, 'config.signalServer required')
})

function config () {
  return { wrtc, signalServer: fixture.getServerUrl() }
}
