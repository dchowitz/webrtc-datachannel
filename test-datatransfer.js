const getPort = require('get-port')
const server = require('http').createServer()
require('./signal-server')(server)

const wrtc = require('wrtc')
const debug = require('debug')('test')
const io = require('socket.io-client')

const noop = () => {}

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

  const messagesSent = {}
  const messagesReceived = {}

  const A = await dataChannel({ signalServer })
  const B = await dataChannel({ signalServer }, data => {
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
      messagesReceived[message] = (messagesReceived[message] || 0) + length
      debug('B got ArrayBuffer with', length, 'bytes from message', message)
    } else {
      debug('B got unknown type of data', data)
    }
  })

  await A.initiate(B.getId())

  debug('A sends short string message')

  A.send('hi from A')

  debug('A sends large string message')

  A.send('x'.repeat(1024 * 1024))

  debug('sending typed arrays of increasing size')

  let message = 0
  let kbyte = 1
  let finished = false

  setInterval(() => {
    const size = kbyte * 1024
    const data = new Uint8Array(size)
    data.fill(message)
    debug('A sends message', message, 'with', size, 'bytes')
    A.send(data)
    messagesSent[message] = size
    kbyte = kbyte * 2
    message++
    finished = kbyte > 1024
  }, 500)

  await value(() => finished, 100000)

  debug('sending buffers of increasing size')

  kbyte = 1
  finished = false

  setInterval(() => {
    const size = kbyte * 1024
    const data = new Uint8Array(size)
    data.fill(message)
    debug('A sends message', message, 'with', size, 'bytes')
    A.send(Buffer.from(data))
    messagesSent[message] = size
    kbyte = kbyte * 2
    message++
    finished = kbyte > 1024
  }, 500)

  await value(() => finished, 100000)

  // give messages chance to arrive
  await new Promise(resolve => setTimeout(resolve, 1000))

  Object.keys(messagesSent).forEach(msg => {
    debug(
      'msg',
      msg,
      'received',
      messagesSent[msg] === messagesReceived[msg] ? 'complete' : 'incomplete'
    )
  })
})()
  .then(() => process.exit(0))
  .catch(e => {
    debug(e)
    process.exit(1)
  })

async function dataChannel (config, onData = noop) {
  let localId, remoteId, connection, channel, remoteMaxMessageSize
  const socket = io(config.signalServer)

  await new Promise(resolve => socket.on('connect', resolve))
  localId = socket.id

  socket.on('signal', async data => {
    if (data.signal.offer) {
      debug(localId, 'got offer signal')
      remoteId = data.peerId
      connection.setRemoteDescription(data.signal.offer)
      extractRemoteMaxMessageSize(data.signal.offer)
      try {
        const answer = await connection.createAnswer()
        connection.setLocalDescription(answer)
        socket.emit('signal', {
          peerId: data.peerId,
          signal: { answer }
        })
      } catch (e) {
        debug(localId, 'failed to set local description', e)
      }
    } else if (data.signal.answer) {
      debug(localId, 'got answer signal')
      try {
        connection.setRemoteDescription(data.signal.answer)
        extractRemoteMaxMessageSize(data.signal.offer)
      } catch (e) {
        debug(localId, 'failed to set remote description', e)
      }
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
      peerId: remoteId,
      signal: { candidate }
    })
  })
  connection.addEventListener('datachannel', event => {
    debug(localId, 'received channel callback')
    channel = event.channel
    setupChannelListeners()
  })

  return {
    getId () {
      return localId
    },
    async initiate (othersPeerId) {
      remoteId = othersPeerId
      channel = connection.createDataChannel({ ordered: true })
      channel.binaryType = 'arraybuffer'
      setupChannelListeners()

      const offer = await connection.createOffer()
      connection.setLocalDescription(offer)
      debug(localId, 'got offer')
      socket.emit('signal', {
        peerId: remoteId,
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
        channel.send(message)
      } catch (e) {
        debug(localId, 'sending message failed', e)
      }
    }
  }

  function setupChannelListeners () {
    channel.addEventListener('open', () => {
      debug(localId, 'state', {
        localDescription: connection.currentLocalDescription,
        remoteDescription: connection.currentRemoteDescription,
        iceConnectionState: connection.iceConnectionState,
        connectionState: connection.connectionState,
        signalingState: connection.signalingState,
        channelState: channel.readyState,
        sctpMaxMessageSize: connection.sctp && connection.sctp.maxMessageSize,
        remoteMaxMessageSize
      })
    })
    channel.addEventListener('close', () =>
      debug(localId, 'channel state:', channel.readyState)
    )
    channel.addEventListener('error', e => debug(localId, 'channel error:', e))
    channel.addEventListener('message', message => {
      // debug(myId, 'got channel message')
      onData(message.data)
    })
  }

  // from: https://blog.mozilla.org/webrtc/large-data-channel-messages/
  function extractRemoteMaxMessageSize (description) {
    remoteMaxMessageSize = 65535
    const match = description.sdp.match(/a=max-message-size:\s*(\d+)/)
    if (match !== null && match.length >= 2) {
      remoteMaxMessageSize = parseInt(match[1])
    }
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
