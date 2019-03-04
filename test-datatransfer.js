const debug = require('debug')('test')
const getPort = require('get-port')
const wrtc = require('wrtc')
const server = require('http').createServer()
require('./signal-server')(server)
const dataChannel = require('./dataChannel')
const { poll } = require('./util')

let A, B
;(async () => {
  const port = await getPort()
  await new Promise(resolve => server.listen(port, resolve))
  const signalServer = 'http://localhost:' + port

  const bytesSent = {}
  const bytesReceived = {}
  let message = 0
  const maxkB = 64
  const sendDelayMs = 0

  A = await dataChannel('A', { signalServer, wrtc })
  B = await dataChannel('B', { signalServer, wrtc }, data => {
    if (typeof data === 'string') {
      if (data.length < 100) {
        debug('B got short string', data)
      } else {
        debug(
          'B got long string of',
          data.length,
          'characters containing',
          data[0]
        )
      }
    } else if (
      data instanceof ArrayBuffer ||
      toString.call(data) === '[object ArrayBuffer]'
    ) {
      const view = new Uint8Array(data)
      const message = view[0]
      const length = data.byteLength
      bytesReceived[message] = (bytesReceived[message] || 0) + length
      debug('B got ArrayBuffer with', length, 'bytes from message', message)
    } else {
      debug('B got unknown type of data', data)
    }
  })

  await A.connect('B')

  debug('A sends short string message')
  A.send('hi from A')

  debug('A sends large string message')
  A.send('x'.repeat(16 * 1024 * 1024))

  debug('sending typed arrays of increasing size')
  await new Promise((resolve, reject) => {
    let kbyte = 1
    const timer = setInterval(() => {
      const size = kbyte * 1024
      const data = new Uint8Array(size)
      data.fill(message)
      debug('A sends message', message, 'with', size, 'bytes')
      if (!A.send(data)) {
        clearInterval(timer)
        reject(new Error('send failed'))
      }
      bytesSent[message] = size
      kbyte = kbyte * 2
      message++
      if (kbyte > maxkB) {
        clearInterval(timer)
        resolve()
      }
    }, sendDelayMs)
  })

  debug('sending buffers of increasing size')
  await new Promise((resolve, reject) => {
    let kbyte = 1
    const timer = setInterval(() => {
      const size = kbyte * 1024
      const data = new Uint8Array(size)
      data.fill(message)
      debug('A sends message', message, 'with', size, 'bytes')
      if (!A.send(Buffer.from(data))) {
        clearInterval(timer)
        reject(new Error('send failed'))
      }
      bytesSent[message] = size
      kbyte = kbyte * 2
      message++
      if (kbyte > maxkB) {
        clearInterval(timer)
        resolve()
      }
    }, sendDelayMs)
  })

  // wait for last message
  await poll(
    () =>
      !!bytesSent[message - 1] &&
      bytesSent[message - 1] === bytesReceived[message - 1],
    60 * 1000
  )

  Object.keys(bytesSent).forEach(msg => {
    debug(
      'msg',
      msg,
      'transferred',
      bytesSent[msg] === bytesReceived[msg] ? 'complete' : 'incomplete'
    )
  })

  debug('sending with sendAsync()')
  do {
    const size = 32 * 1024 + Math.floor(Math.random() * 32 * 1024)
    const data = new Uint8Array(size)
    debug('A sends message with', size, 'bytes')
    await A.sendAsync(data)
  } while (true)
})()
  .then(() => process.exit(0))
  .catch(e => {
    debug(e)
    A.debugState()
    B.debugState()
    process.exit(1)
  })
