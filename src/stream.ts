import {Frame, FrameConn} from './frame_conn'
import * as events from 'events'

export interface StreamLike {
  on(event:'data'|'end'|'close'|'error', cb:(...args:any) => void):this
  write(buf:Buffer):boolean
  destroy(error?:Error):void
  end(...args:any):void
  removeListener(...args:any):void
}

export class Stream extends events.EventEmitter {
  private fconn:FrameConn
  private writeSID:number
  private readSID:number
  private writable:boolean = false

  constructor(fconn:FrameConn) {
    super()
    this.fconn = fconn
    this.readSID = Frame.uid()
  }

  bindWriteSID(sid:number) {
    this.writeSID = sid
    this.writable = true
  }

  getReadSID():number {
    return this.readSID
  }

  write(buf:Buffer):boolean {
    if (!this.writable) {
      this.emit('error', 'stream is not writable')
      return
    }
    if (!buf || buf.length == 0) {
      this.writable = false
    }
    return this.fconn.send(Frame.newStreamData(this.writeSID, buf))
  }

  destroy(error?:Error) {
    if (this.writable) {
      this.end()
    }
    super.removeAllListeners()
    this.fconn.removeAllListeners(`data/${this.readSID}`)
    this.fconn = null
    this.readSID = 0
    this.emit('close')
  }

  on(event:'data'|'end'|'close'|'error', cb:(...args:any) => void):this {
    switch (event) {
      case 'data':
        this.fconn.on(`data/${this.readSID}`, (frame:Frame) => {
          if (!frame.data || frame.data.length == 0) {
            this.emit('end')
          } else {
            cb(frame.data)
          }
        })
        break
      default:
        super.on(event, cb)
    }
    return this
  }

  end(data?:Buffer, cb?:() =>void ):this {
    if (data) {
      this.write(data)
    }
    this.write(null) // 发送一帧空数据代表EOF
    return this
  }
}