const getPort = require('get-port')
const server = require('http').createServer()
require('./signal-server')(server)

const wrtc = require('wrtc')
const debug = require('debug')('test')
const io = require('socket.io-client')

const noop = () => {}

let A, B

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: process.env.turnserver,
      username: process.env.turnuser,
      credential: process.env.turnpassword
    }
  ]
}

;(async () => {
  const port = await getPort()
  await new Promise(resolve => server.listen(port, resolve))
  const signalServer = 'http://localhost:' + port

  const bytesSent = {}
  const bytesReceived = {}
  let message = 0
  const maxkB = 64
  const sendDelayMs = 0

  A = await dataChannel('A', { signalServer })
  B = await dataChannel('B', { signalServer }, data => {
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
  await value(
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

async function dataChannel (localPeerId, config, onData = noop) {
  const MAX_MESSAGE_SIZE = 64 * 1024
  const HIGH_WATERMARK = 1024 * 1024
  const messageQueue = [] // of type {data, lengthInBytes, resolve, reject}
  const localId = localPeerId
  let remoteId, connection, channel, remoteMaxMessageSize
  const socket = io(config.signalServer, { query: { peerId: localId } })

  await new Promise(resolve => socket.on('connect', resolve)) // TODO respect nodejs callback semantics

  socket.on('signal', async data => {
    if (data.signal.offer) {
      debug(localId, 'got offer signal')
      remoteId = data.from
      connection.setRemoteDescription(data.signal.offer)
      extractRemoteMaxMessageSize(data.signal.offer)
      try {
        const answer = await connection.createAnswer()
        connection.setLocalDescription(answer)
        socket.emit('signal', {
          to: remoteId,
          signal: { answer }
        })
      } catch (e) {
        debug(localId, 'failed to set local description', e)
      }
    } else if (data.signal.answer) {
      debug(localId, 'got answer signal')
      try {
        connection.setRemoteDescription(data.signal.answer)
      } catch (e) {
        debug(localId, 'failed to set remote description', e)
      }
      extractRemoteMaxMessageSize(data.signal.answer)
    } else if (data.signal.candidate) {
      debug(localId, 'got candidate signal')
      try {
        await connection.addIceCandidate(data.signal.candidate)
      } catch (e) {
        debug(localId, 'failed to add ICE candidate', e)
      }
    } else {
      debug(localId, 'got unknown signal', data.signal)
    }
  })

  connection = new wrtc.RTCPeerConnection(rtcConfig)
  connection.addEventListener('icecandidate', async event => {
    const candidate = event.candidate
    debug(localId, 'got ICE candidate:', candidate)
    if (candidate === null) {
      return
    }
    socket.emit('signal', {
      to: remoteId,
      signal: { candidate }
    })
  })
  connection.addEventListener('datachannel', event => {
    debug(localId, 'received channel callback')
    channel = event.channel
    setupChannel()
  })

  return {
    async connect (othersPeerId) {
      remoteId = othersPeerId
      channel = connection.createDataChannel({ ordered: true })
      channel.binaryType = 'arraybuffer'
      setupChannel()

      const offer = await connection.createOffer()
      connection.setLocalDescription(offer)
      debug(localId, 'got offer')
      socket.emit('signal', {
        to: remoteId,
        signal: { offer }
      })

      await value(
        () => connection && connection.connectionState === 'connected'
      )
    },
    async ready () {
      await value(
        () => connection && connection.connectionState === 'connected'
      )
    },
    send (message) {
      try {
        debug(localId, 'bufferedAmount before send:', channel.bufferedAmount)
        channel.send(message)
        setTimeout(
          // give chance to update bufferedAmount async
          () =>
            debug(
              localId,
              'bufferedAmount after send:',
              channel.bufferedAmount
            ),
          0
        )
        return true
      } catch (e) {
        debug(localId, 'sending message failed', e)
        debugState()
        return false
      }
    },
    sendAsync (message) {
      const lengthInBytes = validateMessage(message)
      return new Promise((resolve, reject) => {
        messageQueue.push({ data: message, lengthInBytes, resolve, reject })
        return sendAsyncInternal()
      })
    },
    debugState () {
      debugState()
    }
  }

  async function sendAsyncInternal () {
    const message = messageQueue.shift()
    if (!message) {
      debug(localId, 'message queue is empty')
      return
    }
    const { data, lengthInBytes, resolve, reject } = message

    // TODO check connection state and maybe signaling state too
    if (channel.readyState !== 'open') {
      await value(() => channel.readyState === 'open')
    }
    if (channel.readyState !== 'open') {
      // TODO try to create a new datachannel
      reject(new Error('datachannel is not open'))
    }

    // see sendData() in https://github.com/webrtc/samples/blob/gh-pages/src/content/datachannel/datatransfer/js/main.js
    let bufferedAmount = channel.bufferedAmount
    bufferedAmount += lengthInBytes
    if (bufferedAmount >= HIGH_WATERMARK) {
      // since event onbufferedamountlow is not fired, we retry after some delay
      // 100 ms worked well during tests
      setTimeout(() => sendAsyncInternal(), 100)
      debug(
        localId,
        `did custom delay, bufferedAmount: ${bufferedAmount} (announced: ${
          channel.bufferedAmount
        })`
      )
      messageQueue.unshift(message) // back into the queue
      return
    }

    try {
      channel.send(data)
      resolve()
    } catch (e) {
      reject(e)
    }
  }

  function setupChannel () {
    channel.bufferedAmountLowThreshold = MAX_MESSAGE_SIZE

    channel.addEventListener('bufferedamountlow', e => {
      // didn't see this fired, but leave it here, doesn't hurt
      debug(localId, 'bufferedamountlow event', e)
      sendAsyncInternal()
    })
    channel.addEventListener('open', debugState)
    channel.addEventListener('close', debugState)
    channel.addEventListener('error', e => {
      debug(localId, 'channel error:', e)
      debugState()
    })
    channel.addEventListener('message', message => {
      // debug(myId, 'got channel message')
      onData(message.data)
    })
  }

  function debugState () {
    debug(localId, 'state', {
      channelId: channel.id,
      // localDescription: connection.currentLocalDescription,
      // remoteDescription: connection.currentRemoteDescription,
      iceConnectionState: connection.iceConnectionState,
      connectionState: connection.connectionState,
      signalingState: connection.signalingState,
      channelState: channel.readyState,
      channelBufferedAmount: channel.bufferedAmount,
      sctpMaxMessageSize: connection.sctp && connection.sctp.maxMessageSize,
      remoteMaxMessageSize
    })
  }

  // from: https://blog.mozilla.org/webrtc/large-data-channel-messages/
  function extractRemoteMaxMessageSize (description) {
    remoteMaxMessageSize = 65535
    try {
      const match = description.sdp.match(/a=max-message-size:\s*(\d+)/)
      if (match !== null && match.length >= 2) {
        remoteMaxMessageSize = parseInt(match[1])
        debug(localId, 'got remoteMaxMessageSize from sdp prop')
      }
    } catch (e) {
      debug(
        localId,
        'failed to extract remoteMaxMessageSize from',
        description,
        'error:',
        e
      )
    }
  }

  function validateMessage (msg) {
    if (!msg) return
    let msgLength

    if (typeof msg === 'string') {
      msgLength = getStringByteLength(msg)
    } else if (
      // checks for Buffer, ArrayBuffer and typed arrays
      msg instanceof Buffer ||
      msg instanceof ArrayBuffer ||
      msg.buffer instanceof ArrayBuffer
    ) {
      msgLength = msg.byteLength
    } else {
      throw new Error('unknown type of message')
    }

    if (msgLength > MAX_MESSAGE_SIZE) {
      throw new Error(
        `message too big, allowed are ${MAX_MESSAGE_SIZE} bytes, but message has ${msgLength} bytes`
      )
    }

    return msgLength
  }
}

function value (checkFn, timeout = 5000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    let handle = setInterval(() => {
      const elapsed = Date.now() - start
      if (checkFn()) {
        clearInterval(handle)
        debug(`resolve value after ${elapsed} ms`)
        resolve()
      }
      if (elapsed > timeout) {
        clearInterval(handle)
        reject(new Error('timeout'))
      }
    }, 100)
  })
}

// from: https://codereview.stackexchange.com/questions/37512/count-byte-length-of-string
function getStringByteLength (str) {
  str = String(str)
  let len = 0
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    len +=
      c < 1 << 7
        ? 1
        : c < 1 << 11
          ? 2
          : c < 1 << 16
            ? 3
            : c < 1 << 21
              ? 4
              : c < 1 << 26
                ? 5
                : c < 1 << 31
                  ? 6
                  : Number.NaN
  }
  return len
}
