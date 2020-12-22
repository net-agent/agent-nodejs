import * as fc from './frame_conn'
import * as events from 'events'


export class Stream extends events.EventEmitter {
  private fconn:fc.FrameConn
  private writeSID:number
  private readSID:number

  constructor(fconn:fc.FrameConn) {
    super()
    this.fconn = fconn
    this.readSID = fc.Frame.uid()
  }

  bindWriteSID(sid:number) {
    this.writeSID = sid
  }

  getReadSID():number {
    return this.readSID
  }

  write(buf:Buffer):Boolean {
    return this.fconn.send(fc.Frame.newStreamData(this.writeSID, buf))
  }

  on(event:'data'|'close'|'error', cb:(...args:any) => void):this {
    switch (event) {
      case 'data':
        this.fconn.on(`data/${this.readSID}`, cb)
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