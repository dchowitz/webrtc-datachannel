var debug = require('debug')('server')
var socketIo = require('socket.io')

module.exports = function signalServer (serverToBind) {
  const peerIds = {} // dictionary by socket.id

  const io = socketIo(serverToBind)

  io.on('connection', socket => {
    const peerId = socket.handshake.query.peerId
    debug('new connection', socket.id, 'for peer', peerId)
    peerIds[socket.id] = peerId

    // let all know of connected peers
    socket.broadcast.emit('peers', getPeerIds())
    socket.emit('peers', getPeerIds())

    socket.on('signal', function (data) {
      var receiverSocket = getSocketId(data.peerId) // TODO rename data.to
      if (!receiverSocket) {
        // TODO let the sender know, that there is no peer (do we need a retry in getSocketId?)
        return
      }
      debug('proxying signal from peer %s to %s', peerId, data.peerId)
      debug(data.signal)

      receiverSocket.emit('signal', {
        signal: data.signal,
        peerId: peerId // TODO rename from
      })
    })

    socket.on('disconnect', () => {
      debug('disconnect', socket.id, '(peer', peerIds[socket.id], ')')
      delete peerIds[socket.id]

      // let others know of connected peers
      socket.broadcast.emit('peers', getPeerIds())
    })
  })

  function getPeerIds () {
    return Object.keys(peerIds).map(socketId => peerIds[socketId])
  }

  function getSocketId (peerId) {
    var socketId = Object.keys(peerIds).find(
      socketId => peerIds[socketId] === peerId
    )
    return socketId && io.sockets.connected[socketId]
  }
}
