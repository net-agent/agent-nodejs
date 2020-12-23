import { EventEmitter } from 'events'
import { splitHostPort } from './utils'
import { VNet } from './vnet'
import * as net from 'net'
import { StreamLike } from './stream'
import { Cluster } from './cluster'
import { dial, linkStream } from './utils'

export function runPortproxy(vnet:VNet, cluster:Cluster, listen:string, target:string): EventEmitter {
  let ev = new EventEmitter()
  let {host, port} = splitHostPort(listen)
  let onStreamLike = async (s1:StreamLike) => {
    try {
      let s2:StreamLike
      let {host, port} = splitHostPort(target)
      if (/\.tunnel$/.test(host)) {
        s2 = await cluster.dial(host, port)
      } else {
        s2 = await dial(host, port)
      }
      linkStream(s1, s2)
    } catch (ex) {
      s1.destroy()
      let err = `connect target='${target}' failed, ${ex}`
      ev.emit('error', err)
    }
  }

  if (host == 'tunnel') {
    vnet.listen(port, onStreamLike)
    console.log(`portproxy running: ${listen} -> ${target}`)
  } else {
    let listener = net.createServer(onStreamLike).listen(port, host, function () {
      console.log(`portproxy running: ${listen} -> ${target}`)
    })
    listener.on('error', err => ev.emit('error', err))
  }

  return ev
}