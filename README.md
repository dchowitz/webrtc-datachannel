# About

Some experiments trying to transfer data (up to several MB in size) over WebRTC data channels.

This involves a real signal server over socket.io.

Sources:
[Determine max message size](https://blog.mozilla.org/webrtc/large-data-channel-messages/)
[Spec](https://cdn.rawgit.com/w3c/webrtc-pc/f4061e8ad0be1b849c863a01ebc391669d92d7f2/webrtc.html#rtcdatachannel)
[Sample](https://github.com/webrtc/samples/blob/gh-pages/src/content/datachannel/datatransfer/js/main.js)

# Observations

## wrtc (nodejs)

- Messages bigger than 256 kB get splitted into chunks of 256 kB. The receiver is responsible for reassembling.
- Typed arrays and buffers arrive as ArrayBuffer on receiver side.
- Strings arrive as strings.
