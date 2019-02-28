const debug = require('debug')('server')
const ip = require('ip')
const http = require('http')
const signalServer = require('./signal-server')

const server = http.createServer()
signalServer(server)

const port = process.env.PORT || '3333'
server.listen(port, () => {
  debug(`listening at ${ip.address()}:${port}`)
})
