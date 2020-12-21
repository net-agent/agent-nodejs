import * as events from 'events'
import * as net from 'net'

const minFrameBufSize:number = 4 + 1 + 4 + 1 + 4 + 4

export class Frame {
  static typeStreamData:number = 0
  static typeRequest:number = 1
  static typeResponseOK:number = 2
  static typeResponseErr:number = 3
  static typeDialRequest:number = 4
  static typeDialResponse:number = 5
  static typePing:number = 6
  static typePong:number = 7

  static binaryData:number = 0
  static textData:number = 1
  static jsonData:number = 2

  private id:number
  private sid:number
  private type:number
  private header:Object
  private dataType:number
  private data:Buffer

  constructor(id:number, sid:number, type:number,
    header:Object, dataType:number, data:Buffer) {
    this.id = id
    this.sid = sid
    this.type = type
    this.header = header
    this.dataType = dataType
    this.data = data ? data : Buffer.alloc(0)
  }

  getBuffer() :Buffer {
    let headerBuf:Buffer = Buffer.alloc(0)
    if (this.header) {
      headerBuf = Buffer.from(JSON.stringify(this.header))
    }
    let buf = Buffer.alloc(minFrameBufSize)
    buf.writeUInt32BE(this.id, 0)
    buf.writeUInt8(this.type, 4)
    buf.writeUInt32BE(this.sid, 5)
    buf.writeUInt8(this.dataType, 9)
    buf.writeUInt32BE(headerBuf ? headerBuf.length : 0, 10)
    buf.writeUInt32BE(this.data ? this.data.length : 0, 14)

    return Buffer.concat([buf, headerBuf, this.data])
  }

  setHeader(buf:Buffer) {
    if (!buf || buf.length <= 0) {
      this.header = null
    } else {
      try {
        this.header = JSON.parse(buf.toString('utf-8'))
      } catch (ex) {
        this.header = null
      }
    }
  }

  setData(buf:Buffer) {
    this.data = buf
  }
}

export class FrameConn extends events.EventEmitter {
  static WAIT_HEADER:number = 0
  static WAIT_ALL_DATA:number = 1

  private conn:net.Socket
  private wantSize:number
  private savedBuf:Buffer
  private state:number
  private readingFrame:Frame
  private headerSize:number
  private dataSize:number

  constructor(conn: net.Socket) {
    super()
    this.conn = conn

    this.initReadState(Buffer.alloc(0))
    this.conn.on('data', (buf) => this.eatBuf(buf))
  }

  sendFrame(frame:Frame):Boolean {
    return this.conn.write(frame.getBuffer())
  }

  initReadState(buf:Buffer) {
    this.wantSize = minFrameBufSize
    this.savedBuf = buf
    this.state = FrameConn.WAIT_HEADER
    this.readingFrame = null
    this.headerSize = 0
    this.dataSize = 0
  }

  private eatBuf(buf:Buffer) {
    this.savedBuf = Buffer.concat([this.savedBuf, buf])

    while (this.savedBuf.length >= this.wantSize) {
      switch (this.state) {
        case FrameConn.WAIT_HEADER:
          let id = this.savedBuf.readUInt32BE(0)
          let type = this.savedBuf.readUInt8(4)
          let sid = this.savedBuf.readUInt32BE(5)
          let dataType = this.savedBuf.readUInt8(9)
          this.headerSize = this.savedBuf.readUInt32BE(10)
          this.dataSize = this.savedBuf.readUInt32BE(14)
          this.readingFrame = new Frame(id, sid, type, null, dataType, null)
    
          this.wantSize += (this.headerSize + this.dataSize)
          this.state = FrameConn.WAIT_ALL_DATA
          continue
        
        case FrameConn.WAIT_ALL_DATA:
          let headerBegin = minFrameBufSize
          let headerEnd = headerBegin + this.headerSize
          let dataBegin = headerEnd
          let dataEnd = dataBegin + this.dataSize
          if (this.headerSize > 0) {
            this.readingFrame.setHeader(this.savedBuf.slice(headerBegin, headerEnd))
          }
          if (this.dataSize > 0) {
            this.readingFrame.setData(this.savedBuf.slice(dataBegin, dataEnd))
          }

          this.emit('frame', this.readingFrame)
          this.initReadState(this.savedBuf.slice(this.wantSize))
          continue
      }
    }
  }
}