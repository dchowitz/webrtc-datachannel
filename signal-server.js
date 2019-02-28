var debug = require('debug')('server')
var socketIo = require('socket.io')

module.exports = function signalServer (serverToBind) {
  const io = socketIo(serverToBind)

  io.on('connection', socket => {
    debug('new connection', socket.id)

    // let all know of connected peers
    socket.broadcast.emit('peers', Object.keys(io.sockets.connected))
    socket.emit('peers', Object.keys(io.sockets.connected))

    socket.on('signal', function (data) {
      var receiver = io.sockets.connected[data.peerId]
      if (!receiver) {
        return
      }
      debug('proxying signal from peer %s to %s', socket.id, receiver.id)
      debug(data.signal)

      receiver.emit('signal', {
        signal: data.signal,
        peerId: socket.id
      })
    })

    socket.on('disconnect', () => {
      debug('disconnect', socket.id)

      // let others know of connected peers
      socket.broadcast.emit('peers', Object.keys(io.sockets.connected))
    })
  })
}
