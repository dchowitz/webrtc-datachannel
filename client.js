const debug = require('debug')('client')
const io = require('socket.io-client')

const socket = io('http://localhost:3333/')

let firstPeer = false

;(async () => {
  await new Promise(resolve => socket.on('connect', resolve))
  debug(socket.id, 'connected to signal-server')
  socket.on('disconnect', () => debug('disconnected'))
  socket.on('peers', peers => {
    debug(peers)
    firstPeer = firstPeer || peers.length === 1
    if (firstPeer && peers.length > 1) {
      socket.emit('signal', { peerId: peers[1], signal: 'he' })
    }
  })
  socket.on('signal', data => {
    debug('got signal', data.peerId, data.signal)
    if (!firstPeer) {
      socket.emit('signal', { peerId: data.peerId, signal: 'ho' })
    }
  })
})().catch(e => debug(e))
