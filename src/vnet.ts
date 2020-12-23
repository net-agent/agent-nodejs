import * as events from 'events'
import * as net from 'net'
import { CipherConn } from './cipher_conn'
import { Frame, FrameConn } from './frame_conn'
import { Stream } from './stream'
import { splitHostPort } from './utils'

type requestHandler = (payload:any, header:any) => Promise<any>

export class VNet extends events.EventEmitter {
  public fconn:FrameConn
  private handlerMap:Map<string,requestHandler>

  constructor(fconn:FrameConn) {
    super()
    this.fconn = fconn
    
    this.fconn.on('dial',  (frame:Frame) => {
      let data:Buffer = frame.getData()
      if (!frame.isType(Frame.binaryData) || !data || data.length != 8) {
        this.fconn.send(new Frame(
          Frame.uid(), frame.sid, Frame.typeDialResponse, null,
          Frame.textData, Buffer.from('decode dial request failed')
        ))
        return
      }
      
      let vport = data.readUInt32BE(0)
      let writeSID = data.readUInt32BE(4)

      let stream = new Stream(this.fconn)
      stream.bindWriteSID(writeSID)

      this.fconn.send(Frame.newDialResponse(frame.sid, stream.getReadSID()))
      
      this.emit(`stream/${vport}`, stream)
    })

    this.fconn.on('request', async (frame:Frame) => {
      if (!frame.header || !frame.header['cmd']) {
        this.fconn.send(Frame.newResponseErr(frame.sid, 'cmd not found'))
        return
      }

      let cmd = frame.header['cmd']
      let payload:any
      try {
        payload = frame.getJSON()
      } catch (ex) {
        this.fconn.send(Frame.newResponseErr(frame.sid, 'parse json body failed'))
        return
      }
      
      if (!this.handlerMap.has(cmd)) {
        this.fconn.send(Frame.newResponseErr(frame.sid, 'handler not found'))
        return
      }

      let handler = this.handlerMap.get(cmd)
      let buf: Buffer
      try {
        let resp = await handler(payload, frame.header)
        buf = Buffer.from(JSON.stringify(resp))
      } catch (ex) {
        this.fconn.send(Frame.newResponseErr(frame.sid, ex))
        return
      }
      this.fconn.send(Frame.newResponseOK(frame.sid, Frame.jsonData, buf))
    })
  }

  static connect(addr:string, secret:string):Promise<VNet> {
    let {host, port} = splitHostPort(addr)
    return new Promise((resolve, reject) => {
      let conn = net.connect({host, port}, function () {
        conn.removeAllListeners()
        let cipherconn = new CipherConn(conn, secret)
        cipherconn.on('ready', () => {
          cipherconn.removeAllListeners()
          let vnet = new VNet(new FrameConn(cipherconn))
          resolve(vnet)
        })
        cipherconn.once('error', reject)
      })
      conn.once('error', reject)
    })
  }

  listen(vport:number, cb:(s:Stream) => void) {
    this.on(`stream/${vport}`, cb)
  }

  dial(vport:number):Promise<Stream> {
    return new Promise(async (resolve, reject) => {
      let stream = new Stream(this.fconn)
      let writeSID:number
      try {
        writeSID = await this.fconn.dial(stream.getReadSID(), vport)
      } catch (ex) {
        return reject(ex)
      }
      stream.bindWriteSID(writeSID)
      return resolve(stream)
    })
  }

  request(cmd:string, payload:any):Promise<any> {
    return this.fconn.request(cmd, payload)
  }
  onrequest(cmd:string, cb:requestHandler) {
    this.handlerMap.set(cmd, cb)
  }
}
