/*
This demonstrates the setup of a WebRTC data channel with a real signaling server.
Based on https://github.com/webrtc/samples/blob/gh-pages/src/content/datachannel/datatransfer/js/main.js
*/

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

  const peer1 = { id: 'A' }
  peer1.socket = io('http://localhost:' + port + '?peerId=' + peer1.id)

  const peer2 = { id: 'B' }
  peer2.socket = io('http://localhost:' + port + '?peerId=' + peer2.id)

  await Promise.all([
    new Promise(resolve => peer1.socket.on('connect', resolve)),
    new Promise(resolve => peer2.socket.on('connect', resolve))
  ])

  debug('peer1 connected to socket', peer1.id)
  debug('peer2 connected to socket', peer2.id)

  peer1.socket.on('signal', async data => {
    if (data.signal.answer) {
      debug('peer1 got answer')
      peer1.connection.setRemoteDescription(data.signal.answer)
    } else if (data.signal.candidate) {
      try {
        await peer1.connection.addIceCandidate(data.signal.candidate)
      } catch (e) {
        debug('peer1 failed to add ICE candidate', e)
      }
    } else {
      debug('peer1 got unknown signal', data.signal)
    }
  })

  peer2.socket.on('signal', async data => {
    if (data.signal.offer) {
      debug('peer2 got offer')
      peer2.connection.setRemoteDescription(data.signal.offer)
      const answer = await peer2.connection.createAnswer()
      peer2.connection.setLocalDescription(answer)
      peer2.socket.emit('signal', {
        to: peer1.id,
        signal: { answer }
      })
    } else if (data.signal.candidate) {
      try {
        await peer2.connection.addIceCandidate(data.signal.candidate)
      } catch (e) {
        debug('peer2 failed to add ICE candidate', e)
      }
    } else {
      debug('peer2 got unknown signal', data.signal)
    }
  })

  peer1.connection = new wrtc.RTCPeerConnection(rtcConfig)
  debug('peer1 has RTCPeerConnection')

  peer1.channel = peer1.connection.createDataChannel({ ordered: true })
  peer1.channel.binaryType = 'arraybuffer'
  debug('peer1 has data channel')

  peer1.channel.addEventListener('open', () => {
    debug('peer1 channel state:', peer1.channel.readyState)
    debug('peer1 connection', {
      localDescription: peer1.connection.currentLocalDescription,
      remoteDescription: peer1.connection.currentRemoteDescription,
      iceConnectionState: peer1.connection.iceConnectionState,
      connectionState: peer1.connection.connectionState,
      signalingState: peer1.connection.signalingState
    })
  })

  peer1.channel.addEventListener('close', () =>
    debug('peer1 channel state:', peer1.channel.readyState)
  )

  peer1.channel.addEventListener('error', e => debug('peer1 channel error:', e))

  peer1.connection.addEventListener('icecandidate', async event => {
    const candidate = event.candidate
    debug('peer1 ICE candidate:', candidate)
    if (candidate === null) {
      return
    }
    peer1.socket.emit('signal', {
      to: peer2.id,
      signal: { candidate }
    })
  })

  peer2.connection = new wrtc.RTCPeerConnection(rtcConfig)
  debug('peer2 has RTCPeerConnection')

  peer2.connection.addEventListener('icecandidate', async event => {
    const candidate = event.candidate
    debug('peer2 ICE candidate:', candidate)
    if (candidate === null) {
      return
    }
    peer2.socket.emit('signal', {
      to: peer1.id,
      signal: { candidate }
    })
  })

  peer2.connection.addEventListener('datachannel', event => {
    debug('peer2 received channel callback')
    const channel = event.channel
    channel.binaryType = 'arraybuffer'
    channel.addEventListener('close', () => debug('peer2 channel closed'))
    channel.addEventListener('message', () =>
      debug('peer2 got channel message')
    )

    debug('peer2 connection', {
      localDescription: peer2.connection.currentLocalDescription,
      remoteDescription: peer2.connection.currentRemoteDescription,
      iceConnectionState: peer2.connection.iceConnectionState,
      connectionState: peer2.connection.connectionState,
      signalingState: peer2.connection.signalingState
    })
  })

  // peer1 is initiator for channel setup

  const offer = await peer1.connection.createOffer()
  peer1.connection.setLocalDescription(offer)
  debug('peer1 got offer:', offer)

  peer1.socket.emit('signal', {
    to: peer2.id,
    signal: { offer }
  })

  // waiting for established data channel

  await value(
    () => peer2.connection && peer2.connection.connectionState === 'connected'
  )
})()
  .then(() => process.exit(0))
  .catch(e => {
    debug(e)
    process.exit(1)
  })

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
