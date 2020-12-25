import { EventEmitter } from 'events'
import { VNet } from './vnet'
import * as net from 'net'
import { StreamLike } from './stream'
import { Cluster } from './cluster'
import { dial, linkStream, splitHostPort } from './utils'
import * as socks5 from './socks5'

export type ServiceType = 'socks5' | 'portproxy'

export type ServiceInfo = {
  enable: boolean
  description: string
  type: ServiceType
  param: any
}

export function runService(vnet:VNet, cluster:Cluster, info:ServiceInfo): EventEmitter {
  let svc:EventEmitter

  switch (info.type) {
  case 'socks5':
    svc = runSocks5(vnet, cluster,
      info.param.listen,
      info.param.username,
      info.param.password)
    break
  case 'portproxy':
    svc = runPortproxy(vnet, cluster,
      info.param.listen,
      info.param.target)
    break
  default:
    throw `unknown service type: ${info.type}`
  }

  return svc
}

function safeDial(cluster:Cluster, addr:string):Promise<StreamLike> {
  let {host, port} = splitHostPort(addr)
  if (/\.tunnel$/.test(host)) {
    return cluster.dial(host, port)
  } else {
    return dial(host, port)
  }
}

export function runPortproxy(vnet:VNet, cluster:Cluster, listen:string, target:string): EventEmitter {
  let ev = new EventEmitter()
  let {host, port} = splitHostPort(listen)
  let onStreamLike = async (s1:StreamLike) => {
    try {
      let s2 = await safeDial(cluster, target)
      linkStream(s1, s2, target)
    } catch (ex) {
      s1.destroy()
      let err = `connect target='${target}' failed, ${ex}`
      ev.emit('warn', err)
    }
  }

  setImmediate(() => {
    if (host == 'tunnel') {
      vnet.listen(port, onStreamLike)
      ev.emit('ready', `${listen} -> ${target}`)
    } else {
      let listener = net.createServer(onStreamLike).listen(port, host, function () {
        ev.emit('ready', `${listen} -> ${target}`)
      })
      listener.on('error', err => ev.emit('error', err))
    }
  })

  return ev
}

export function runSocks5(vnet:VNet, cluster:Cluster, listen:string, username:string, password:string): EventEmitter {
  let ev = new EventEmitter()

  let checker:socks5.AuthChecker = null
  if (username != "" || password != "") {
    checker = (u:string, p:string):boolean => {
      return u == username && p == password
    }
  }
  
  let dialer:socks5.Dialer = (username:string, password:string, host:string, port:number):Promise<StreamLike> => {
    return safeDial(cluster, `${host}:${port}`)
  }

  let {host, port} = splitHostPort(listen)
  let onready = () => {
    let query = ''
    if (username != '' || password != '') {
      query = `?u=${username}&p=${password}`
    }
    ev.emit('ready', `socks5://${listen}${query}`)
  }

  setImmediate(() => {
    if (host == 'tunnel') {
      socks5.listenOnVNet(vnet, port, checker, dialer)
      onready()
    } else {
      socks5
        .createServer(checker, dialer)
        .listen(port, host, onready)
    }
  })


  return ev
}