const debug = require('debug')('datachannel')
const io = require('socket.io-client')
const getBrowserRtc = require('get-browser-rtc')
const { poll, getStringByteLength, emitAsync } = require('./util')

const noop = () => {}
const MAX_MESSAGE_SIZE = 64 * 1024
const HIGH_WATERMARK = 1024 * 1024

module.exports = function dataChannel (channelId, config, onData = noop) {
  if (!channelId) {
    throw new Error('channelId required')
  }
  if (!/^[0-9A-z-]+$/.test(channelId)) {
    throw new Error('channelId must be alphanumeric (incl. minus)')
  }

  config = {
    rtcConfig: {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    },
    wrtc: getBrowserRtc(),
    ...config
  }
  if (!config.wrtc) {
    throw new Error('no browser, config.wrtc required')
  }
  if (!config.signalServerUrl) {
    throw new Error('config.signalServerUrl required')
  }

  const ID = channelId
  const messageQueue = [] // of type {data, lengthInBytes, resolve, reject}
  let channel, remoteMaxMessageSize
  const connection = new config.wrtc.RTCPeerConnection(config.rtcConfig)
  const socket = io(config.signalServerUrl)

  return new Promise(async (resolve, reject) => {
    // signal server connection
    await new Promise((resolve, reject) => {
      socket.on('connect', () => resolve())
      socket.on('error', e => reject(new Error(e)))
    })
    const localId = socket.id

    // one of the two peers gets this event in order to initiate setup
    socket.on('initiate', async channelId => {
      debug(channelId, localId, 'got initiate')
      if (channelId !== ID) return

      try {
        channel = connection.createDataChannel(channelId, { ordered: true })
        setupChannel()
      } catch (e) {
        debug(channelId, localId, 'creating channel failed', e)
        return reject(e)
      }

      let offer
      try {
        offer = await connection.createOffer()
        debug(channelId, localId, 'got offer')
      } catch (e) {
        debug(channelId, localId, 'creating offer failed', e)
        return reject(e)
      }

      try {
        connection.setLocalDescription(offer)
      } catch (e) {
        debug(channelId, localId, 'setting local description failed', e)
        return reject(e)
      }

      socket.emit('signal', { channelId: ID, data: { offer } })
    })

    // listen to signal events
    socket.on('signal', async ({ channelId, data }) => {
      if (channelId !== ID) return

      if (data.offer) {
        debug(channelId, localId, 'got offer signal')
        connection.setRemoteDescription(
          new config.wrtc.RTCSessionDescription(data.offer)
        )
        extractRemoteMaxMessageSize(data.offer)

        let answer
        try {
          answer = await connection.createAnswer()
        } catch (e) {
          debug(channelId, localId, 'creating answer failed', e)
          return reject(e)
        }

        try {
          connection.setLocalDescription(answer)
        } catch (e) {
          debug(channelId, localId, 'failed to set local description', e)
          return reject(e)
        }

        try {
          socket.emit('signal', { channelId: ID, data: { answer } })
        } catch (e) {
          debug(channelId, localId, 'failed to send answer', e)
          return reject(e)
        }
      } else if (data.answer) {
        debug(channelId, localId, 'got answer signal')
        try {
          connection.setRemoteDescription(
            new config.wrtc.RTCSessionDescription(data.answer)
          )
          extractRemoteMaxMessageSize(data.answer)
        } catch (e) {
          debug(channelId, localId, 'failed to set remote description', e)
          return reject(e)
        }
      } else if (data.candidate) {
        debug(channelId, localId, 'got candidate signal')
        try {
          await connection.addIceCandidate(
            new config.wrtc.RTCIceCandidate(data.candidate)
          )
        } catch (e) {
          debug(channelId, localId, 'failed to add ICE candidate', e)
          return reject(e)
        }
      } else {
        debug(channelId, localId, 'got unknown signal', data)
      }
    })

    connection.addEventListener('icecandidate', event => {
      const candidate = event.candidate
      debug(channelId, localId, 'got ICE candidate:', candidate)
      if (candidate === null) {
        return
      }
      socket.emit('signal', { channelId: ID, data: { candidate } })
    })

    connection.addEventListener('datachannel', event => {
      debug(channelId, localId, 'received channel callback')
      channel = event.channel
      setupChannel()
    })

    try {
      await emitAsync(socket, 'channel', ID)
    } catch (e) {
      debug(channelId, localId, 'joining datachannel failed', e)
      reject(e)
    }

    try {
      await poll(() => channel && channel.readyState === 'open', 10000)
    } catch (e) {
      debug(channelId, localId, 'no remote peer connected', e)
      reject(new Error('connection timeout'))
    }

    resolve({
      send (message) {
        try {
          debug(
            channelId,
            localId,
            'bufferedAmount before send:',
            channel.bufferedAmount
          )
          channel.send(message)
          setTimeout(
            // give chance to update bufferedAmount async
            () =>
              debug(
                channelId,
                localId,
                'bufferedAmount after send:',
                channel.bufferedAmount
              ),
            0
          )
          return true
        } catch (e) {
          debug(channelId, localId, 'sending message failed', e)
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
    })
  })

  async function sendAsyncInternal () {
    const message = messageQueue.shift()
    if (!message) {
      debug('message queue is empty')
      return
    }
    const { data, lengthInBytes, resolve, reject } = message
    // TODO check connection state and maybe signaling state too
    if (channel.readyState !== 'open') {
      await poll(() => channel.readyState === 'open')
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
    channel.binaryType = 'arraybuffer'
    channel.bufferedAmountLowThreshold = MAX_MESSAGE_SIZE
    channel.addEventListener('bufferedamountlow', e => {
      // didn't see this fired, but leave it here, doesn't hurt
      debug('bufferedamountlow event', e)
      sendAsyncInternal()
    })
    // TODO set bufferedAmountLowThreshold and bufferedAmountLow callback in `open` handler (see sample)
    channel.addEventListener('open', debugState)
    channel.addEventListener('close', debugState)
    channel.addEventListener('error', e => {
      debug('channel error:', e)
      debugState()
    })
    channel.addEventListener('message', message => {
      onData(message.data)
    })
  }

  function debugState () {
    debug('state', {
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
        debug('got remoteMaxMessageSize from sdp prop')
      }
    } catch (e) {
      debug(
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
