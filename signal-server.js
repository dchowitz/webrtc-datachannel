var debug = require('debug')('server')
var socketIo = require('socket.io')

module.exports = function signalServer (serverToBind) {
  const io = socketIo(serverToBind)

  io.on('connection', socket => {
    debug('new connection', socket.id)

    socket.on('channel', (channelId, fn) => {
      if (!/\w+/.test(channelId)) {
        debug('invalid channelId')
        return fn('invalid channelId')
      }
      io.in(channelId).clients((err, clients) => {
        if (err) {
          return fn(err)
        }
        if (clients.length > 1) {
          return fn('max clients reached for channel ' + channelId)
        }
        socket.join(channelId)
        if (clients.length === 1) {
          debug('channel', channelId, 'complete')
          socket.to(clients[0]).emit('initiate', channelId)
        }
        return fn()
      })
    })

    socket.on('signal', ({ channelId, data }) => {
      debug('channel', channelId, 'proxy signal', data, 'from', socket.id)
      socket.broadcast.to(channelId).emit('signal', { channelId, data })
    })

    socket.on('disconnect', () => {
      debug('disconnect', socket.id)
    })
  })
}
