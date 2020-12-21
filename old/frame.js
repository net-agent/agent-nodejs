const frameStableBufSize = 4 + 1 + 4 + 1 + 4 + 4

const typeStreamData = 0
const typeRequest = 1
const typeResponseOK = 2
const typeResponseErr = 3
const typeDialRequest = 4
const typeDialResponse = 5
const typePing = 6
const typePong = 7

const binaryData = 0
const textData = 1
const jsonData = 2


module.exports = {
  newFrameBuf,
  createFrameReader,
  upgrade,

	typeStreamData,
	typeRequest,
	typeResponseOK,
	typeResponseErr,
	typeDialRequest,
	typeDialResponse,
	typePing,
  typePong,
  
  binaryData,
  textData,
  jsonData
}

function newFrameBuf(id, type, sid, header, dataType, data) {
  let headerSize = 0
  let headerBuf = Buffer.from([])
  if (header != null) {
    headerBuf = Buffer.from(JSON.stringify(header, null, ''))
    headerSize = headerBuf.length
  }

  let dataSize = 0
  let dataBuf = Buffer.from([])
  if (data != null) {
    dataBuf = data
    dataSize = data.length
  }

  let buf = Buffer.alloc(frameStableBufSize)
  buf.writeUInt32BE(id, 0)
  buf.writeUInt8(type, 4)
  buf.writeUInt32BE(sid, 5)
  buf.writeUInt8(dataType, 9)
  buf.writeUInt32BE(headerSize, 10)
  buf.writeUInt32BE(dataSize, 14)
  
  buf = Buffer.concat([buf, headerBuf, dataBuf])

  return buf
}

function createFrameReader(onFrame, onError) {
  const WAIT_HEADER = 0
  const WAIT_ALL_DATA = 1

  let buf = Buffer.from([])
  let wantSize = frameStableBufSize
  let state = WAIT_HEADER
  let ctx = {}

  return function ondata(data) {
    buf = Buffer.concat([buf, data])

    while (buf.length >= wantSize) {

      switch (state) {

        case WAIT_HEADER:
          ctx.id = buf.readUInt32BE(0)
          ctx.type = buf.readUInt8(4)
          ctx.sid = buf.readUInt32BE(5)
          ctx.dataType = buf.readUInt8(9)
          ctx.headSize = buf.readUInt32BE(10)
          ctx.dataSize = buf.readUInt32BE(14)
          wantSize += (ctx.headSize + ctx.dataSize)
          state = WAIT_ALL_DATA
          continue

        case WAIT_ALL_DATA:
          let headerBegin = frameStableBufSize
          let headerEnd = headerBegin + ctx.headSize
          let dataBegin = headerEnd
          let dataEnd = dataBegin + ctx.dataSize
          if (headerBegin == headerEnd) {
            ctx.header = null
          } else {
            try {
              ctx.header = JSON.parse(buf.slice(headerBegin, headerEnd).toString('utf-8'))
            } catch (ex) {
              console.warn('parse json failed', ex)
              ctx.header = null
            }
          }
          if (dataBegin == dataEnd) {
            ctx.data = null
          } else {
            ctx.data = buf.slice(dataBegin, dataEnd)
          }

          setImmediate(onFrame, ctx)

          buf = buf.slice(wantSize)
          wantSize = frameStableBufSize
          state = WAIT_HEADER
          ctx = {}
          continue

        default:
          setImmediate(onError, 'bad state')
      }
    }
  }
}

// upgrade cipher conn
function upgrade(cc) {
  // 调用sendFrame来发送一帧数据
  cc.sendFrame = function (f) {
    return cc.secureWrite(newFrameBuf(f.id, f.type, f.sid, f.header, f.dataType, f.data))
  }

  let onFrameCbs = []
  cc.onSecureData(createFrameReader(function (f) {
    if (onFrameCbs.length > 0) {
      for (let i = 0; i < onFrameCbs.length; i++) {
        onFrameCbs[i](f)
      }
    } else {
      console.warn('onFrameCbs not found', f)
    }
  }))

  // 调用onFrame来注册回调函数
  cc.onFrame = function (onFrameCb) {
    onFrameCbs.push(onFrameCb)
  }

  cc.setFrameEventListener = function ({
    onRequest, onResponse,
    onDialRequest, onDialResponse,
    onPing, onPong, onStreamData})
  {
    return this.onFrame(function (f) {
      console.log('on frame', f)
      let fn = null
      if (f.type == typeStreamData) {
        fn = onStreamData
      } else {
        switch (f.type) {
        case typeRequest:
          fn = onRequest
          break
        case typeResponseOK:
        case typeResponseErr:
          fn = onResponse
          break
        case typeDialRequest:
          fn = onDialRequest
          break
        case typeDialResponse:
          fn = onDialResponse
          break
        case typePing:
          fn = onPing
          break
        case typePong:
          fn = onPong
          break
        default:
          // unknown f.type
        }
      }
      if (!fn || typeof fn != 'function') {
        return console.warn(`unexpected callback function, type=${f.type}`, fn)
      }
      fn(f)
    })
  }

  return cc
}

