const getPort = require('get-port')
const server = require('http').createServer()
require('./signal-server')(server)

const wrtc = require('wrtc')
const debug = require('debug')('test')
const io = require('socket.io-client')

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
  const B = await dataChannel({ signalServer })

  await A.initiate(B.getId())
})()
  .then(() => process.exit(0))
  .catch(e => {
    debug(e)
    process.exit(1)
  })

async function dataChannel (config) {
  let myId, peerId, connection, channel
  const socket = io(config.signalServer)

  await new Promise(resolve => socket.on('connect', resolve))
  myId = socket.id

  socket.on('signal', async data => {
    if (data.signal.offer) {
      debug(myId, 'got offer signal')
      peerId = data.peerId
      connection.setRemoteDescription(data.signal.offer)
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
        channelState: channel.readyState
      })
    })
    channel.addEventListener('close', () =>
      debug(myId, 'channel state:', channel.readyState)
    )
    channel.addEventListener('error', e => debug(myId, 'channel error:', e))
    channel.addEventListener('message', data => {
      debug(myId, 'got channel message', data)
    })
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
