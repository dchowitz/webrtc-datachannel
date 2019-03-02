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
      debug(
        'B got ArrayBuffer with',
        data.byteLength,
        'bytes from message',
        view[0]
      )
    } else {
      debug('B got unknown type of data', data)
    }
  })

  await A.initiate(B.getId())

  // send short string message

  A.send('hi from A')

  // send large string message

  A.send('x'.repeat(1024 * 1024))

  // sending typed arrays of increasing size

  let message = 1
  let kbyte = 1
  let finished = false

  setInterval(() => {
    const data = new Uint8Array(kbyte * 1024)
    data.fill(message)
    A.send(data)
    kbyte = kbyte * 2
    message++
    finished = kbyte > 1024
  }, 500)

  await value(() => finished, 100000)

  // sending buffers of increasing size

  message = 1
  kbyte = 1
  finished = false

  setInterval(() => {
    const data = new Uint8Array(kbyte * 1024)
    data.fill(message)
    A.send(Buffer.from(data))
    kbyte = kbyte * 2
    message++
    finished = kbyte > 1024
  }, 500)

  await value(() => finished, 100000)
})()
  .then(() => process.exit(0))
  .catch(e => {
    debug(e)
    process.exit(1)
  })

// todo adjust wording/prefixes: my -> local, peer/other... -> remote
async function dataChannel (config, onData = noop) {
  let myId, peerId, connection, channel, remoteMaxMessageSize
  const socket = io(config.signalServer)

  await new Promise(resolve => socket.on('connect', resolve))
  myId = socket.id

  socket.on('signal', async data => {
    if (data.signal.offer) {
      debug(myId, 'got offer signal')
      peerId = data.peerId
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
        debug(myId, 'failed to set local description', e)
      }
    } else if (data.signal.answer) {
      debug(myId, 'got answer signal')
      try {
        connection.setRemoteDescription(data.signal.answer)
        extractRemoteMaxMessageSize(data.signal.offer)
      } catch (e) {
        debug(myId, 'failed to set remote description', e)
      }
    } else if (data.signal.candidate) {
      debug(myId, 'got candidate signal')
      try {
        await connection.addIceCandidate(data.signal.candidate)
      } catch (e) {
        debug(myId, 'failed to add ICE candidate', e)
      }
    } else {
      debug(myId, 'got unknown signal', data.signal)
    }
  })

  connection = new wrtc.RTCPeerConnection(rtcConfig)
  connection.addEventListener('icecandidate', async event => {
    const candidate = event.candidate
    debug(myId, 'got ICE candidate:', candidate)
    if (candidate === null) {
      return
    }
    socket.emit('signal', {
      peerId: peerId,
      signal: { candidate }
    })
  })
  connection.addEventListener('datachannel', event => {
    debug(myId, 'received channel callback')
    channel = event.channel
    setupChannelListeners()
  })

  return {
    getId () {
      return myId
    },
    async initiate (othersPeerId) {
      peerId = othersPeerId
      channel = connection.createDataChannel({ ordered: true })
      channel.binaryType = 'arraybuffer'
      setupChannelListeners()

      const offer = await connection.createOffer()
      connection.setLocalDescription(offer)
      debug(myId, 'got offer')
      socket.emit('signal', {
        peerId: peerId,
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
        debug(myId, 'sending message failed', e)
      }
    }
  }

  function setupChannelListeners () {
    channel.addEventListener('open', () => {
      debug(myId, 'state', {
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
      debug(myId, 'channel state:', channel.readyState)
    )
    channel.addEventListener('error', e => debug(myId, 'channel error:', e))
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
