import {Frame, FrameConn} from './frame_conn'
import * as events from 'events'

export interface StreamLike {
  on(event:'data'|'close'|'error', cb:(...args:any) => void):this
  write(buf:Buffer):boolean
  destroy(error?:Error):void
}

export class Stream extends events.EventEmitter {
  private fconn:FrameConn
  private writeSID:number
  private readSID:number

  constructor(fconn:FrameConn) {
    super()
    this.fconn = fconn
    this.readSID = Frame.uid()
  }

  bindWriteSID(sid:number) {
    this.writeSID = sid
  }

  getReadSID():number {
    return this.readSID
  }

  write(buf:Buffer):boolean {
    return this.fconn.send(Frame.newStreamData(this.writeSID, buf))
  }

  destroy(error?:Error) {
    super.removeAllListeners()
    this.fconn.removeAllListeners(`data/${this.readSID}`)
    this.fconn = null
    this.readSID = 0
    this.emit('close')
  }

  on(event:'data'|'close'|'error', cb:(...args:any) => void):this {
    switch (event) {
      case 'data':
        this.fconn.on(`data/${this.readSID}`, (frame:Frame) => {
          cb(frame.data)
        })
        break
      case 'close':
        super.on('close', cb)
        break
      case 'error':
        super.on('error', cb)
        break
    }
    return this
  }
}