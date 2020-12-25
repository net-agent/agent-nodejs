import * as events from 'events'
import * as cc from './cipher_conn'

const debuglog = false
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

  static uidValue:number = 1

  public id:number
  public sid:number
  public type:number
  public header:Object
  public dataType:number
  public data:Buffer

  constructor(id: number, sid:number, type:number,
    header:Object, dataType:number, data:Buffer) {
    this.id = id
    this.sid = sid
    this.type = type
    this.header = header
    this.dataType = dataType
    this.data = data ? data : Buffer.alloc(0)
  }

  static uid():number {
    return Frame.uidValue++
  }

  static newStreamData(sid:number, data:Buffer):Frame {
    return new Frame(
      Frame.uid(),
      sid,
      Frame.typeStreamData,
      null,
      Frame.binaryData,
      data
    )
  }
  static newDialRequest(localSID:number, vport:number):Frame {
    let buf = Buffer.alloc(8)
    buf.writeUInt32BE(vport, 0)
    buf.writeUInt32BE(localSID, 4)
    return new Frame(
      Frame.uid(),
      Frame.uid(),
      Frame.typeDialRequest,
      null,
      Frame.binaryData,
      buf)
  }
  static newDialResponse(sid:number, localSID: number):Frame {
    let buf = Buffer.alloc(4)
    buf.writeUInt32BE(localSID, 0)
    return new Frame(
      Frame.uid(),
      sid,
      Frame.typeDialResponse,
      null,
      Frame.binaryData,
      buf)
  }
  static newRequest(cmd:string, dataType:number, data:Buffer):Frame {
    return new Frame(
      Frame.uid(),
      Frame.uid(),
      Frame.typeRequest,
      {cmd},
      dataType,
      data)
  }
  static newResponseOK(sid:number, dataType:number, data:Buffer):Frame {
    return new Frame(
      Frame.uid(),
      sid,
      Frame.typeResponseOK,
      null,
      dataType,
      data)
  }
  static newResponseErr(sid:number, err:string):Frame {
    return new Frame(
      Frame.uid(),
      sid,
      Frame.typeResponseErr,
      null,
      Frame.textData,
      Buffer.from(err))
  }
  static newPing():Frame {
    return new Frame(
      Frame.uid(),
      Frame.uid(),
      Frame.typePing,
      null,
      Frame.binaryData,
      null)
  }
  static newPong(sid:number):Frame {
    return new Frame(
      Frame.uid(),
      sid,
      Frame.typePong,
      null,
      Frame.binaryData,
      null)
  }

  getEventName():string {
    switch (this.type) {
      case Frame.typeStreamData:
        return `data/${this.sid}`
      case Frame.typeRequest:
        return 'request'
      case Frame.typeResponseErr:
      case Frame.typeResponseOK:
        return `response/${this.sid}`
      case Frame.typeDialRequest:
        return 'dial'
      case Frame.typeDialResponse:
        return `dialresp/${this.sid}`
      case Frame.typePing:
        return 'ping'
      case Frame.typePong:
        return 'pong'
    }
  }

  getRespEventName():string {
    switch (this.type) {
      case Frame.typeRequest:
        return `response/${this.id}`
      case Frame.typeDialRequest:
        return `dialresp/${this.sid}`
      case Frame.typePing:
        return 'pong'
    }
    return ''
  }

  isType(t:number):Boolean {
    return this.type == t
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
    this.data = buf || Buffer.alloc(0)
  }

  getText():string {
    if (this.dataType != Frame.textData) {
      throw 'dataType is not textData'
    }
    return this.data ? this.data.toString('utf-8') : ''
  }

  getJSON():any {
    if (this.dataType != Frame.jsonData) {
      throw 'dataType is not jsonData'
    }
    if (!this.data || this.data.length <= 0) return null
    try {
      let obj = JSON.parse(this.data.toString('utf-8'))
      return obj
    } catch (ex) {
      throw `parse frame.data as json failed: ${ex}`
    }
  }

  getData():Buffer {
    return this.data
  }
}

//
// FrameConn
//
export class FrameConn extends events.EventEmitter {
  static WAIT_HEADER:number = 0
  static WAIT_ALL_DATA:number = 1
  static uidvalue:number = 1
  static pingTimeout:number = 1000 * 3
  static requestTimeout:number = 1000 * 5
  static dialTimeout:number = 1000 * 10

  private conn:cc.CipherConn
  private wantSize:number
  private savedBuf:Buffer
  private state:number
  private readingFrame:Frame
  private headerSize:number
  private dataSize:number

  constructor(conn: cc.CipherConn) {
    super()
    this.conn = conn

    this.initReadState(Buffer.alloc(0))
    this.conn.on('data', (buf) => this.eatBuf(buf))

    // proxy event
    let events = 'close|error'.split('|')
    events.forEach(event => {
      this.conn.on(event, (...args:any) => {
        this.emit(event, args)
      })
    })
  }

  static uid():number {
    return FrameConn.uidvalue++
  }

  send(frame:Frame):boolean {
    debuglog && console.log('>>> send frame', frame)
    return this.conn.write(frame.getBuffer())
  }

  request(cmd:string, payload:Object):Promise<any> {
    return new Promise((resolve, reject) => {
      let buf:Buffer = null
      if (payload) {
        buf = Buffer.from(JSON.stringify(payload))
      }
      let frame = Frame.newRequest(cmd, Frame.jsonData, buf)
      this.send(frame)
      this.onceTimeout(
        frame.getRespEventName(),
        FrameConn.requestTimeout, (frame:Frame) => {
          if (frame.isType(Frame.typeResponseErr)) {
            let reason = 'unknown request error'
            try {
              reason = frame.getText()
            } catch (ex) {
              reason += '; frame.getText failed: ' + ex
            }

            return reject(`rpc: ${reason}`)
          }

          let resp:any
          try {
            resp = frame.getJSON()
          } catch (ex) {
            return reject(`frame.getJSON failed: ${ex}`)
          }

          resolve(resp)
        },
        reject)
    })
  }

  dial(readSID:number, vport:number):Promise<number> {
    return new Promise((resolve, reject) => {
      let frame = Frame.newDialRequest(readSID, vport)
      this.send(frame)
  
      this.onceTimeout(
        frame.getRespEventName(),
        FrameConn.dialTimeout,
        (frame:Frame) => {
          if (frame.dataType != Frame.binaryData) {
            let reason = 'unknown dial error'
            try {
              reason = frame.getText()
            } catch (ex) {
              reason += '; frame.getText failed: ' + ex
            }

            return reject(`rpc: ${reason}`)
          }

          let data = frame.getData()
          if (!data || data.length != 4) {
            return reject('length of response data invalid')
          }

          // 读取writeSID
          resolve(data.readUInt32BE(0))
        },
        reject
      )
    })
  }

  openStream():any {
    let readSID = Frame.uid()
    return {}
  }

  ping():Promise<void> {
    return new Promise((resolve, reject) => {
      this.send(Frame.newPing())
      this.onceTimeout('pong', FrameConn.pingTimeout, resolve, reject)
    })
  }

  onceTimeout(event:string, timeout:number, resolve:any, reject:any) {
    let callback = (...args:any) => {
      clearTimeout(handler)
      resolve.apply(this, args)
    }
    this.once(event, callback)

    let handler = setTimeout(() => {
      this.removeListener(event, callback)
      reject(`wait once event timeout, ${event}`)
    }, timeout)
  }

  //
  // private methods
  //

  private initReadState(buf:Buffer) {
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

          // 把具体的事件传播出去
          let eventName = this.readingFrame.getEventName()
          debuglog && console.log('<<< recv frame', eventName, this.readingFrame)
          this.emit(eventName, this.readingFrame)
          this.initReadState(this.savedBuf.slice(this.wantSize))
          continue
      }
    }
  }
}